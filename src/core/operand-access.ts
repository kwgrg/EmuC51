import { Memory8051 } from "./memory";
import { u8, u16 } from "./numbers";

export type OperandSpace = "data" | "idata" | "xdata" | "sfr";
export type OperandAccessKind = "read" | "write";
export interface OperandAccess { space: OperandSpace; address: number; kind: OperandAccessKind; value: number; pc: number }
export interface OperandWatchpoint { space: OperandSpace; address: number; access: OperandAccessKind | "readwrite" }

/** Only explicit byte operands use this adapter. Internal reads and hardware hooks use Memory8051 directly. */
export class OperandMemory {
  constructor(private memory: Memory8051, private record: (space: OperandSpace, address: number, kind: OperandAccessKind, value: number) => void) {}
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
