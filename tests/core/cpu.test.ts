import { describe, expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { SFR } from "../../src/core/memory";

const cpuWith = (...bytes: number[]) => new Cpu8051(Uint8Array.from(bytes));

describe("Cpu8051", () => {
  it("统一更新 ADD 标志和奇偶标志", () => {
    const cpu = cpuWith(0x74, 0x7f, 0x24, 0x01);
    cpu.step();
    cpu.step();
    expect(cpu.state().acc).toBe(0x80);
    expect(cpu.state().psw & 0xc5).toBe(0x45);
  });

  it("处理进位、借位和有符号溢出", () => {
    const add = cpuWith(0x74, 0xff, 0x24, 0x01);
    add.step();
    add.step();
    expect(add.state().acc).toBe(0);
    expect(add.state().psw & 0xc4).toBe(0xc0);

    const sub = cpuWith(0x74, 0x80, 0x94, 0x01);
    sub.step();
    sub.step();
    expect(sub.state().acc).toBe(0x7f);
    expect(sub.state().psw & 0x84).toBe(0x04);
  });

  it("除零设置 OV、清 CY 并保持 ACC/B", () => {
    const cpu = cpuWith(0x74, 0x81, 0x75, 0xf0, 0x00, 0xd3, 0x84);
    for (let count = 0; count < 4; count += 1) cpu.step();
    expect(cpu.state().acc).toBe(0x81);
    expect(cpu.state().b).toBe(0);
    expect(cpu.state().psw & 0x84).toBe(0x04);
  });

  it("LCALL 低字节先压栈，RET 高字节先弹出", () => {
    const cpu = cpuWith(0x12, 0x00, 0x05, 0x00, 0x00, 0x22);
    cpu.step();
    expect(cpu.state().pc).toBe(5);
    expect(cpu.state().sp).toBe(9);
    expect(cpu.memory.readDirect(8)).toBe(3);
    expect(cpu.memory.readDirect(9)).toBe(0);
    cpu.step();
    expect(cpu.state().pc).toBe(3);
    expect(cpu.state().sp).toBe(7);
  });

  it("相对跳转和 PC 取指在 16 位地址空间回绕", () => {
    const program = new Uint8Array(0x10000);
    program[0xffff] = 0x74;
    program[0] = 0x42;
    const cpu = new Cpu8051(program);
    const snapshot = cpu.snapshot();
    snapshot.pc = 0xffff;
    cpu.restore(snapshot);
    cpu.step();
    expect(cpu.state().acc).toBe(0x42);
    expect(cpu.state().pc).toBe(1);

    const loop = cpuWith(0x80, 0xfe);
    loop.step();
    expect(loop.state().pc).toBe(0);
  });

  it("MOV direct,direct 使用源、目标机器码顺序", () => {
    const cpu = cpuWith(0x75, 0x20, 0x5a, 0x85, 0x20, 0x21);
    cpu.step();
    cpu.step();
    expect(cpu.memory.readDirect(0x20)).toBe(0x5a);
    expect(cpu.memory.readDirect(0x21)).toBe(0x5a);
  });

  it("MOVC A,@A+PC 使用预推进 PC", () => {
    const cpu = cpuWith(0x74, 0x01, 0x83, 0xaa, 0x5c);
    cpu.step();
    cpu.step();
    expect(cpu.state().acc).toBe(0x5c);
  });

  it("MOVX @Ri 使用 P2 作为高地址", () => {
    const cpu = cpuWith(
      0x75, SFR.P2, 0x12,
      0x78, 0x34,
      0x74, 0xab,
      0xf2,
      0xe4,
      0xe2,
    );
    for (let count = 0; count < 6; count += 1) cpu.step();
    expect(cpu.memory.readXram(0x1234)).toBe(0xab);
    expect(cpu.state().acc).toBe(0xab);
    expect(cpu.memory.readDirect(SFR.P2)).toBe(0x12);
  });

  it("JBC 成功后清除目标位", () => {
    const cpu = cpuWith(0xd2, 0x00, 0x10, 0x00, 0x01, 0x00, 0x00);
    cpu.step();
    cpu.step();
    expect(cpu.memory.readBit(0)).toBe(false);
    expect(cpu.state().pc).toBe(6);
  });

  it("reset 保留 IRAM/XRAM 并重置计数和 SFR", () => {
    const cpu = cpuWith(0x00);
    cpu.memory.writeDirect(0x40, 0xaa);
    cpu.memory.writeXram(0xbeef, 0xbb);
    cpu.step();
    cpu.reset();
    expect(cpu.memory.readDirect(0x40)).toBe(0xaa);
    expect(cpu.memory.readXram(0xbeef)).toBe(0xbb);
    expect(cpu.state().steps).toBe(0);
    expect(cpu.state().sp).toBe(7);
  });

  it("运行历史样本直到稳定自循环", () => {
    const firmware = Uint8Array.from([
      0x02, 0x00, 0x03, 0x78, 0x7f, 0xe4, 0xf6, 0xd8, 0xfd, 0x75, 0x81,
      0x07, 0x02, 0x00, 0x0f, 0xd2, 0xa0, 0xc2, 0xa0, 0x80, 0xfe,
    ]);
    const cpu = new Cpu8051(firmware);
    cpu.runChunk(262, 1_000, false);
    expect(cpu.state().pc).toBe(0x13);
    expect(cpu.state().sp).toBe(7);
    expect(cpu.memory.readDirect(SFR.P2)).toBe(0xfe);
  });
});
