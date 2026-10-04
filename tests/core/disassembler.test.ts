import { describe, expect, it } from "vitest";
import { disassemble, disassembleInstruction } from "../../src/core/disassembler";

// Independent instruction listing for bytes [opcode, 34, FE] at CODE address 1234.
const expectedInstructions = [
  "NOP|AJMP 0x1034|LJMP 0x34FE|RR A|INC A|INC 0x34|INC @R0|INC @R1|INC R0|INC R1|INC R2|INC R3|INC R4|INC R5|INC R6|INC R7",
  "JBC 0x34,0x1235|ACALL 0x1034|LCALL 0x34FE|RRC A|DEC A|DEC 0x34|DEC @R0|DEC @R1|DEC R0|DEC R1|DEC R2|DEC R3|DEC R4|DEC R5|DEC R6|DEC R7",
  "JB 0x34,0x1235|AJMP 0x1134|RET|RL A|ADD A,#0x34|ADD A,0x34|ADD A,@R0|ADD A,@R1|ADD A,R0|ADD A,R1|ADD A,R2|ADD A,R3|ADD A,R4|ADD A,R5|ADD A,R6|ADD A,R7",
  "JNB 0x34,0x1235|ACALL 0x1134|RETI|RLC A|ADDC A,#0x34|ADDC A,0x34|ADDC A,@R0|ADDC A,@R1|ADDC A,R0|ADDC A,R1|ADDC A,R2|ADDC A,R3|ADDC A,R4|ADDC A,R5|ADDC A,R6|ADDC A,R7",
  "JC 0x126A|AJMP 0x1234|ORL 0x34,A|ORL 0x34,#0xFE|ORL A,#0x34|ORL A,0x34|ORL A,@R0|ORL A,@R1|ORL A,R0|ORL A,R1|ORL A,R2|ORL A,R3|ORL A,R4|ORL A,R5|ORL A,R6|ORL A,R7",
  "JNC 0x126A|ACALL 0x1234|ANL 0x34,A|ANL 0x34,#0xFE|ANL A,#0x34|ANL A,0x34|ANL A,@R0|ANL A,@R1|ANL A,R0|ANL A,R1|ANL A,R2|ANL A,R3|ANL A,R4|ANL A,R5|ANL A,R6|ANL A,R7",
  "JZ 0x126A|AJMP 0x1334|XRL 0x34,A|XRL 0x34,#0xFE|XRL A,#0x34|XRL A,0x34|XRL A,@R0|XRL A,@R1|XRL A,R0|XRL A,R1|XRL A,R2|XRL A,R3|XRL A,R4|XRL A,R5|XRL A,R6|XRL A,R7",
  "JNZ 0x126A|ACALL 0x1334|ORL C,0x34|JMP @A+DPTR|MOV A,#0x34|MOV 0x34,#0xFE|MOV @R0,#0x34|MOV @R1,#0x34|MOV R0,#0x34|MOV R1,#0x34|MOV R2,#0x34|MOV R3,#0x34|MOV R4,#0x34|MOV R5,#0x34|MOV R6,#0x34|MOV R7,#0x34",
  "SJMP 0x126A|AJMP 0x1434|ANL C,0x34|MOVC A,@A+PC|DIV AB|MOV 0xFE,0x34|MOV 0x34,@R0|MOV 0x34,@R1|MOV 0x34,R0|MOV 0x34,R1|MOV 0x34,R2|MOV 0x34,R3|MOV 0x34,R4|MOV 0x34,R5|MOV 0x34,R6|MOV 0x34,R7",
  "MOV DPTR,#0x34FE|ACALL 0x1434|MOV 0x34,C|MOVC A,@A+DPTR|SUBB A,#0x34|SUBB A,0x34|SUBB A,@R0|SUBB A,@R1|SUBB A,R0|SUBB A,R1|SUBB A,R2|SUBB A,R3|SUBB A,R4|SUBB A,R5|SUBB A,R6|SUBB A,R7",
  "ORL C,/0x34|AJMP 0x1534|MOV C,0x34|INC DPTR|MUL AB|DB 0xA5 ; RESERVED|MOV @R0,0x34|MOV @R1,0x34|MOV R0,0x34|MOV R1,0x34|MOV R2,0x34|MOV R3,0x34|MOV R4,0x34|MOV R5,0x34|MOV R6,0x34|MOV R7,0x34",
  "ANL C,/0x34|ACALL 0x1534|CPL 0x34|CPL C|CJNE A,#0x34,0x1235|CJNE A,0x34,0x1235|CJNE @R0,#0x34,0x1235|CJNE @R1,#0x34,0x1235|CJNE R0,#0x34,0x1235|CJNE R1,#0x34,0x1235|CJNE R2,#0x34,0x1235|CJNE R3,#0x34,0x1235|CJNE R4,#0x34,0x1235|CJNE R5,#0x34,0x1235|CJNE R6,#0x34,0x1235|CJNE R7,#0x34,0x1235",
  "PUSH 0x34|AJMP 0x1634|CLR 0x34|CLR C|SWAP A|XCH A,0x34|XCH A,@R0|XCH A,@R1|XCH A,R0|XCH A,R1|XCH A,R2|XCH A,R3|XCH A,R4|XCH A,R5|XCH A,R6|XCH A,R7",
  "POP 0x34|ACALL 0x1634|SETB 0x34|SETB C|DA A|DJNZ 0x34,0x1235|XCHD A,@R0|XCHD A,@R1|DJNZ R0,0x126A|DJNZ R1,0x126A|DJNZ R2,0x126A|DJNZ R3,0x126A|DJNZ R4,0x126A|DJNZ R5,0x126A|DJNZ R6,0x126A|DJNZ R7,0x126A",
  "MOVX A,@DPTR|AJMP 0x1734|MOVX A,@R0|MOVX A,@R1|CLR A|MOV A,0x34|MOV A,@R0|MOV A,@R1|MOV A,R0|MOV A,R1|MOV A,R2|MOV A,R3|MOV A,R4|MOV A,R5|MOV A,R6|MOV A,R7",
  "MOVX @DPTR,A|ACALL 0x1734|MOVX @R0,A|MOVX @R1,A|CPL A|MOV 0x34,A|MOV @R0,A|MOV @R1,A|MOV R0,A|MOV R1,A|MOV R2,A|MOV R3,A|MOV R4,A|MOV R5,A|MOV R6,A|MOV R7,A",
].flatMap((row) => row.split("|"));
const expectedLengths = [
  "1231121111111111", "3231121111111111", "3211221111111111", "3211221111111111",
  "2223221111111111", "2223221111111111", "2223221111111111", "2221232222222222",
  "2221132222222222", "3221221111111111", "2221112222222222", "2221333333333333",
  "2221121111111111", "2221131122222222", "1211121111111111", "1211121111111111",
].join("").split("").map(Number);

