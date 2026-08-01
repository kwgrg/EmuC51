import { EmulatorFault, type CpuSnapshot, type MemorySpace } from "./types";
import { parity, u8, u16 } from "./numbers";

export const SFR = {
  P0: 0x80,
  SP: 0x81,
  DPL: 0x82,
  DPH: 0x83,
  PCON: 0x87,
  TCON: 0x88,
  TMOD: 0x89,
  TL0: 0x8a,
  TL1: 0x8b,
  TH0: 0x8c,
  TH1: 0x8d,
  P1: 0x90,
  SCON: 0x98,
  SBUF: 0x99,
  P2: 0xa0,
  IE: 0xa8,
  P3: 0xb0,
  IP: 0xb8,
  PSW: 0xd0,
  ACC: 0xe0,
  B: 0xf0,
} as const;

const DEFINED_SFR = new Set<number>(Object.values(SFR));
const BIT_ADDRESSABLE_SFR = new Set<number>([
  SFR.P0,
  SFR.TCON,
  SFR.P1,
  SFR.SCON,
  SFR.P2,
  SFR.IE,
  SFR.P3,
  SFR.IP,
  SFR.PSW,
  SFR.ACC,
  SFR.B,
]);

export class Memory8051 {
  readonly code = new Uint8Array(0x10000);
  readonly iram = new Uint8Array(0x80);
  readonly sfr = new Uint8Array(0x80);
  readonly xram = new Uint8Array(0x10000);

  constructor(program: Uint8Array) {
    if (program.byteLength > 0x10000) {
      throw new EmulatorFault({
        code: "FIRMWARE_TOO_LARGE",
        message: `固件大小 ${program.byteLength} 字节，超过 64 KiB`,
      });
    }
    this.code.set(program);
    this.resetSfr();
  }

  resetSfr(): void {
    this.sfr.fill(0);
    this.writeSfrUnchecked(SFR.P0, 0xff);
    this.writeSfrUnchecked(SFR.P1, 0xff);
    this.writeSfrUnchecked(SFR.P2, 0xff);
    this.writeSfrUnchecked(SFR.P3, 0xff);
    this.writeSfrUnchecked(SFR.SP, 0x07);
  }

  readCode(address: number): number {
    return this.code[u16(address)] ?? 0;
  }

  assertDirect(address: number): void {
    const direct = u8(address);
    if (direct >= 0x80 && !DEFINED_SFR.has(direct)) {
      throw new EmulatorFault({
        code: "UNDEFINED_SFR",
        address: direct,
        message: `未定义的经典 8051 SFR 地址 0x${direct.toString(16).padStart(2, "0")}`,
      });
    }
  }

  readDirect(address: number): number {
    const direct = u8(address);
    this.assertDirect(direct);
    return direct < 0x80
      ? (this.iram[direct] ?? 0)
      : (this.sfr[direct - 0x80] ?? 0);
  }

  writeDirect(address: number, value: number): void {
    const direct = u8(address);
    this.assertDirect(direct);
    if (direct < 0x80) {
      this.iram[direct] = u8(value);
    } else {
      this.sfr[direct - 0x80] = u8(value);
    }
  }

  assertIndirect(address: number): void {
    if (address < 0 || address > 0x7f) {
      throw new EmulatorFault({
        code: "INVALID_IRAM_ADDRESS",
        address: u8(address),
        message: `经典 8051 间接 IRAM 地址无效：0x${u8(address).toString(16).padStart(2, "0")}`,
      });
    }
  }

  readIndirect(address: number): number {
    this.assertIndirect(address);
    return this.iram[address] ?? 0;
  }

  writeIndirect(address: number, value: number): void {
    this.assertIndirect(address);
    this.iram[address] = u8(value);
  }

  private resolveBit(address: number): [number, number, "iram" | "sfr"] {
    const bitAddress = u8(address);
    if (bitAddress < 0x80) {
      return [0x20 + (bitAddress >> 3), bitAddress & 7, "iram"];
    }
    const sfrAddress = bitAddress & 0xf8;
    if (!DEFINED_SFR.has(sfrAddress)) {
      throw new EmulatorFault({
        code: "UNDEFINED_SFR",
        address: sfrAddress,
        message: `位地址映射到未定义 SFR：0x${sfrAddress.toString(16)}`,
      });
    }
    if (!BIT_ADDRESSABLE_SFR.has(sfrAddress)) {
      throw new EmulatorFault({
        code: "NON_BIT_ADDRESSABLE_SFR",
        address: sfrAddress,
        message: `SFR 0x${sfrAddress.toString(16)} 不支持位寻址`,
      });
    }
    return [sfrAddress, bitAddress & 7, "sfr"];
  }

