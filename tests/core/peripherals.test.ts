import { describe, expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { SFR } from "../../src/core/memory";
import { validatePeripheralSnapshot } from "../../src/core/peripherals";

const cpuWith = (...code: number[]) => new Cpu8051(Uint8Array.from(code));
const write = (cpu: Cpu8051, values: [number, number][]) => values.forEach(([address, value]) => cpu.writeMemory("sfr", address, value));
const advance = (cpu: Cpu8051, cycles: number) => { for (let count = 0; count < cycles; count += 1) cpu.step(); };
const sfr = (cpu: Cpu8051, address: number) => cpu.memory.readSfrLatch(address);

// Default zero-filled code is one-cycle NOP, so these tests advance exact machine cycles.
describe("8051 timers and GPIO", () => {
  it("advances mode 0 as 13 bits, preserving TL upper bits", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 0], [SFR.TH0, 0xff], [SFR.TL0, 0xff], [SFR.TCON, 0x10]]);
    cpu.step();
    expect(sfr(cpu, SFR.TH0)).toBe(0);
    expect(sfr(cpu, SFR.TL0)).toBe(0xe0);
    expect(sfr(cpu, SFR.TCON) & 0x20).toBe(0x20);
  });

  it("advances both 16-bit timers and preserves sticky overflow flags", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 0x11], [SFR.TH0, 0xff], [SFR.TL0, 0xff], [SFR.TH1, 0xff], [SFR.TL1, 0xff], [SFR.TCON, 0x50]]);
    advance(cpu, 2);
    expect(sfr(cpu, SFR.TH0)).toBe(0);
    expect(sfr(cpu, SFR.TL0)).toBe(1);
    expect(sfr(cpu, SFR.TL1)).toBe(1);
    expect(sfr(cpu, SFR.TCON) & 0xa0).toBe(0xa0);
  });

  it("mode 2 reloads TL from TH each overflow", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 2], [SFR.TH0, 0xfc], [SFR.TL0, 0xff], [SFR.TCON, 0x10]]);
    cpu.step();
    expect(sfr(cpu, SFR.TL0)).toBe(0xfc);
    advance(cpu, 4);
    expect(sfr(cpu, SFR.TL0)).toBe(0xfc);
    expect(sfr(cpu, SFR.TH0)).toBe(0xfc);
  });

  it("split mode uses TR0/TF0 for TL0 and TR1/TF1 for TH0", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 0x33], [SFR.TL0, 0xff], [SFR.TH0, 0xff], [SFR.TL1, 9], [SFR.TCON, 0x50]]);
    cpu.step();
    expect(sfr(cpu, SFR.TL0)).toBe(0);
    expect(sfr(cpu, SFR.TH0)).toBe(0);
    expect(sfr(cpu, SFR.TL1)).toBe(9);
    expect(sfr(cpu, SFR.TCON) & 0xa0).toBe(0xa0);
  });

  it("timer 1 can supply UART baud in split mode without setting TF1", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 0x23], [SFR.TL1, 0xff], [SFR.TH1, 0xfc], [SFR.TCON, 0]]);
    cpu.step();
    expect(sfr(cpu, SFR.TL1)).toBe(0xfc);
    expect(sfr(cpu, SFR.TCON) & 0x80).toBe(0);
  });

  it("gated timer only runs while INT0 pin is high", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 9], [SFR.TCON, 0x10]]);
    cpu.setPortInput(3, 0xfb);
    advance(cpu, 3);
    expect(sfr(cpu, SFR.TL0)).toBe(0);
    cpu.setPortInput(3, 0xff);
    cpu.step();
    expect(sfr(cpu, SFR.TL0)).toBe(1);
  });

  it("counter consumes falling T0/T1 edges, ignoring stopped pulses", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 0x55]]);
    cpu.setPortInput(3, 0xcf);
    write(cpu, [[SFR.TCON, 0x50]]);
    cpu.step();
    expect(sfr(cpu, SFR.TL0)).toBe(0);
    expect(sfr(cpu, SFR.TL1)).toBe(0);
    cpu.setPortInput(3, 0xff);
    cpu.setPortInput(3, 0xcf);
    cpu.step();
    advance(cpu, 3);
    expect(sfr(cpu, SFR.TL0)).toBe(1);
    expect(sfr(cpu, SFR.TL1)).toBe(1);
  });

  it("reads port pins for MOV and the latch for read-modify-write", () => {
    const cpu = cpuWith(0xe5, SFR.P1, 0x05, SFR.P1);
    cpu.setPortInput(1, 0x0f);
    cpu.step();
    expect(cpu.state().acc).toBe(0x0f);
    expect(cpu.readMemory("sfr", SFR.P1, 1)[0]).toBe(0xff);
    cpu.step();
    expect(cpu.state().peripherals.ports[1]).toEqual({ latch: 0, input: 0x0f, pins: 0 });
  });

  it("bit RMW and JBC preserve latch semantics even if pin is low", () => {
    const cpu = cpuWith(0x10, 0x90, 1, 0x00, 0xb2, 0x91);
    cpu.setPortInput(1, 0);
    cpu.step();
    expect(cpu.pc).toBe(4);
    expect(sfr(cpu, SFR.P1)).toBe(0xfe);
    cpu.step();
    expect(sfr(cpu, SFR.P1)).toBe(0xfc);
  });

  it("MOVX @Ri uses the P2 address latch despite externally low pins", () => {
    const cpu = cpuWith(0xe2);
    write(cpu, [[SFR.P2, 0x12]]);
    cpu.setRegister("R0", 0x34);
    cpu.setPortInput(2, 0);
    cpu.writeMemory("xram", 0x1234, 0xab);
    cpu.step();
    expect(cpu.state().acc).toBe(0xab);
  });

  it("uses opcode machine cycles including one-cycle MOV C,bit", () => {
    const cpu = cpuWith(0xa2, 0, 0x92, 1, 0x02, 0, 0);
    write(cpu, [[SFR.TMOD, 1], [SFR.TCON, 0x10]]);
    advance(cpu, 3);
    expect(cpu.state().machineCycles).toBe(5);
    expect(sfr(cpu, SFR.TL0)).toBe(5);
  });
});

