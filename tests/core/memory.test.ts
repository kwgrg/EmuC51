import { describe, expect, it } from "vitest";
import { Memory8051, SFR } from "../../src/core/memory";
import { EmulatorFault } from "../../src/core/types";

describe("8051 存储器", () => {
  it("初始化 64 KiB CODE 并拒绝超大固件", () => {
    const memory = new Memory8051(Uint8Array.from([0x12, 0x34]));
    expect(memory.readCode(0)).toBe(0x12);
    expect(memory.readCode(1)).toBe(0x34);
    expect(memory.readCode(0xffff)).toBe(0);
    expect(() => new Memory8051(new Uint8Array(0x10001))).toThrowError(EmulatorFault);
  });

  it("区分直接 IRAM、SFR 与严格间接地址", () => {
    const memory = new Memory8051(new Uint8Array());
    memory.writeDirect(0x7f, 0x55);
    expect(memory.readDirect(0x7f)).toBe(0x55);
    expect(() => memory.readDirect(0x84)).toThrowError(EmulatorFault);
    expect(() => memory.readIndirect(0x80)).toThrowError(EmulatorFault);
  });

  it("映射 IRAM 与标准 SFR 位地址", () => {
    const memory = new Memory8051(new Uint8Array());
    memory.writeBit(0x00, true);
    memory.writeBit(0x7f, true);
    expect(memory.readDirect(0x20)).toBe(0x01);
    expect(memory.readDirect(0x2f)).toBe(0x80);
    memory.writeBit(0xa0, false);
    expect(memory.readDirect(SFR.P2)).toBe(0xfe);
    expect(() => memory.readBit(0xc0)).toThrowError(EmulatorFault);
  });

  it("根据 PSW 选择四个寄存器组", () => {
    const memory = new Memory8051(new Uint8Array());
    for (let bank = 0; bank < 4; bank += 1) {
      memory.psw = bank << 3;
      memory.writeRegister(3, 0x40 + bank);
    }
    expect([3, 11, 19, 27].map((address) => memory.readDirect(address))).toEqual([
      0x40,
      0x41,
      0x42,
      0x43,
    ]);
  });

  it("标准复位值正确且不清除 IRAM/XRAM", () => {
    const memory = new Memory8051(new Uint8Array());
    memory.iram[0x40] = 0xaa;
    memory.xram[0x1234] = 0xbb;
    memory.acc = 0xcc;
    memory.resetSfr();
    expect(memory.acc).toBe(0);
    expect(memory.sp).toBe(7);
    expect(memory.readDirect(SFR.P0)).toBe(0xff);
    expect(memory.readDirect(SFR.P3)).toBe(0xff);
    expect(memory.iram[0x40]).toBe(0xaa);
    expect(memory.xram[0x1234]).toBe(0xbb);
  });
});
