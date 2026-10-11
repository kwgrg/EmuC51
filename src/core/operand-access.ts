import { Memory8051, resolveBitAddress, SFR } from "./memory";
import { u8, u16 } from "./numbers";

export type OperandSpace = "data" | "idata" | "xdata" | "sfr" | "bit";
export type OperandAccessKind = "read" | "write";
export interface OperandAccess { space: OperandSpace; address: number; kind: OperandAccessKind; value: number; pc: number; bit?: OperandBitDetails }
export interface OperandWatchpoint { space: OperandSpace; address: number; access: OperandAccessKind | "readwrite" }

export interface OperandBitDetails { byteSpace: "data" | "sfr"; byteAddress: number; index: number; readSource?: "memory" | "pins" | "latch" }
export const operandBitLocation = (address: number): OperandBitDetails => {
  const [byteAddress, index, space] = resolveBitAddress(address);
  return { byteSpace: space === "iram" ? "data" : "sfr", byteAddress, index };
};

/** Only explicit byte and bit operands use this adapter. Internal reads and hardware hooks use Memory8051 directly. */
export class OperandMemory {
  constructor(private memory: Memory8051, private record: (space: OperandSpace, address: number, kind: OperandAccessKind, value: number, bit?: OperandBitDetails) => void) {}
  readBit(address: number, latch = false): boolean {
    const value = this.memory.readBit(address, latch);
    const bit = operandBitLocation(address);
    const port = bit.byteSpace === "sfr" && ([SFR.P0, SFR.P1, SFR.P2, SFR.P3] as number[]).includes(bit.byteAddress);
    bit.readSource = port ? (latch ? "latch" : "pins") : "memory";
    this.record("bit", u8(address), "read", Number(value), bit);
    return value;
  }
  writeBit(address: number, set: boolean): void {
    this.memory.writeBit(address, set);
    this.record("bit", u8(address), "write", Number(set), operandBitLocation(address));
  }
  readDirect(address: number, rmw = false): number {
    const value = rmw ? this.memory.readRmwDirect(address) : this.memory.readDirect(address);
    this.record(u8(address) < 0x80 ? "data" : "sfr", u8(address), "read", value);
    return value;
  }
  readRmwDirect(address: number): number { return this.readDirect(address, true); }
  writeDirect(address: number, value: number): void {
    this.memory.writeDirect(address, value);
    this.record(u8(address) < 0x80 ? "data" : "sfr", u8(address), "write", u8(value));
  }
  readIndirect(address: number): number {
    const value = this.memory.readIndirect(address);
    this.record("idata", address, "read", value); return value;
  }
  writeIndirect(address: number, value: number): void {
    this.memory.writeIndirect(address, value);
    this.record("idata", address, "write", u8(value));
  }
  readXram(address: number): number {
    const value = this.memory.readXram(address);
    this.record("xdata", u16(address), "read", value); return value;
  }
  writeXram(address: number, value: number): void {
    this.memory.writeXram(address, value);
    this.record("xdata", u16(address), "write", u8(value));
  }
}
