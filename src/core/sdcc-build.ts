import { normalizeProjectInputs, normalizeSdccProject, PROJECT_OPTIONS, type SdccProject } from "./sdcc-project";
import { sha256Hex } from "./digest";
import { verifySdccDebug, type SdccDebugData } from "./sdcc-debug";

export interface CBuildInput { project?: SdccProject; files: { path: string; text: string }[] }
export interface CBuildResult { data: SdccDebugData; milliseconds: number; maxStageHeapBytes: number; diagnostics: string }
const sha = (text: string) => sha256Hex(new TextEncoder().encode(text).buffer);
export function validateBuildInput(input: CBuildInput): CBuildInput {
  const project = input.project ? normalizeSdccProject(input.project) : undefined;
  if (!Array.isArray(input.files) || !input.files.length) throw new Error("缺少编译源文件");
  if (project) normalizeProjectInputs(project, input.files.map(file => ({ ...file, sha256: "0".repeat(64) })));
  else if (input.files.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]{0,63}\.c$/.test(input.files[0]!.path)) throw new Error("单文件编译需要规范的 .c 文件名");
  for (const { path, text } of input.files) {
    if (typeof text !== "string" || text.length > 65536 || text.split(/\r\n|\n|\r/).length > 8192) throw new Error("源文件超过 64 Ki 字符 / 8192 行");
    checkBuildText(path, text, project);
  }
  return { project, files: input.files.map(file => ({ ...file })) };
}
export function checkBuildText(path: string, text: string, project?: SdccProject, generated = false) {
  if (/\\\r?\n|\?\?|%:|_Pragma|__has_include/.test(text) || /\.\s*(?:include|incbin)\b/i.test(text)) throw new Error(`不支持的文件指令：${path}`);
  if (path.endsWith(".asm")) for (const line of text.split(/\r\n|\n|\r/)) {
    const directive = /^\s*\.([A-Za-z]+)/.exec(line.split(";")[0]!);
    if (directive && !["module","globl","area","org","db","dw","ds","equ","end",...(generated ? ["optsdcc"] : [])].includes(directive[1]!.toLowerCase())) throw new Error(`不支持的 SDAS 指令：${path}`);
  }
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  for (const line of clean.split(/\r\n|\n|\r/)) {
    if (!/^\s*#/.test(line)) continue;
    const include = /^\s*#\s*include\s*(["<])([A-Za-z0-9_][A-Za-z0-9_/-]*\.[hH])[">]\s*$/.exec(line);
    if (include) {
      const name = include[2]!;
      const parent = path.includes("/") ? path.slice(0,path.lastIndexOf("/")+1) : "";
      const candidates = [parent+name,...(project?.includeDirs ?? []).map(dir => `${dir}/${name}`)];
      if (!candidates.some(candidate => project?.headers.includes(candidate)) && !(include[1] === "<" && ["8051.h","stdint.h"].includes(name))) throw new Error(`未列入工程的头文件：${path}`);
    } else if (!/^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif|define|undef|error)\b/.test(line)) throw new Error(`不支持的预处理指令：${path}`);
  }
}
interface ToolFS {
  mkdirTree(path: string): void; writeFile(path: string, data: string | Uint8Array): void;
  chdir(path: string): void; readFile(path: string): Uint8Array;
  stat(path: string): { size: number }; readdir(path: string): string[];
}
export interface CompilerTool { FS: ToolFS; callMain(args: string[]): number; heapBytes(): number }
export type ToolFactory = (options: { thisProgram: string; print(text: string): void; printErr(text: string): void; stdin(): number | null }) => Promise<CompilerTool>;
export type ToolName = "sdcpp" | "sdcc" | "sdas8051" | "sdld";
const macros = ["__SDCC_CHAR_UNSIGNED","__SDCC_MODEL_SMALL","__SDCC_FLOAT_REENT","__SDCCCALL=0","__SDCC=4_5_0","__SDCC_VERSION_MAJOR=4","__SDCC_VERSION_MINOR=5","__SDCC_VERSION_PATCH=0","SDCC=450","__SDCC_REVISION=15242","__SDCC_mcs51","__STDC_NO_COMPLEX__=1","__STDC_NO_THREADS__=1","__STDC_NO_ATOMICS__=1","__STDC_NO_VLA__=1","__STDC_ISO_10646__=201409L","__SIZEOF_FLOAT__=4","__SIZEOF_DOUBLE__=4","__SDCC_BITINT_MAXWIDTH=64"];
/** Each stage gets a new module/virtual filesystem. No host process or network API. */
export async function compileC(input: CBuildInput, tools: Record<ToolName, ToolFactory>, assets: Record<string,string>): Promise<CBuildResult> {
  const start = performance.now(), { project, files: sources } = validateBuildInput(input);
  const files = new Map<string,Uint8Array>(sources.map(file => [file.path,new TextEncoder().encode(file.text)]));
  let diagnostics = "", maxStageHeapBytes = 0;
  const text = (name: string) => { const bytes = files.get(name); if (!bytes) throw new Error(`缺少构建产物 ${name}`); return new TextDecoder("utf-8",{fatal:true}).decode(bytes); };
  async function stage(name: ToolName, args: string[], stdin = "") {
    let stdout = "", stderr = "", offset = 0;
    const bytes = new TextEncoder().encode(stdin);
    const append = (current: string, line: string) => { if (current.length + line.length > 1024*1024) throw new Error("编译器输出超过 1 MiB"); return current + line + "\n"; };
    const tool = await tools[name]({ thisProgram: `/tools/${name}`, print: line => { stdout=append(stdout,line); }, printErr: line => { stderr=append(stderr,line); }, stdin: () => offset < bytes.length ? bytes[offset++]! : null });
    const write = (path: string, data: string | Uint8Array) => { tool.FS.mkdirTree(path.slice(0,path.lastIndexOf("/"))); tool.FS.writeFile(path,data); };
    for (const [path,data] of Object.entries(assets)) write(path,Uint8Array.from(atob(data),c=>c.charCodeAt(0)));
    for (const [path,data] of files) write(`/work/${path}`,data);
    tool.FS.chdir("/work");
    const code = tool.callMain(args);
    maxStageHeapBytes = Math.max(maxStageHeapBytes,tool.heapBytes());
    diagnostics=append(diagnostics,stderr);
    if (code !== 0) throw new Error(`${name} 退出 ${code}\n${stderr}`);
    for (const path of tool.FS.readdir("/work")) if (/\.(?:asm|adb|rel|lst|ihx|cdb)$/.test(path)) {
      if (tool.FS.stat(`/work/${path}`).size > 1024*1024) throw new Error("阶段产物超过 1 MiB");
      files.set(path,tool.FS.readFile(`/work/${path}`));
    }
    if ([...files.values()].reduce((sum,data) => sum+data.length,0)>4*1024*1024) throw new Error("编译虚拟文件超过 4 MiB");
    return stdout;
  }
  const entry = project?.entry ?? sources[0]!.path;
  const units = project ? [project.sources.find(s => s.path===entry)!,...project.sources.filter(s => s.path!==entry)] : [{path:entry,language:"c"}];
  const rels: string[] = [];
  for (const unit of units) {
    const stem = unit.path.split("/").at(-1)!.replace(/\.[^.]+$/,"");
    let assembly=unit.path;
    if (unit.language==="c") {
      const preprocessed=await stage("sdcpp",["-E","-quiet","-nostdinc","-Wall","-std=c11","--obj-ext=.rel",...macros.map(m=>`-D${m}`),"-isystem","/sdk/include/mcs51","-isystem","/sdk/include",...(project?.includeDirs ?? []).map(dir=>`-I${dir}`),unit.path]);
      assembly=`${stem}.asm`;
      await stage("sdcc",["--c1mode","--c1-source",unit.path,...PROJECT_OPTIONS,"-o",assembly],preprocessed);
      checkBuildText(assembly,text(assembly),project,true);
    } else if (text(unit.path).match(/^\s*\.module\s+(\w+)/m)?.[1]!==stem) throw new Error("SDAS .module 必须与文件名一致");
    await stage("sdas8051",["-plosgffwy",`${stem}.rel`,assembly]); rels.push(`${stem}.rel`);
  }
  const stem=project ? "firmware" : entry.replace(/\.c$/,"");
  files.set(`${stem}.lk`,new TextEncoder().encode(["-muwx",`-i ${stem}.ihx`,"-M","-I 0x0080","-y","-b HOME = 0x0000","-b XSEG = 0x0001","-b PSEG = 0x0001","-b ISEG = 0x0000","-b BSEG = 0x0000","-k /sdk/lib","-l mcs51","-l libsdcc","-l libint","-l liblong","-l libfloat",...rels,"-e",""].join("\n")));
  await stage("sdld",["-nf",`${stem}.lk`]);
  const source=text(entry), ihx=text(`${stem}.ihx`), cdb=text(`${stem}.cdb`);
  if (project) {
    const module=entry.split("/").at(-1)!.replace(/\.c$/,"");
    const records=cdb.split(/^M:/m).find(section=>section.startsWith(`${module}\n`));
    if (!records || !/^F:G\$main\$0_0\$0\(/m.test(records)) throw new Error("入口 C 文件必须定义 main");
  }
  const inputs=await Promise.all(sources.map(async file=>({...file,sha256:await sha(file.text)})));
  const data: SdccDebugData={manifest:{format:"emuc51-sdcc-debug",version:project?2:1,compiler:"SDCC 4.5.0 #15242",target:"classic-8051",options:[...PROJECT_OPTIONS],
    files:{source:{name:entry,sha256:await sha(source)},ihx:{name:`${stem}.ihx`,sha256:await sha(ihx)},cdb:{name:`${stem}.cdb`,sha256:await sha(cdb)}},...(project?{projectSha256:await sha(JSON.stringify(project))}:{})},source,ihx,cdb,...(project?{project,inputs}:{})};
  await verifySdccDebug(data);
  return {data,milliseconds:performance.now()-start,maxStageHeapBytes,diagnostics:diagnostics.trim()};
}
