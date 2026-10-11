import { OPCODE_META, type OpcodeMeta } from "./opcodes";
import { SFR } from "./memory";

export const ASSEMBLER_VERSION = "emuc51-asm-1";
export const MAX_ASM_SOURCE = 65536;
export const MAX_ASM_LINES = 8192;
export interface AsmDiagnostic { line: number; column: number; message: string }
export interface AsmProject { name: string; source: string }
export interface AsmBinding { sourceSha256: string; firmwareSha256: string; assembler: typeof ASSEMBLER_VERSION }
export interface AsmLocation { line: number; column: number; address: number; length: number; kind: "instruction" | "data" }
export interface AsmResult { bytes?: Uint8Array<ArrayBuffer>; sourceMap?: AsmLocation[]; diagnostics: AsmDiagnostic[] }
export interface AsmArtifact { project: AsmProject; bytes: ArrayBuffer; binding: AsmBinding; sourceMap: AsmLocation[] }
export const ASM_EXAMPLE = `; 单文件经典 8051 示例：调用子程序后循环递增 A\nORG 0\n    MOV A,#0\nLOOP:\n    LCALL INCREMENT\n    SJMP LOOP\nINCREMENT:\n    INC A\n    MOV P1,A\n    RET\nEND\n`;

export function normalizeAsmProject(value: unknown): AsmProject | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as AsmProject;
  if (typeof p.name !== "string" || !/^[\w\-.]{1,80}\.asm$/i.test(p.name) || typeof p.source !== "string" || p.source.length > MAX_ASM_SOURCE) return undefined;
  return { name: p.name, source: p.source };
}

class Diagnostic extends Error {
  constructor(readonly column: number, message: string) { super(message); }
}
interface Operand { text: string; column: number }
interface Statement { line: number; column: number; address: number; op: string; operands: Operand[]; meta?: OpcodeMeta }
const registers = /^(A|C|AB|DPTR|R[0-7])$/;
const placeholders = new Set(["direct", "bit", "/bit", "#data", "#data16", "addr11", "addr16", "rel"]);
const forms = OPCODE_META.filter(meta => meta.legal && (!/^(AJMP|ACALL)/.test(meta.mnemonic) || meta.opcode < 0x20)).map(meta => {
  const [op, args = ""] = meta.mnemonic.split(" ");
  return { meta, op, args: args ? args.split(",") : [] };
});
const reserved = new Set([...forms.map(form => form.op), "ORG", "DB", "DW", "EQU", "END", "A", "C", "AB", "DPTR", ...Array.from({ length: 8 }, (_, i) => `R${i}`), ...Object.keys(SFR)]);

