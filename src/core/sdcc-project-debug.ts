import { opcodeMeta } from "./opcodes";
import { parseCdbSymbols } from "./cdb-symbols";
import { parseCdbFunctions } from "./cdb-functions";
import type { SdccDebugData, SourceLocation, VerifiedSourceFile } from "./sdcc-debug";
const fail = (message: string): never => { throw new Error(`混合工程 CDB：${message}`); };
/** Preserve original records. CDB basenames are resolved only through the unique project manifest. */
export function parseProjectDebug(data: SdccDebugData, firmware: Uint8Array) {
  const project = data.project!, inputs = data.inputs!;
  const records = data.cdb.split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean);
  if (records.length > 16384 || /[^\t\n\r -~]/.test(data.cdb) || records.some(line => line.length > 4096 || !/^[MFSTL]:.+$/.test(line))) return fail("记录格式或数量超限");
  if (records.filter(row => row.startsWith("S:")).length > 4096 || records.filter(row => row.startsWith("F:")).length > 256) return fail("声明数量超限");
  const basename = (path: string) => path.split("/").at(-1)!;
  const stem = (path: string) => basename(path).replace(/\.[^.]+$/, "");
  const sources = new Map(project.sources.map(item => [stem(item.path), item]));
  const declarations = new Map<string, string[]>();
  const links: string[] = [], asm = new Map<string, Set<number>>();
  const asmLines: { module: string; line: number; address: number }[] = [];
  const cLines: { file: string; line: number; address: number }[] = [];
  let module = "";
  const address = (hex: string) => {
    const value = parseInt(hex, 16);
    if (value >= firmware.length || value > 65535) return fail("地址超出固件");
    return value;
  };
  for (const record of records) {
    if (record.startsWith("M:")) {
      module = record.slice(2);
      if (sources.get(module)?.language !== "c" || declarations.has(module)) return fail("未知或重复的 C 模块");
      declarations.set(module, [record]);
    } else if (/^[FST]:/.test(record)) {
      if (!module) return fail("声明缺少模块");
      declarations.get(module)!.push(record);
    } else if (record.startsWith("L:A")) {
      const match = /^L:A\$([^$]+)\$(\d+):([a-fA-F0-9]{1,8})$/.exec(record);
      if (!match || !sources.has(match[1]!) || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1) return fail("汇编行链接无效");
      const pc = address(match[3]!);
      const set = asm.get(match[1]!) ?? new Set<number>(); set.add(pc); asm.set(match[1]!, set);
      asmLines.push({ module: match[1]!, line: Number(match[2]), address: pc });
    } else if (record.startsWith("L:C")) {
      const match = /^L:C\$([^$]+)\$(\d+)\$\d+(?:_\d+)*\$\d+:([a-fA-F0-9]{1,8})$/.exec(record);
      if (!match) return fail("C 行链接无效");
      cLines.push({ file: match[1]!, line: Number(match[2]), address: address(match[3]!) });
    } else if (/^L:(?:G|F|L|XG|XF)[^:]+:[a-fA-F0-9]{1,8}$/.test(record)) links.push(record);
    else return fail("不支持的记录");
  }
  for (const [name, source] of sources) if (source.language === "c" && !declarations.has(name)) return fail("缺少 C 模块");
  if (!declarations.get(stem(project.entry))?.some(record => /^F:G\$main\$0_0\$0\(/.test(record))) return fail("入口文件没有 main 函数定义");
  const files: VerifiedSourceFile[] = inputs.map(input => ({ path: input.path, text: input.text, language: project.sources.find(source => source.path === input.path)?.language ?? "header", locations: [] }));
  const sourceLines = new Map(files.map(file => [file.path, file.text.split(/\r\n|\n|\r/)]));
  const seen = new Map(files.map(file => [file.path, new Set<string>()]));
  let locationCount = 0;
  const instruction = (pc: number) => {
    const meta = opcodeMeta(firmware[pc]!);
    if (!meta.legal || pc + meta.length > firmware.length) return fail("源码地址不是完整合法指令");
    return meta;
  };
  const add = (file: VerifiedSourceFile, line: number, pc: number) => {
    if (!Number.isSafeInteger(line) || line < 1 || line > sourceLines.get(file.path)!.length) return fail("源码行越界");
    const key = `${line}:${pc}`;
    if (!seen.get(file.path)!.has(key)) {
      seen.get(file.path)!.add(key); if (++locationCount > 8192) return fail("源码映射超限");
      file.locations.push({ file: file.path, line, address: pc });
    }
  };
  for (const line of cLines) {
    const file = files.find(item => basename(item.path) === line.file && item.language !== "sdas8051");
    if (!file) return fail("行记录引用未打包的源文件/头文件");
    const candidates = file.language === "c" ? [stem(file.path)] : [...declarations.keys()];
    if (!candidates.some(name => asm.get(name)?.has(line.address))) return fail("C 行没有对应模块的汇编指令地址");
    instruction(line.address); add(file, line.line, line.address);
  }
  const codeLines = new Map<string, Set<number>>();
  for (const file of files.filter(item => item.language === "sdas8051")) {
    const areas = new Map<string, boolean>(), lines = new Set<number>(); let code = false;
    sourceLines.get(file.path)!.forEach((text, index) => {
      const area = /^\s*\.area\s+([A-Za-z_][\w]*)\s*(?:\(([^)]+)\))?\s*$/i.exec(text.split(";")[0]!);
      if (area) { if (area[2]) areas.set(area[1]!, /\bCODE\b/i.test(area[2])); code = areas.get(area[1]!) ?? false; }
      if (code) lines.add(index + 1);
    });
    codeLines.set(file.path, lines);
  }
  for (const line of asmLines) {
    const source = sources.get(line.module)!;
    if (source.language !== "sdas8051") continue;
    const file = files.find(item => item.path === source.path)!;
    const text = sourceLines.get(file.path)![line.line - 1];
    if (text === undefined) return fail("SDAS 行越界");
    if (!codeLines.get(file.path)?.has(line.line)) continue;
    const mnemonic = /^\s*(?:[A-Za-z_][\w$]*::?\s*)?([A-Za-z]+)\b/.exec(text.split(";")[0]!)?.[1]?.toUpperCase();
    // Directives/data/labels/macros are not executable source locations.
    if (!mnemonic || mnemonic !== opcodeMeta(firmware[line.address]!).mnemonic.split(" ")[0]) continue;
    instruction(line.address); add(file, line.line, line.address);
  }
  const locations: SourceLocation[] = files.flatMap(file => file.locations.sort((a, b) => a.line - b.line || a.address - b.address));
  if (!cLines.length || locations.length > 8192) return fail("缺少 C 行或映射超限");
  const symbols = [...declarations].flatMap(([name, rows]) => parseCdbSymbols([...rows, ...links].join("\n"), name, firmware.length));
  const globals = new Map<string, typeof symbols>();
  for (const symbol of symbols.filter(item => item.scope === "G" && !item.type.startsWith("DF,"))) {
    const key = `${symbol.name}$${symbol.level}$${symbol.block}`;
    globals.set(key, [...(globals.get(key) ?? []), symbol]);
  }
  for (const group of globals.values()) {
    if (new Set(group.map(item => `${item.type}:${item.size}:${item.spaceCode}:${item.address}`)).size > 1)
      for (const symbol of group) symbol.unavailable = "跨模块全局声明的类型/位置不一致，不能选择一个声明猜测";
  }
  const functions = [...declarations].flatMap(([name, rows]) => parseCdbFunctions([...rows, ...links, ...records.filter(record => record.startsWith(`L:A$${name}$`))].join("\n"), name, firmware));
  if (symbols.length > 4096 || functions.length > 256) return fail("符号或函数超限");
  return { files, locations, symbols, functions };
}
