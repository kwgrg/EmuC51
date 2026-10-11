import { describe, expect, it } from "vitest";
import { assemble, ASM_EXAMPLE, MAX_ASM_SOURCE, normalizeAsmProject } from "../../src/core/assembler";
import { disassembleInstruction } from "../../src/core/disassembler";
import { Cpu8051 } from "../../src/core/cpu";
import { OPCODE_META } from "../../src/core/opcodes";

const bytes = (source: string) => {
  const result = assemble(source);
  expect(result.diagnostics).toEqual([]);
  return [...result.bytes!];
};
describe("bounded classic 8051 assembler", () => {
  it("assembles and executes the documented subroutine example", () => {
    expect(bytes(ASM_EXAMPLE)).toEqual([0x74, 0, 0x12, 0, 7, 0x80, 0xfb, 4, 0xf5, 0x90, 0x22]);
    const cpu = new Cpu8051(assemble(ASM_EXAMPLE).bytes!);
    for (let i = 0; i < 11; i++) cpu.step();
    expect(cpu.state()).toMatchObject({ acc: 2, pc: 2, sp: 7 });
    expect(cpu.memory.readSfrLatch(0x90)).toBe(2);
  });
  it("re-encodes all 255 legal forms from the shared decoder at nonzero addresses", () => {
    for (const meta of OPCODE_META.filter(item => item.legal)) {
      const program = new Uint8Array(65536);
      program.set([meta.opcode, 0x34, 0x56], 0x1230);
      const decoded = disassembleInstruction(program, 0x1230);
      const result = assemble(`ORG 0x1230\n${decoded.text}`);
      expect(result.diagnostics, decoded.text).toEqual([]);
      expect([...result.bytes!.slice(0x1230)], decoded.text).toEqual(decoded.bytes);
    }
  });
  it("encodes MOV reversed direct operands, immediates, bits, relative branches and 11-bit page bits", () => {
    expect(bytes("MOV 30h,40h\nMOV DPTR,#1234h\nANL C,/88h\nDJNZ R7,$\nCJNE A,#5,$")).toEqual([0x85,0x40,0x30,0x90,0x12,0x34,0xb0,0x88,0xdf,0xfe,0xb4,5,0xfd]);
    expect(bytes("ORG 07FEh\nAJMP 0800h").slice(-2)).toEqual([1,0]);
    expect(bytes("ORG 0F800h\nACALL 0FFFFh").slice(-2)).toEqual([0xf1,0xff]);
    expect(bytes("ORG 0FFFEh\nSJMP 0").slice(-2)).toEqual([0x80,0]);
    expect(bytes("SJMP 0FFFFh")).toEqual([0x80,0xfd]);
  });
  it("supports forward instruction/data labels, known EQU/ORG, constants, comments and zero-filled gaps", () => {
    expect(bytes("\uFEFFbase EQU 0x10\r\nORG base\nLJMP later\nDB 10101010b,255,0ffh\nlater: DW base+1,later-1\nEND\n; done").slice(16)).toEqual([2,0,22,170,255,255,0,17,0,21]);
    expect(bytes("DB LAST\nLAST: NOP")).toEqual([1,0]);
    expect(bytes("ORG 2\nDB 1\nORG 0\nDB 2")).toEqual([2,0,1]);
    expect(bytes("DB 0A5h")).toEqual([0xa5]);
  });
  it.each([
    ["MOV A,#256", "不自动截断"], ["MOV 256,A", "不自动截断"], ["DB -1", "不自动截断"],
    ["DW 65536", "不自动截断"], ["ORG 65536", "不自动截断"], ["ORG -1", "不自动截断"],
    ["SJMP 130", "相对跳转"], ["ORG 1000\nSJMP 873", "相对跳转"],
    ["AJMP 0800h", "2 KiB"], ["ORG 0FFFEh\nLJMP 0", "超出"],
    ["DB 1\nORG 0\nDB 1", "重叠"], ["a1: NOP\nA1: NOP", "重复"],
    ["P1: NOP", "保留"], ["MOV A,#missing", "未定义"], ["ORG later\nlater: NOP", "未定义"],
    ["X EQU Y\nY EQU X", "未定义"], ["DB 1,,2", "不能为空"], ["DB 1,", "不能为空"],
    ["MOV A,#", "不完整"], ["DB 1+", "不完整"], ["DB 1*2", "仅支持"], ["DB 'abc'", "需要整数"],
    ["SETB P1.0", "仅支持"], ["INCLUDE x.asm", "不支持"], ["END\nNOP", "END 后"],
    ["RESERVED", "不支持"], ["; empty", "没有生成"], ["\n".repeat(8192), "8192"],
    ["x".repeat(MAX_ASM_SOURCE+1), "65536"],
  ])("rejects invalid input without returning partial bytes: %s", (source, message) => {
    const result = assemble(source);
    expect(result.bytes).toBeUndefined();
    expect(result.diagnostics.some(d => d.message.includes(message))).toBe(true);
  });
  it("reports actual token columns and caps diagnostics", () => {
    expect(assemble("NOP\n  MOV A,#missing").diagnostics).toEqual([{ line: 2, column: 10, message: "未定义符号 MISSING" }]);
    expect(assemble("INVALID\n".repeat(100)).diagnostics).toHaveLength(50);
    expect(normalizeAsmProject({ name: "../bad.asm", source: "NOP" })).toBeUndefined();
    expect(normalizeAsmProject({ name: "main.asm", source: "NOP", extra: true })).toEqual({ name: "main.asm", source: "NOP" });
  });
});

describe("assembler-owned source maps", () => {
  it("maps emitted instruction/data spans exactly without mapping ORG gaps, comments, EQU or label-only lines", () => {
    const source="; comment\r\nBASE EQU 10h\rORG BASE\nENTRY:\n  MOV A,#42h\nDB 0,1\nDW 1234h\nORG 0\nLJMP ENTRY\nEND";
    const result=assemble(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.sourceMap).toEqual([
      {line:5,column:3,address:16,length:2,kind:"instruction"},
      {line:6,column:1,address:18,length:2,kind:"data"},
      {line:7,column:1,address:20,length:2,kind:"data"},
      {line:9,column:1,address:0,length:3,kind:"instruction"},
    ]);
  });
  it("maps an end-of-CODE instruction without wrapping or inventing operand-byte locations", () => {
    expect(assemble("ORG 0FFFEh\nSJMP 0").sourceMap).toEqual([{line:2,column:1,address:65534,length:2,kind:"instruction"}]);
    expect(assemble("\uFEFFentry: NOP").sourceMap).toEqual([{line:1,column:8,address:0,length:1,kind:"instruction"}]);
  });
  it.each(["NOP\nMOV A,#missing", "NOP\nORG 0\nNOP", "NOP\nBAD", "ORG 1234h"])("does not publish partial mapping after failure: %s", source => {
    const result=assemble(source); expect(result.bytes).toBeUndefined(); expect(result.sourceMap).toBeUndefined(); expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