/** Deliberately small constant grammar: numeric/symbol/$ atoms with unary +/- and binary +/-. */
function expression(operand: Operand, symbols: Map<string, number>, pc: number): number {
  const text = operand.text.toUpperCase();
  let index = 0;
  let total = 0;
  let sign = 1;
  let first = true;
  while (index < text.length) {
    while (/\s/.test(text[index] ?? "") && index < text.length) index++;
    if (first && (text[index] === "+" || text[index] === "-")) sign = text[index++] === "-" ? -1 : 1;
    while (/\s/.test(text[index] ?? "") && index < text.length) index++;
    const start = index;
    const token = /^(?:0X[0-9A-F]+|[0-9][0-9A-F]*H|[01]+B|[0-9]+|[A-Z_][A-Z0-9_]*|\$)/.exec(text.slice(index))?.[0];
    if (!token) throw new Diagnostic(operand.column + index, "需要整数、标签或常量；表达式仅支持 + 和 -");
    index += token.length;
    let value: number | undefined;
    if (token === "$") value = pc;
    else if (/^0X/.test(token)) value = Number.parseInt(token.slice(2), 16);
    else if (/^[0-9].*H$/.test(token)) value = Number.parseInt(token.slice(0, -1), 16);
    else if (/^[01]+B$/.test(token)) value = Number.parseInt(token.slice(0, -1), 2);
    else if (/^[0-9]+$/.test(token)) value = Number(token);
    else value = symbols.get(token);
    if (value === undefined) throw new Diagnostic(operand.column + start, `未定义符号 ${token}`);
    total += sign * value;
    if (!Number.isSafeInteger(total)) throw new Diagnostic(operand.column + start, "整数超出安全范围");
    while (/\s/.test(text[index] ?? "") && index < text.length) index++;
    if (index === text.length) return total;
    if (text[index] !== "+" && text[index] !== "-") throw new Diagnostic(operand.column + index, "表达式仅支持 + 和 -（不支持位名、字符串或宏）");
    sign = text[index++] === "-" ? -1 : 1;
    first = false;
  }
  throw new Diagnostic(operand.column + index, "表达式不完整");
}
function range(value: number, maximum: number, operand: Operand, name: string): number {
  if (value < 0 || value > maximum) throw new Diagnostic(operand.column, `${name}须在 0..${maximum} 范围内，不自动截断`);
  return value;
}
function matches(form: string, input: string): boolean {
  const compact = input.toUpperCase().replace(/\s/g, "");
  if (!placeholders.has(form)) return compact === form;
  if (form.startsWith("#")) return compact.startsWith("#");
  if (form === "/bit") return compact.startsWith("/");
  return !/^[#/@]/.test(compact) && !registers.test(compact);
}

/** Two-pass assembler; no JS evaluation, imports, macros, files or implicit branch expansion. */
export function assemble(source: string): AsmResult {
  const diagnostics: AsmDiagnostic[] = [];
  const fail = (line: number, error: unknown) => {
    if (diagnostics.length < 50) diagnostics.push({ line, column: error instanceof Diagnostic ? error.column : 1, message: error instanceof Error ? error.message : "汇编失败" });
  };
  if (typeof source !== "string" || source.length > MAX_ASM_SOURCE) return { diagnostics: [{ line: 1, column: 1, message: "源码最多 65536 个字符" }] };
  const lines = source.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (lines.length > MAX_ASM_LINES) return { diagnostics: [{ line: 1, column: 1, message: "源码最多 8192 行" }] };
  const symbols = new Map<string, number>(Object.entries(SFR));
  const statements: Statement[] = [];
  let pc = 0;
  let ended = false;
  const define = (name: string, value: number, column: number) => {
    if (symbols.has(name) || reserved.has(name)) throw new Diagnostic(column, `重复或保留符号 ${name}`);
    if (value > 0xffff || value < 0) throw new Diagnostic(column, "符号值须在 0..65535 范围内");
    symbols.set(name, value);
  };
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.split(";")[0]!;
    if (!text.trim()) continue;
    try {
      if (ended) throw new Diagnostic(1, "END 后只能有空行或注释");
      let offset = text.search(/\S/);
      const equ = /^([A-Za-z_][\w]*)\s+EQU\s+(.+)$/i.exec(text.slice(offset));
      if (equ) {
        const column = offset + equ[0].lastIndexOf(equ[2]!) + 1;
        define(equ[1]!.toUpperCase(), expression({ text: equ[2]!, column }, symbols, pc), offset + 1);
        continue;
      }
      const label = /^([A-Za-z_][\w]*):/.exec(text.slice(offset));
      if (label) {
        define(label[1]!.toUpperCase(), pc, offset + 1);
        offset += label[0].length;
        while (/\s/.test(text[offset] ?? "") && offset < text.length) offset++;
        if (offset === text.length) continue;
      }
      const word = /^[A-Za-z]+\b/.exec(text.slice(offset));
      if (!word) throw new Diagnostic(offset + 1, "需要指令、伪指令或带冒号的标签");
      const op = word[0].toUpperCase();
      const column = offset + 1;
      offset += word[0].length;
      const operands: Operand[] = [];
      if (text.slice(offset).trim()) {
        for (const part of text.slice(offset).split(",")) {
          const start = part.search(/\S/);
          if (start < 0) throw new Diagnostic(offset + 1, "操作数不能为空");
          operands.push({ text: part.trim(), column: offset + start + 1 });
          offset += part.length + 1;
        }
      }
      if (op === "END") {
        if (operands.length) throw new Diagnostic(column, "END 不接受操作数");
        ended = true; continue;
      }
      if (op === "ORG") {
        if (operands.length !== 1) throw new Diagnostic(column, "ORG 需要一个已知地址，不支持前向引用");
        pc = range(expression(operands[0]!, symbols, pc), 0xffff, operands[0]!, "ORG 地址");
        continue;
      }
      let meta: OpcodeMeta | undefined;
      let length: number;
      if (op === "DB" || op === "DW") {
        if (!operands.length) throw new Diagnostic(column, `${op} 需要整数列表，不支持字符串`);
        length = operands.length * (op === "DW" ? 2 : 1);
      } else {
        const candidates = forms.filter(form => form.op === op && form.args.length === operands.length && form.args.every((arg, index) => matches(arg, operands[index]!.text)));
        // Prefer fixed register syntax, e.g. MOV A,R0 over MOV direct,R0.
        candidates.sort((a, b) => a.args.filter(arg => placeholders.has(arg)).length - b.args.filter(arg => placeholders.has(arg)).length);
        meta = candidates[0]?.meta;
        if (!meta) throw new Diagnostic(column, `不支持的指令或操作数形式：${op}`);
        length = meta.length;
      }
      if (pc + length > 0x10000) throw new Diagnostic(column, "指令或数据超出 64 KiB CODE 空间，不允许跨末尾编码");
      statements.push({ line: i + 1, column, address: pc, op, operands, meta });
      pc += length;
    } catch (error) { fail(i + 1, error); }
  }
  if (diagnostics.length) return { diagnostics };
  const sourceMap: AsmLocation[] = [];
  const output = new Uint8Array(0x10000);
  const written = new Uint8Array(0x10000);
  let end = 0;
  for (const statement of statements) {
    try {
      const { address, op, operands, meta } = statement;
      const encoded: number[] = [];
      if (!meta) {
        for (const operand of operands) {
          const value = range(expression(operand, symbols, address + encoded.length), op === "DW" ? 0xffff : 0xff, operand, op);
          if (op === "DW") encoded.push(value >> 8);
          encoded.push(value & 0xff);
        }
      } else {
        encoded.push(meta.opcode);
        const args = meta.mnemonic.split(" ")[1]?.split(",") ?? [];
        for (let i = 0; i < args.length; i++) {
          const arg = args[i]!;
          if (!placeholders.has(arg)) continue;
          const original = operands[i]!;
          const prefixed = arg.startsWith("#") || arg === "/bit";
          const operand = { text: original.text.slice(prefixed ? 1 : 0), column: original.column + (prefixed ? 1 : 0) };
          const value = range(expression(operand, symbols, address), ["addr11", "addr16", "rel", "#data16"].includes(arg) ? 0xffff : 0xff, operand, arg);
          if (arg === "rel") {
            const delta = (value - ((address + meta.length) & 0xffff) + 0x10000) & 0xffff;
            if (delta > 127 && delta < 0xff80) throw new Diagnostic(operand.column, "相对跳转超出 -128..127 字节范围");
            encoded.push(delta & 0xff);
          } else if (arg === "addr11") {
            if ((value & 0xf800) !== ((address + meta.length) & 0xf800)) throw new Diagnostic(operand.column, "AJMP/ACALL 目标必须与下一条指令同一 2 KiB 页");
            encoded[0] = meta.opcode | ((value >> 3) & 0xe0);
            encoded.push(value & 0xff);
          } else {
            if (arg === "addr16" || arg === "#data16") encoded.push(value >> 8);
            encoded.push(value & 0xff);
          }
        }
        if (meta.opcode === 0x85) [encoded[1], encoded[2]] = [encoded[2]!, encoded[1]!];
      }
      for (let i = 0; i < encoded.length; i++) {
        if (written[address + i]) throw new Diagnostic(statement.column, `CODE 地址 0x${(address + i).toString(16)} 重叠`);
      }
      output.set(encoded, address);
      written.fill(1, address, address + encoded.length);
      end = Math.max(end, address + encoded.length);
      sourceMap.push({ line: statement.line, column: statement.column, address, length: encoded.length, kind: meta ? "instruction" : "data" });
    } catch (error) { fail(statement.line, error); }
  }
  if (!end && !diagnostics.length) fail(1, new Diagnostic(1, "源码没有生成任何字节"));
  return diagnostics.length ? { diagnostics } : { bytes: output.slice(0, end), sourceMap, diagnostics };
}
