import { hex8, hex16, sign8, u16 } from "./numbers";
import { opcodeMeta } from "./opcodes";

export interface DisassembledInstruction {
  address: number;
  bytes: number[];
  text: string;
  length: number;
  legal: boolean;
}

const validateProgram = (program: Uint8Array): void => {
  if (program.byteLength > 0x10000) throw new Error("反汇编固件超过 64 KiB CODE 空间");
};

const decodeInstruction = (program: Uint8Array, address: number): DisassembledInstruction => {
  const readByte = (offset: number): number => program[u16(address + offset)] ?? 0;
  const opcode = readByte(0);
  const meta = opcodeMeta(opcode);
  const bytes = Array.from({ length: meta.length }, (_, offset) => readByte(offset));
  const nextAddress = u16(address + meta.length);
  let operandOffset = 1;
  let text: string;

  if (!meta.legal) {
    text = `DB 0x${hex8(opcode)} ; RESERVED`;
  } else if (opcode === 0x85) {
    // MOV direct,direct stores source first, then destination in the encoding.
    text = `MOV 0x${hex8(bytes[2]!)},0x${hex8(bytes[1]!)}`;
  } else {
    text = meta.mnemonic.replace(/#data16|#data|addr16|addr11|direct|bit|rel/g, (operand) => {
      const first = bytes[operandOffset++]!;
      switch (operand) {
        case "#data16":
        case "addr16": {
          const value = (first << 8) | bytes[operandOffset++]!;
          return `${operand === "#data16" ? "#" : ""}0x${hex16(value)}`;
        }
        case "addr11":
          return `0x${hex16((nextAddress & 0xf800) | ((opcode & 0xe0) << 3) | first)}`;
        case "rel":
          return `0x${hex16(nextAddress + sign8(first))}`;
        default:
          return `${operand === "#data" ? "#" : ""}0x${hex8(first)}`;
      }
    });
  }

  return { address, bytes, text, length: meta.length, legal: meta.legal };
};

/** Decode from the same zero-filled, 16-bit wrapping CODE space as the CPU. */
export const disassembleInstruction = (
  program: Uint8Array,
  address: number,
): DisassembledInstruction => {
  validateProgram(program);
  if (!Number.isSafeInteger(address)) throw new Error("反汇编地址必须是整数");
  return decodeInstruction(program, u16(address));
};

/** Count is the number of instructions, including reserved encodings. */
export const disassemble = (
  program: Uint8Array,
  start: number,
  count: number,
): DisassembledInstruction[] => {
  validateProgram(program);
  if (!Number.isSafeInteger(start)) throw new Error("反汇编地址必须是整数");
  if (!Number.isSafeInteger(count) || count < 0 || count > 0x10000) {
    throw new Error("反汇编指令数必须是 0 到 65536 之间的整数");
  }
  const instructions: DisassembledInstruction[] = [];
  let address = u16(start);
  for (let index = 0; index < count; index += 1) {
    const instruction = decodeInstruction(program, address);
    instructions.push(instruction);
    address = u16(address + instruction.length);
  }
  return instructions;
};