describe("8051 interrupts and power control", () => {
  it("chooses priority before fixed polling order and clears edge/timer flags", () => {
    const program = new Uint8Array(0x40);
    program[0x1b] = 0x32;
    const cpu = new Cpu8051(program);
    write(cpu, [[SFR.IE, 0x8f], [SFR.IP, 8], [SFR.TCON, 0xaf]]);
    cpu.step(); // IE/IP access inhibits one boundary.
    const interrupt = cpu.step();
    expect(interrupt.kind).toBe("interrupt");
    expect(cpu.pc).toBe(0x1b);
    expect(cpu.state().machineCycles).toBe(3);
    expect(sfr(cpu, SFR.TCON) & 0x80).toBe(0);
    cpu.step(); // RETI
    expect(cpu.pc).toBe(1);
    expect(cpu.state().peripherals.interrupt.activePriorities).toEqual([]);
    cpu.step(); // one instruction after RETI
    cpu.step();
    expect(cpu.pc).toBe(3);
    expect(sfr(cpu, SFR.TCON) & 2).toBe(0);
  });

  it("allows high priority nesting and blocks equal/lower priority", () => {
    const program = new Uint8Array(0x40);
    program[0x0c] = 0x32;
    program[0x23] = 0x32;
    const cpu = new Cpu8051(program);
    write(cpu, [[SFR.IE, 0x92], [SFR.IP, 0x10], [SFR.TCON, 0x20]]);
    cpu.step();
    cpu.step();
    expect(cpu.pc).toBe(0x0b);
    write(cpu, [[SFR.TCON, 0x20], [SFR.SCON, 2]]);
    cpu.step();
    expect(cpu.pc).toBe(0x23);
    expect(cpu.state().peripherals.interrupt.activePriorities).toEqual([0, 1]);
    expect(sfr(cpu, SFR.SCON) & 2).toBe(2); // UART flags are software-cleared.
    write(cpu, [[SFR.SCON, 0]]);
    cpu.step();
    cpu.step(); // NOP in low ISR
    expect(cpu.pc).toBe(0x0c);
    cpu.step(); // RETI low ISR
    expect(cpu.pc).toBe(1);
    cpu.step();
    cpu.step();
    expect(cpu.pc).toBe(0x0b);
  });

  it("RET preserves interrupt in-service status while RETI releases it", () => {
    const program = new Uint8Array(0x20);
    program[0x0b] = 0x22;
    const cpu = new Cpu8051(program);
    write(cpu, [[SFR.IE, 0x82], [SFR.TCON, 0x20]]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.pc).toBe(1);
    expect(cpu.state().peripherals.interrupt.activePriorities).toEqual([0]);
    write(cpu, [[SFR.TCON, 0x20]]);
    expect(cpu.step().kind).toBe("instruction");
  });

  it("accessing IE/IP delays acceptance until another instruction executes", () => {
    const cpu = cpuWith(0x75, SFR.IE, 0x82, 0xe5, SFR.IE, 0x08, 0x00);
    write(cpu, [[SFR.TCON, 0x20]]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.pc).toBe(6);
    expect(cpu.state().registers[0]).toBe(1);
    expect(cpu.step().kind).toBe("interrupt");
  });

  it("boolean instructions access IE bits even when carry decides the result", () => {
    const cpu = cpuWith(0x75, SFR.IE, 0x82, 0x72, 0xa8, 0x08, 0);
    cpu.setRegister("PSW", 0x80);
    write(cpu, [[SFR.TCON, 0x20]]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.pc).toBe(6);
    expect(cpu.state().registers[0]).toBe(1);
    expect(cpu.step().kind).toBe("interrupt");
  });

  it.each([0xa8, 0xb8])("JBC bit %x delays interrupts even when the branch is not taken", (bitAddress) => {
    const cpu = cpuWith(0x75, SFR.IE, 0x82, 0x10, bitAddress, 0, 0x08);
    write(cpu, [[SFR.TCON, 0x20]]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.pc).toBe(7);
    expect(cpu.state().registers[0]).toBe(1);
    expect(cpu.step().kind).toBe("interrupt");
  });

  it("level-triggered interrupts follow actual INT pin state", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.IE, 0x81]]);
    cpu.setPortInput(3, 0xfb);
    cpu.step(); cpu.step();
    expect(cpu.pc).toBe(3);
    expect(sfr(cpu, SFR.TCON) & 2).toBe(2);
    cpu.setPortInput(3, 0xff);
    expect(sfr(cpu, SFR.TCON) & 2).toBe(0);
  });

  it("idle advances timers and wakes on interrupt; power-down freezes cycles", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 1], [SFR.TH0, 0xff], [SFR.TL0, 0xff], [SFR.TCON, 0x10], [SFR.IE, 0x82], [SFR.PCON, 1]]);
    expect(cpu.step().kind).toBe("idle");
    expect(cpu.pc).toBe(0);
    expect(cpu.step().kind).toBe("interrupt");
    expect(cpu.state().peripherals.powerMode).toBe("running");
    write(cpu, [[SFR.PCON, 2]]);
    const snapshot = cpu.snapshot();
    expect(cpu.step().kind).toBe("power-down");
    expect(cpu.snapshot()).toEqual(snapshot);
  });

  it("advances timers during two-cycle interrupt entry", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 1], [SFR.TH0, 0xff], [SFR.TL0, 0xfe], [SFR.TCON, 0x10], [SFR.IE, 0x82]]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.state().machineCycles).toBe(4);
    expect(sfr(cpu, SFR.TL0)).toBe(2);
  });
});