describe("8051 反汇编", () => {
  it("对所有 256 个编码还原实际操作数、指令长度及合法性", () => {
    expect(expectedInstructions).toHaveLength(256);
    expect(expectedLengths).toHaveLength(256);
    const program = new Uint8Array(0x1237);
    program[0x1235] = 0x34;
    program[0x1236] = 0xfe;
    for (let opcode = 0; opcode <= 0xff; opcode += 1) {
      program[0x1234] = opcode;
      const instruction = disassembleInstruction(program, 0x1234);
      expect(instruction, `opcode 0x${opcode.toString(16)}`).toEqual({
        address: 0x1234,
        bytes: [opcode, 0x34, 0xfe].slice(0, expectedLengths[opcode]),
        text: expectedInstructions[opcode],
        length: expectedLengths[opcode],
        legal: opcode !== 0xa5,
      });
    }
  });

  it("按指令数推进地址并在保留编码之后继续反汇编", () => {
    const program = Uint8Array.from([0x74, 0x42, 0xa5, 0x90, 0x12, 0x34, 0x80, 0xf8]);
    expect(disassemble(program, 0, 4).map(({ address, text }) => ({ address, text }))).toEqual([
      { address: 0, text: "MOV A,#0x42" },
      { address: 2, text: "DB 0xA5 ; RESERVED" },
      { address: 3, text: "MOV DPTR,#0x1234" },
      { address: 6, text: "SJMP 0x0000" },
    ]);
  });

  it("AJMP 和 ACALL 使用下一条指令所在的 2 KiB 页面", () => {
    const program = new Uint8Array(0x10000);
    program.set([0xe1, 0xab], 0x07fe);
    expect(disassembleInstruction(program, 0x07fe).text).toBe("AJMP 0x0FAB");
    program.set([0xf1, 0xcd], 0xfffe);
    expect(disassembleInstruction(program, 0xfffe).text).toBe("ACALL 0x07CD");
  });

  it("相对跳转按有符号偏移计算，并在 16 位边界回绕", () => {
    const program = new Uint8Array(0x10000);
    program.set([0x80, 0x80], 0);
    expect(disassembleInstruction(program, 0).text).toBe("SJMP 0xFF82");
    program.set([0x80, 0x7f], 0xfffe);
    expect(disassembleInstruction(program, 0xfffe).text).toBe("SJMP 0x007F");
  });

  it("跨越 FFFF 的操作数字节及下一条指令回到地址 0000", () => {
    const program = new Uint8Array(0x10000);
    program[0xffff] = 0x02;
    program.set([0x12, 0x34, 0x00], 0);
    expect(disassemble(program, 0xffff, 2)).toEqual([
      { address: 0xffff, bytes: [0x02, 0x12, 0x34], text: "LJMP 0x1234", length: 3, legal: true },
      { address: 2, bytes: [0], text: "NOP", length: 1, legal: true },
    ]);
  });

  it("未加载 CODE 字节补零，输入数组保持不变", () => {
    const program = Uint8Array.from([0x90]);
    expect(disassemble(program, 0, 2)).toEqual([
      { address: 0, bytes: [0x90, 0, 0], text: "MOV DPTR,#0x0000", length: 3, legal: true },
      { address: 3, bytes: [0], text: "NOP", length: 1, legal: true },
    ]);
    expect(program).toEqual(Uint8Array.from([0x90]));
    expect(disassemble(new Uint8Array(), 0, 0)).toEqual([]);
  });

  it("归一化整数地址并拒绝无效参数及过大固件", () => {
    expect(disassembleInstruction(Uint8Array.from([0]), 0x10000).address).toBe(0);
    expect(disassembleInstruction(new Uint8Array(), -1).address).toBe(0xffff);
    for (const start of [NaN, Infinity, 0.5]) {
      expect(() => disassemble(new Uint8Array(), start, 1)).toThrow("地址必须是整数");
      expect(() => disassembleInstruction(new Uint8Array(), start)).toThrow("地址必须是整数");
    }
    for (const count of [-1, 0.5, Infinity, 0x10001]) {
      expect(() => disassemble(new Uint8Array(), 0, count)).toThrow("指令数必须");
    }
    expect(() => disassemble(new Uint8Array(0x10001), 0, 1)).toThrow("64 KiB");
  });
});
