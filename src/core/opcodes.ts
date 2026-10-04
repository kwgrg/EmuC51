export interface OpcodeMeta {
  opcode: number;
  length: 1 | 2 | 3;
  machineCycles: number;
  mnemonic: string;
  legal: boolean;
}

const buildOpcodeTable = (): readonly OpcodeMeta[] => {
  const table: Array<OpcodeMeta | undefined> = new Array(0x100);
  const set = (
    opcode: number,
    length: 1 | 2 | 3,
    machineCycles: number,
    mnemonic: string,
    legal = true,
  ): void => {
    table[opcode] = { opcode, length, machineCycles, mnemonic, legal };
  };
  const registers = (
    start: number,
    length: 1 | 2 | 3,
    cycles: number,
    mnemonic: (index: number) => string,
  ): void => {
    for (let index = 0; index < 8; index += 1) {
      set(start + index, length, cycles, mnemonic(index));
    }
  };

  set(0x00, 1, 1, "NOP");
  set(0x01, 2, 2, "AJMP addr11");
  set(0x02, 3, 2, "LJMP addr16");
  set(0x03, 1, 1, "RR A");
  set(0x04, 1, 1, "INC A");
  set(0x05, 2, 1, "INC direct");
  set(0x06, 1, 1, "INC @R0");
  set(0x07, 1, 1, "INC @R1");
  registers(0x08, 1, 1, (r) => `INC R${r}`);

  set(0x10, 3, 2, "JBC bit,rel");
  set(0x11, 2, 2, "ACALL addr11");
  set(0x12, 3, 2, "LCALL addr16");
  set(0x13, 1, 1, "RRC A");
  set(0x14, 1, 1, "DEC A");
  set(0x15, 2, 1, "DEC direct");
  set(0x16, 1, 1, "DEC @R0");
  set(0x17, 1, 1, "DEC @R1");
  registers(0x18, 1, 1, (r) => `DEC R${r}`);

  set(0x20, 3, 2, "JB bit,rel");
  set(0x21, 2, 2, "AJMP addr11");
  set(0x22, 1, 2, "RET");
  set(0x23, 1, 1, "RL A");
  set(0x24, 2, 1, "ADD A,#data");
  set(0x25, 2, 1, "ADD A,direct");
  set(0x26, 1, 1, "ADD A,@R0");
  set(0x27, 1, 1, "ADD A,@R1");
  registers(0x28, 1, 1, (r) => `ADD A,R${r}`);

  set(0x30, 3, 2, "JNB bit,rel");
  set(0x31, 2, 2, "ACALL addr11");
  set(0x32, 1, 2, "RETI");
  set(0x33, 1, 1, "RLC A");
  set(0x34, 2, 1, "ADDC A,#data");
  set(0x35, 2, 1, "ADDC A,direct");
  set(0x36, 1, 1, "ADDC A,@R0");
  set(0x37, 1, 1, "ADDC A,@R1");
  registers(0x38, 1, 1, (r) => `ADDC A,R${r}`);

  set(0x40, 2, 2, "JC rel");
  set(0x41, 2, 2, "AJMP addr11");
  set(0x42, 2, 1, "ORL direct,A");
  set(0x43, 3, 2, "ORL direct,#data");
  set(0x44, 2, 1, "ORL A,#data");
  set(0x45, 2, 1, "ORL A,direct");
  set(0x46, 1, 1, "ORL A,@R0");
  set(0x47, 1, 1, "ORL A,@R1");
  registers(0x48, 1, 1, (r) => `ORL A,R${r}`);

  set(0x50, 2, 2, "JNC rel");
  set(0x51, 2, 2, "ACALL addr11");
  set(0x52, 2, 1, "ANL direct,A");
  set(0x53, 3, 2, "ANL direct,#data");
  set(0x54, 2, 1, "ANL A,#data");
  set(0x55, 2, 1, "ANL A,direct");
  set(0x56, 1, 1, "ANL A,@R0");
  set(0x57, 1, 1, "ANL A,@R1");
  registers(0x58, 1, 1, (r) => `ANL A,R${r}`);

  set(0x60, 2, 2, "JZ rel");
  set(0x61, 2, 2, "AJMP addr11");
  set(0x62, 2, 1, "XRL direct,A");
  set(0x63, 3, 2, "XRL direct,#data");
  set(0x64, 2, 1, "XRL A,#data");
  set(0x65, 2, 1, "XRL A,direct");
  set(0x66, 1, 1, "XRL A,@R0");
  set(0x67, 1, 1, "XRL A,@R1");
  registers(0x68, 1, 1, (r) => `XRL A,R${r}`);

  set(0x70, 2, 2, "JNZ rel");
  set(0x71, 2, 2, "ACALL addr11");
  set(0x72, 2, 2, "ORL C,bit");
  set(0x73, 1, 2, "JMP @A+DPTR");
  set(0x74, 2, 1, "MOV A,#data");
  set(0x75, 3, 2, "MOV direct,#data");
  set(0x76, 2, 1, "MOV @R0,#data");
  set(0x77, 2, 1, "MOV @R1,#data");
  registers(0x78, 2, 1, (r) => `MOV R${r},#data`);

  set(0x80, 2, 2, "SJMP rel");
  set(0x81, 2, 2, "AJMP addr11");
  set(0x82, 2, 2, "ANL C,bit");
  set(0x83, 1, 2, "MOVC A,@A+PC");
  set(0x84, 1, 4, "DIV AB");
  set(0x85, 3, 2, "MOV direct,direct");
  set(0x86, 2, 2, "MOV direct,@R0");
  set(0x87, 2, 2, "MOV direct,@R1");
  registers(0x88, 2, 2, (r) => `MOV direct,R${r}`);

  set(0x90, 3, 2, "MOV DPTR,#data16");
  set(0x91, 2, 2, "ACALL addr11");
  set(0x92, 2, 2, "MOV bit,C");
  set(0x93, 1, 2, "MOVC A,@A+DPTR");
  set(0x94, 2, 1, "SUBB A,#data");
  set(0x95, 2, 1, "SUBB A,direct");
  set(0x96, 1, 1, "SUBB A,@R0");
  set(0x97, 1, 1, "SUBB A,@R1");
  registers(0x98, 1, 1, (r) => `SUBB A,R${r}`);

  set(0xa0, 2, 2, "ORL C,/bit");
  set(0xa1, 2, 2, "AJMP addr11");
  set(0xa2, 2, 1, "MOV C,bit");
  set(0xa3, 1, 2, "INC DPTR");
  set(0xa4, 1, 4, "MUL AB");
  set(0xa5, 1, 0, "RESERVED", false);
  set(0xa6, 2, 2, "MOV @R0,direct");
  set(0xa7, 2, 2, "MOV @R1,direct");
  registers(0xa8, 2, 2, (r) => `MOV R${r},direct`);

  set(0xb0, 2, 2, "ANL C,/bit");
  set(0xb1, 2, 2, "ACALL addr11");
  set(0xb2, 2, 1, "CPL bit");
  set(0xb3, 1, 1, "CPL C");
  set(0xb4, 3, 2, "CJNE A,#data,rel");
  set(0xb5, 3, 2, "CJNE A,direct,rel");
  set(0xb6, 3, 2, "CJNE @R0,#data,rel");
  set(0xb7, 3, 2, "CJNE @R1,#data,rel");
  registers(0xb8, 3, 2, (r) => `CJNE R${r},#data,rel`);

  set(0xc0, 2, 2, "PUSH direct");
  set(0xc1, 2, 2, "AJMP addr11");
  set(0xc2, 2, 1, "CLR bit");
  set(0xc3, 1, 1, "CLR C");
  set(0xc4, 1, 1, "SWAP A");
  set(0xc5, 2, 1, "XCH A,direct");
  set(0xc6, 1, 1, "XCH A,@R0");
  set(0xc7, 1, 1, "XCH A,@R1");
  registers(0xc8, 1, 1, (r) => `XCH A,R${r}`);

  set(0xd0, 2, 2, "POP direct");
  set(0xd1, 2, 2, "ACALL addr11");
  set(0xd2, 2, 1, "SETB bit");
  set(0xd3, 1, 1, "SETB C");
  set(0xd4, 1, 1, "DA A");
  set(0xd5, 3, 2, "DJNZ direct,rel");
  set(0xd6, 1, 1, "XCHD A,@R0");
  set(0xd7, 1, 1, "XCHD A,@R1");
  registers(0xd8, 2, 2, (r) => `DJNZ R${r},rel`);

  set(0xe0, 1, 2, "MOVX A,@DPTR");
  set(0xe1, 2, 2, "AJMP addr11");
  set(0xe2, 1, 2, "MOVX A,@R0");
  set(0xe3, 1, 2, "MOVX A,@R1");
  set(0xe4, 1, 1, "CLR A");
  set(0xe5, 2, 1, "MOV A,direct");
  set(0xe6, 1, 1, "MOV A,@R0");
  set(0xe7, 1, 1, "MOV A,@R1");
  registers(0xe8, 1, 1, (r) => `MOV A,R${r}`);

  set(0xf0, 1, 2, "MOVX @DPTR,A");
  set(0xf1, 2, 2, "ACALL addr11");
  set(0xf2, 1, 2, "MOVX @R0,A");
  set(0xf3, 1, 2, "MOVX @R1,A");
  set(0xf4, 1, 1, "CPL A");
  set(0xf5, 2, 1, "MOV direct,A");
  set(0xf6, 1, 1, "MOV @R0,A");
  set(0xf7, 1, 1, "MOV @R1,A");
  registers(0xf8, 1, 1, (r) => `MOV R${r},A`);

  return table.map((meta, opcode) => {
    if (!meta) {
      throw new Error(`操作码表缺少 0x${opcode.toString(16).padStart(2, "0")}`);
    }
    return meta;
  });
};

export const OPCODE_META = buildOpcodeTable();

export const opcodeMeta = (opcode: number): OpcodeMeta =>
  OPCODE_META[opcode & 0xff] as OpcodeMeta;