describe("8051 UART", () => {
  it("has separate receive SBUF and transmit buffer, completing mode 0 in eight cycles", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.SCON, 0x10], [SFR.SBUF, 0x41]]);
    cpu.receiveSerial(0x42);
    advance(cpu, 7);
    expect(cpu.drainSerialOutput()).toEqual([]);
    expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0);
    cpu.step();
    expect(cpu.drainSerialOutput()).toEqual([0x41]);
    expect(cpu.drainSerialOutput()).toEqual([]);
    expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0x42);
    expect(sfr(cpu, SFR.SBUF)).toBe(0x41);
    expect(sfr(cpu, SFR.SCON) & 3).toBe(3);
  });

  it("drops input with REN clear, and holds queued bytes until RI is cleared", () => {
    const cpu = cpuWith();
    cpu.receiveSerial(0x99);
    write(cpu, [[SFR.SCON, 0x10]]);
    cpu.receiveSerial(0x11); cpu.receiveSerial(0x22);
    advance(cpu, 16);
    expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0x11);
    expect(cpu.state().peripherals.serial.rxQueued).toBe(1);
    write(cpu, [[SFR.SCON, 0x10]]);
    advance(cpu, 8);
    expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0x22);
  });

  it.each([[1, 320], [3, 352]])("mode %i uses timer 1 overflow divided by 32", (mode, cycles) => {
    const cpu = cpuWith();
    write(cpu, [[SFR.TMOD, 0x20], [SFR.TH1, 0xff], [SFR.TL1, 0xff], [SFR.TCON, 0x40], [SFR.SCON, (mode << 6) | 0x10], [SFR.SBUF, 0x55]]);
    cpu.receiveSerial(0x66);
    advance(cpu, cycles - 1);
    expect(cpu.drainSerialOutput()).toEqual([]);
    cpu.step();
    expect(cpu.drainSerialOutput()).toEqual([0x55]);
    expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0x66);
    expect(sfr(cpu, SFR.SCON) & 7).toBe(7);
  });

  it("variable baud modes do not progress with timer 1 stopped", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.SCON, 0x50], [SFR.SBUF, 0xaa]]);
    cpu.receiveSerial(0xbb);
    advance(cpu, 400);
    expect(cpu.drainSerialOutput()).toEqual([]);
    expect(sfr(cpu, SFR.SCON) & 3).toBe(0);
  });

  it.each([[0, 59], [0x80, 30]])("mode 2 uses oscillator baud with SMOD=%i", (pcon, cycles) => {
    const cpu = cpuWith();
    write(cpu, [[SFR.PCON, pcon], [SFR.SCON, 0x90], [SFR.SBUF, 0xaa]]);
    advance(cpu, cycles - 1);
    expect(cpu.drainSerialOutput()).toEqual([]);
    cpu.step();
    expect(cpu.drainSerialOutput()).toEqual([0xaa]);
  });

  it("SMOD doubles mode 1 baud", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.PCON, 0x80], [SFR.TMOD, 0x20], [SFR.TH1, 0xff], [SFR.TL1, 0xff], [SFR.TCON, 0x40], [SFR.SCON, 0x40], [SFR.SBUF, 0x77]]);
    advance(cpu, 160);
    expect(cpu.drainSerialOutput()).toEqual([0x77]);
  });

  it("captures RB8 and applies SM2 ninth-bit filtering", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.SCON, 0xb4]]); // mode 2, SM2, REN, old RB8=1
    cpu.receiveSerial(0x12, false);
    advance(cpu, 59);
    expect(sfr(cpu, SFR.SCON) & 5).toBe(0);
    expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0);
    cpu.receiveSerial(0x34, true);
    advance(cpu, 59);
    expect(sfr(cpu, SFR.SCON) & 5).toBe(5);
    expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0x34);
  });

  it("RMW SBUF reads the receive buffer before writing the transmitter", () => {
    const cpu = cpuWith(0x05, SFR.SBUF);
    write(cpu, [[SFR.SCON, 0x10], [SFR.SBUF, 0x70]]);
    cpu.receiveSerial(0x21);
    cpu.setRegister("PC", 2);
    advance(cpu, 8);
    cpu.drainSerialOutput();
    cpu.setRegister("PC", 0);
    cpu.step();
    advance(cpu, 7);
    expect(cpu.drainSerialOutput()).toEqual([0x22]);
    expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0x21);
  });
});