  readBit(address: number): boolean {
    const [byteAddress, bit, space] = this.resolveBit(address);
    const value =
      space === "iram"
        ? (this.iram[byteAddress] ?? 0)
        : this.readDirect(byteAddress);
    return (value & (1 << bit)) !== 0;
  }

  writeBit(address: number, set: boolean): void {
    const [byteAddress, bit, space] = this.resolveBit(address);
    const current =
      space === "iram"
        ? (this.iram[byteAddress] ?? 0)
        : this.readDirect(byteAddress);
    const next = set ? current | (1 << bit) : current & ~(1 << bit);
    if (space === "iram") {
      this.iram[byteAddress] = u8(next);
    } else {
      this.writeDirect(byteAddress, next);
    }
  }

  readXram(address: number): number {
    return this.xram[u16(address)] ?? 0;
  }

  writeXram(address: number, value: number): void {
    this.xram[u16(address)] = u8(value);
  }

  private registerAddress(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index > 7) {
      throw new EmulatorFault({
        code: "INVALID_REGISTER",
        address: index,
        message: `工作寄存器索引无效：${index}`,
      });
    }
    const bank = (this.psw >> 3) & 0x03;
    return bank * 8 + index;
  }

  readRegister(index: number): number {
    return this.iram[this.registerAddress(index)] ?? 0;
  }

  writeRegister(index: number, value: number): void {
    this.iram[this.registerAddress(index)] = u8(value);
  }

  get acc(): number {
    return this.readDirect(SFR.ACC);
  }

  set acc(value: number) {
    this.writeDirect(SFR.ACC, value);
  }

  get b(): number {
    return this.readDirect(SFR.B);
  }

  set b(value: number) {
    this.writeDirect(SFR.B, value);
  }

  get psw(): number {
    return this.readDirect(SFR.PSW);
  }

  set psw(value: number) {
    this.writeDirect(SFR.PSW, value);
  }

  get sp(): number {
    return this.readDirect(SFR.SP);
  }

  set sp(value: number) {
    this.writeDirect(SFR.SP, value);
  }

  get dptr(): number {
    return (this.readDirect(SFR.DPH) << 8) | this.readDirect(SFR.DPL);
  }

  set dptr(value: number) {
    const pointer = u16(value);
    this.writeDirect(SFR.DPH, pointer >> 8);
    this.writeDirect(SFR.DPL, pointer);
  }

  get carry(): boolean {
    return (this.psw & 0x80) !== 0;
  }

  set carry(value: boolean) {
    this.psw = value ? this.psw | 0x80 : this.psw & ~0x80;
  }

  setAuxCarry(value: boolean): void {
    this.psw = value ? this.psw | 0x40 : this.psw & ~0x40;
  }

  get auxCarry(): boolean {
    return (this.psw & 0x40) !== 0;
  }

  setOverflow(value: boolean): void {
    this.psw = value ? this.psw | 0x04 : this.psw & ~0x04;
  }

  updateParity(): void {
    this.psw = parity(this.acc) ? this.psw | 0x01 : this.psw & ~0x01;
  }

  readMemory(space: MemorySpace, address: number, length: number): Uint8Array {
    const safeLength = Math.max(0, Math.min(0x10000, Math.trunc(length)));
    const result = new Uint8Array(safeLength);
    for (let index = 0; index < safeLength; index += 1) {
      const current = address + index;
      switch (space) {
        case "code":
          result[index] = this.readCode(current);
          break;
        case "iram":
          result[index] = current >= 0 && current < 0x80 ? (this.iram[current] ?? 0) : 0;
          break;
        case "sfr": {
          const direct = 0x80 + ((current - 0x80) & 0x7f);
          result[index] = DEFINED_SFR.has(direct) ? this.readDirect(direct) : 0;
          break;
        }
        case "xram":
          result[index] = this.readXram(current);
          break;
      }
    }
    return result;
  }

  snapshot(pc: number, steps: number, machineCycles: number): CpuSnapshot {
    return {
      coreStateVersion: 1,
      pc: u16(pc),
      steps,
      machineCycles,
      iram: this.iram.slice(),
      sfr: this.sfr.slice(),
      xram: this.xram.slice(),
    };
  }

  restore(snapshot: CpuSnapshot): void {
    if (
      snapshot.coreStateVersion !== 1 ||
      snapshot.iram.byteLength !== 0x80 ||
      snapshot.sfr.byteLength !== 0x80 ||
      snapshot.xram.byteLength !== 0x10000
    ) {
      throw new EmulatorFault({
        code: "INVALID_SNAPSHOT",
        message: "CPU 快照版本或内存尺寸无效",
      });
    }
    this.iram.set(snapshot.iram);
    this.sfr.set(snapshot.sfr);
    this.xram.set(snapshot.xram);
  }

  private writeSfrUnchecked(address: number, value: number): void {
    this.sfr[address - 0x80] = u8(value);
  }
}
