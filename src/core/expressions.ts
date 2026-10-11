import type { Cpu8051 } from "./cpu";
import { SFR } from "./memory";

export const MAX_WATCH_EXPRESSIONS = 32;
export const MAX_EXPRESSION_LENGTH = 256;
export interface WatchResult { expression: string; value?: number; error?: string }

const precedence: Record<string, number> = { "|": 1, "^": 2, "&": 3, "<<": 4, ">>": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
const fail = (message: string): never => { throw new Error(message); };
const checked = (value: number): number => Number.isSafeInteger(value) ? value : fail("整数溢出");

/** Bounded integer grammar; no JavaScript evaluation, assignments or calls. */
export function evaluateExpression(cpu: Cpu8051, expression: string): number {
  if (typeof expression !== "string" || expression.length > MAX_EXPRESSION_LENGTH) fail("表达式最多 256 字符");
  const tokens: string[] = [];
  let remaining = expression.trim();
  while (remaining) {
    const token = /^(0x[0-9a-f]+|[0-9]+|[a-z_][a-z0-9_]*|<<|>>|[()+\-*/%&|^~[\]])/i.exec(remaining)?.[0];
    if (!token) fail(`不支持的字符：${remaining[0]}`);
    tokens.push(token!);
    if (tokens.length > 128) fail("表达式最多 128 个词元");
    remaining = remaining.slice(token!.length).trimStart();
  }
  let index = 0;
  const expect = (token: string) => { if (tokens[index++] !== token) fail(`缺少 ${token}`); };
  const nameValue = (name: string): number => {
    if (name === "PC") return cpu.pc;
    if (name === "DPTR") return (cpu.memory.readSfrLatch(SFR.DPH) << 8) | cpu.memory.readSfrLatch(SFR.DPL);
    if (/^R[0-7]$/.test(name)) return cpu.memory.iram[((cpu.memory.readSfrLatch(SFR.PSW) >> 3) & 3) * 8 + Number(name[1])]!;
    const key = name === "A" ? "ACC" : name;
    if (Object.hasOwn(SFR, key)) return cpu.memory.readSfrLatch(SFR[key as keyof typeof SFR]);
    return fail(`未知名称：${name}；不支持源码符号`);
  };
  const memoryValue = (space: string, address: number): number => {
    const max = space === "IRAM" ? 0x7f : space === "SFR" ? 0xff : 0xffff;
    const min = space === "SFR" ? 0x80 : 0;
    if (!Number.isInteger(address) || address < min || address > max) fail(`${space} 地址越界`);
    switch (space) {
      case "IRAM": return cpu.memory.readIndirect(address);
      case "SFR": return cpu.memory.readSfrLatch(address);
      case "XRAM": return cpu.memory.readXram(address);
      case "CODE": return cpu.memory.readCode(address);
      default: return fail(`未知内存空间：${space}`);
    }
  };
  const parse = (minimum = 1, depth = 0): number => {
    if (depth > 16) fail("表达式嵌套最多 16 层");
    const token = tokens[index++];
    if (!token) return fail("缺少操作数");
    let left: number;
    if (token === "(") { left = parse(1, depth + 1); expect(")"); }
    else if (["+", "-", "~"].includes(token)) {
      const value = parse(7, depth + 1);
      left = token === "~" ? (~value >>> 0) : token === "-" ? -value : value;
    } else if (/^(0x[0-9a-f]+|[0-9]+)$/i.test(token)) left = checked(Number(token));
    else if (/^[a-z_][a-z0-9_]*$/i.test(token)) {
      const name = token.toUpperCase();
      if (tokens[index] === "[") {
        index += 1;
        const address = parse(1, depth + 1);
        expect("]");
        left = memoryValue(name, address);
      } else left = nameValue(name);
    } else return fail(`无效操作数：${token}`);
    while (index < tokens.length) {
      const operator = tokens[index]!;
      const priority = Object.hasOwn(precedence, operator) ? precedence[operator] : undefined;
      if (priority === undefined || priority < minimum) break;
      index += 1;
      const right = parse(priority + 1, depth + 1);
      switch (operator) {
        case "+": left += right; break;
        case "-": left -= right; break;
        case "*": left *= right; break;
        case "/": if (right === 0) fail("不能除以零"); left = Math.trunc(left / right); break;
        case "%": if (right === 0) fail("不能对零取余"); left %= right; break;
        case "&": left = (left & right) >>> 0; break;
        case "|": left = (left | right) >>> 0; break;
        case "^": left = (left ^ right) >>> 0; break;
        case "<<": case ">>":
          if (right < 0 || right > 31) fail("移位位数须为 0 到 31");
          left = operator === "<<" ? (left << right) >>> 0 : left >>> right;
          break;
      }
      left = checked(left);
    }
    return checked(left);
  };
  const value = parse();
  if (index !== tokens.length) fail(`多余或不支持的语法：${tokens[index]}`);
  return value;
}

export const evaluateWatch = (cpu: Cpu8051, expressions: string[]): WatchResult[] => expressions.map((expression) => {
  try { return { expression, value: evaluateExpression(cpu, expression) }; }
  catch (error) { return { expression, error: error instanceof Error ? error.message : "表达式无效" }; }
});