describe("core snapshots and fault atomicity", () => {
  it("round-trips GPIO, queues, frame progress, and interrupt nesting", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.SCON, 0x90], [SFR.SBUF, 0x11]]);
    cpu.setPortInput(1, 0xab);
    cpu.receiveSerial(0x22, false); cpu.receiveSerial(0x33);
    advance(cpu, 13);
    const snapshot = cpu.snapshot();
    const restored = cpuWith();
    restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    advance(cpu, 46); advance(restored, 46);
    expect(restored.snapshot()).toEqual(cpu.snapshot());
    expect(restored.drainSerialOutput()).toEqual([0x11]);
  });

  it("upgrades legacy snapshots while preserving saved CPU memory", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.SBUF, 0x56], [SFR.P1, 0xab]]);
    cpu.setPortInput(1, 0);
    const legacy = cpu.memory.snapshot(0x1234, 20, 40);
    cpu.restore(legacy);
    expect(cpu.snapshot().coreStateVersion).toBe(2);
    expect(cpu.pc).toBe(0x1234);
    expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0x56);
    expect(cpu.state().peripherals.ports[1]?.input).toBe(0xff);
    expect(cpu.state().peripherals.serial.txBusy).toBe(false);
  });

  it("rejects corrupt peripheral snapshots before any mutation", () => {
    const cpu = cpuWith();
    cpu.setRegister("ACC", 0x45);
    const before = cpu.snapshot();
    const corrupt = cpu.snapshot();
    corrupt.iram[0] = 99;
    corrupt.peripherals.serial.txFrame = { mode: 0, value: 0, progress: 9 };
    expect(validatePeripheralSnapshot(corrupt.peripherals)).toBe(false);
    expect(() => cpu.restore(corrupt)).toThrow();
    expect(cpu.snapshot()).toEqual(before);
  });

  it("persists TX console history without re-emitting it after restore", () => {
    const cpu = cpuWith();
    write(cpu, [[SFR.SBUF, 0x41]]);
    advance(cpu, 8);
    expect(cpu.drainSerialOutput()).toEqual([0x41]);
    expect(cpu.snapshot().peripherals.serial.txOutput).toEqual([0x41]);
    const restored = cpuWith();
    restored.restore(cpu.snapshot());
    expect(restored.drainSerialOutput()).toEqual([]);
    expect(restored.state().peripherals.serial.txOutput).toEqual([0x41]);
    expect(restored.step().state.peripherals.serial.txOutput).toEqual([]);
  });

  it("rejects inconsistent GPIO snapshots and leaves blocked-interrupt faults intact", () => {
    const cpu = cpuWith(0xa5);
    write(cpu, [[SFR.IE, 0x82], [SFR.TCON, 0x20]]);
    const before = cpu.snapshot();
    expect(() => cpu.step()).toThrow();
    expect(cpu.snapshot()).toEqual(before);
    const corrupt = cpu.snapshot();
    corrupt.peripherals.lastPins[0] = 0;
    expect(() => cpu.restore(corrupt)).toThrow();
    expect(cpu.snapshot()).toEqual(before);
  });

  it("reset restores default inputs and empties UART/interrupt state, preserving RAM", () => {
    const cpu = cpuWith();
    cpu.writeMemory("iram", 0x40, 0xaa);
    cpu.setPortInput(0, 0);
    write(cpu, [[SFR.SCON, 0x10], [SFR.SBUF, 7]]);
    cpu.receiveSerial(8);
    cpu.reset();
    expect(cpu.memory.readIndirect(0x40)).toBe(0xaa);
    expect(cpu.state().peripherals.ports[0]).toEqual({ latch: 0xff, input: 0xff, pins: 0xff });
    expect(cpu.state().peripherals.serial).toMatchObject({ txBusy: false, rxQueued: 0, rxBuffer: 0, txOutput: [] });
  });

  it("PUSH SP reads after increment; POP SP writes after decrement", () => {
    const push = cpuWith(0xc0, SFR.SP);
    push.step();
    expect(push.memory.readIndirect(8)).toBe(8);
    const pop = cpuWith(0xd0, SFR.SP);
    pop.setRegister("SP", 9);
    pop.writeMemory("iram", 9, 0x40);
    pop.step();
    expect(pop.state().sp).toBe(0x40);
  });

  it("validates operand destinations before changes and validates host APIs", () => {
    const cpu = cpuWith(0x85, SFR.ACC, 0x84);
    cpu.setRegister("ACC", 0x55);
    const before = cpu.snapshot();
    expect(() => cpu.step()).toThrow();
    expect(cpu.snapshot()).toEqual(before);
    expect(() => cpu.setPortInput(4, 0)).toThrow();
    expect(() => cpu.receiveSerial(256)).toThrow();
    expect(() => cpu.writeMemory("code", 0, 0)).toThrow();
    expect(() => cpu.setRegister("PC", -1)).toThrow();
    expect(() => cpu.writeMemory("sfr", 0x84, 0)).toThrow();
    expect(cpu.snapshot()).toEqual(before);
  });
});
