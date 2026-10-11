import { describe, expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { SFR } from "../../src/core/memory";

const machine = (...program: number[]) => new Cpu8051(Uint8Array.from(program));
const stack = (cpu: Cpu8051) => cpu.state().callStack;

describe("verified machine-level call frames", () => {
  it.each([
    [0x12, 0, 6, 0, 0, 0, 0xc0, 0xe0, 0xd0, 0xe0, 0x22],
    [0x11, 6, 0, 0, 0, 0, 0xc0, 0xe0, 0xd0, 0xe0, 0x22],
  ])("tracks CALL, preserves balanced PUSH/POP, validates RET %#", (...program) => {
    const cpu = machine(...program);
    const returnAddress = program[0] === 0x12 ? 3 : 2;
    cpu.step();
    expect(stack(cpu)).toMatchObject({ complete: true, frames: [{ kind: "call", callAddress: 0, entryAddress: 6, returnAddress, callerSp: 7, stackSp: 9 }] });
    cpu.step(); cpu.step();
    expect(stack(cpu).frames).toHaveLength(1);
    cpu.step();
    expect(cpu.pc).toBe(returnAddress);
    expect(stack(cpu)).toMatchObject({ complete: true, frames: [] });
  });

  it("tracks nested calls with stable identities and defensive copies", () => {
    const cpu = machine(0x12, 0, 4, 0, 0x12, 0, 8, 0x22, 0x22);
    cpu.step();
    const outer = stack(cpu).frames[0]!;
    cpu.step();
    expect(stack(cpu).frames.map((frame) => frame.returnAddress)).toEqual([3, 7]);
    expect(stack(cpu).frames[1]!.id).not.toBe(outer.id);
    stack(cpu).frames[0]!.returnAddress = 999;
    expect(stack(cpu).frames[0]!.returnAddress).toBe(3);
    cpu.step();
    expect(stack(cpu).frames.map((frame) => frame.id)).toEqual([outer.id]);
    cpu.step();
    expect(stack(cpu).frames).toHaveLength(0);
  });

  it("handles low/high interrupt nesting and RETI without conflating subroutines", () => {
    const program = new Uint8Array(0x30);
    program.set([0x12, 0, 0x20], 0x0b); // timer0 ISR calls a helper.
    program[0x0e] = 0x32;
    program[0x13] = 0x32; // high-priority external1 ISR.
    program[0x20] = 0x22;
    const cpu = new Cpu8051(program);
    cpu.memory.writeDirect(SFR.IE, 0x86);
    cpu.memory.writeDirect(SFR.IP, 4);
    cpu.memory.writeDirect(SFR.TCON, 0x24); // TF0 pending, INT1 edge mode.
    cpu.step(); // IE/IP interrupt deferral.
    cpu.step(); // T0 entry, returns to PC=1.
    expect(stack(cpu).frames[0]).toMatchObject({ kind: "interrupt", source: "timer0", returnAddress: 1 });
    cpu.step(); // helper CALL.
    cpu.setPortInput(3, 0xf7); // INT1 falling edge.
    cpu.step();
    expect(stack(cpu).frames.map((frame) => frame.kind)).toEqual(["interrupt", "call", "interrupt"]);
    expect(stack(cpu).frames[2]!.source).toBe("external1");
    cpu.step(); // high RETI.
    cpu.step(); // helper RET.
    cpu.step(); // low RETI.
    expect(stack(cpu)).toMatchObject({ complete: true, frames: [] });
    expect(cpu.state().peripherals.interrupt.activePriorities).toEqual([]);
    expect(cpu.pc).toBe(1);
  });

  it.each([
    ["same-value direct write", [0x75, 8, 3]],
    ["indirect write", [0x78, 8, 0x76, 3]],
    ["register bank write", [0x75, 0xd0, 8, 0x78, 3]],
    ["explicit SP write", [0x75, 0x81, 9]],
    ["POP crossing return slot", [0xd0, 0xe0]],
  ])("invalidates tracked callers after %s", (_name, body) => {
    const cpu = machine(0x12, 0, 4, 0, ...body);
    cpu.step();
    for (let i = 0; i < (body.length === 4 || body.length === 5 ? 2 : 1); i += 1) cpu.step();
    expect(stack(cpu)).toMatchObject({ complete: false, frames: [] });
  });

  it("detects bit-addressable return-slot writes and manual PC/SP/memory edits", () => {
    const cpu = machine(0x12, 0, 4, 0, 0xc2, 2);
    cpu.setRegister("SP", 0x1f);
    cpu.step();
    expect(stack(cpu).frames).toHaveLength(1);
    cpu.step(); // CLR bit 2 writes IRAM 20, even if the bit is already clear.
    expect(stack(cpu).frames).toHaveLength(0);
    for (const edit of [(c: Cpu8051) => c.setRegister("PC", 4), (c: Cpu8051) => c.setRegister("SP", 9), (c: Cpu8051) => c.writeMemory("iram", 8, 3)]) {
      const c = machine(0x12, 0, 4, 0, 0x22);
      c.step(); edit(c);
      expect(stack(c)).toMatchObject({ complete: false, frames: [] });
    }
  });

  it("does not infer old frames from snapshots, but tracks new calls above unknown history", () => {
    const cpu = machine(0x12, 0, 4, 0, 0x12, 0, 8, 0x22, 0x22);
    cpu.step();
    const snapshot = cpu.snapshot();
    cpu.restore(snapshot);
    expect(stack(cpu)).toMatchObject({ complete: false, frames: [] });
    cpu.step();
    expect(stack(cpu)).toMatchObject({ complete: false, frames: [{ entryAddress: 8, returnAddress: 7 }] });
    cpu.step();
    expect(stack(cpu)).toMatchObject({ complete: false, frames: [] });
    cpu.reset();
    expect(stack(cpu)).toMatchObject({ complete: true, frames: [] });
  });

  it.each([0x22, 0x32])("does not invent a frame for an untracked return %s", (opcode) => {
    const cpu = machine(opcode);
    cpu.step();
    expect(stack(cpu)).toMatchObject({ complete: false, frames: [] });
  });

  it("invalidates a CALL exited by RETI while preserving CPU interrupt semantics", () => {
    const cpu = machine(0x12, 0, 4, 0, 0x32);
    cpu.step(); cpu.step();
    expect(cpu.pc).toBe(3);
    expect(stack(cpu)).toMatchObject({ complete: false, frames: [] });
  });

  it("preserves frames on atomic stack overflow faults and distrusts 8-bit wrapping", () => {
    const cpu = machine(0x12, 0, 4, 0, 0x12, 0, 4);
    cpu.setRegister("SP", 0x7d);
    cpu.step();
    const before = stack(cpu);
    expect(() => cpu.step()).toThrow("间接 IRAM");
    expect(stack(cpu)).toEqual(before);
    expect(cpu.state().sp).toBe(0x7f);
    const wrapped = machine(0x12, 0, 4, 0, 0x22);
    wrapped.setRegister("SP", 0xff);
    wrapped.step();
    expect(wrapped.state().sp).toBe(1);
    expect(stack(wrapped)).toMatchObject({ complete: false, frames: [] });
    wrapped.step();
    expect(wrapped.state().sp).toBe(0xff);
    expect(wrapped.pc).toBe(3);
  });
});

describe("return and stack fault boundaries", () => {
  it("treats RET from an ISR as unknown and leaves interrupt-in-service state intact", () => {
    const program = new Uint8Array(12);
    program[0x0b] = 0x22;
    const cpu = new Cpu8051(program);
    cpu.memory.writeDirect(SFR.IE, 0x82);
    cpu.memory.writeDirect(SFR.TCON, 0x20);
    cpu.step(); cpu.step();
    expect(stack(cpu).frames[0]!.kind).toBe("interrupt");
    cpu.step();
    expect(stack(cpu)).toMatchObject({ complete: false, frames: [] });
    expect(cpu.state().peripherals.interrupt.activePriorities).toEqual([0]);
  });

  it("does not partially pop a return whose low byte is outside classic IRAM", () => {
    const cpu = machine(0x22);
    cpu.setRegister("SP", 0);
    const before = cpu.snapshot();
    expect(() => cpu.step()).toThrow("间接 IRAM");
    expect(cpu.snapshot()).toEqual(before);
    expect(stack(cpu).frames).toHaveLength(0);
  });
});

describe("recursive frame identity", () => {
  it("distinguishes repeated entries and remains bounded by classic IRAM", () => {
    const cpu = machine(0x12, 0, 0); // Recursive LCALL 0000, always returning to 0003.
    for (let depth = 0; depth < 60; depth += 1) cpu.step();
    const frames = stack(cpu).frames;
    expect(frames).toHaveLength(60);
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(60);
    expect(frames.every((frame) => frame.entryAddress === 0 && frame.returnAddress === 3)).toBe(true);
    expect(cpu.state().sp).toBe(0x7f);
    expect(() => cpu.step()).toThrow("间接 IRAM");
    expect(stack(cpu).frames).toEqual(frames);
  });
});
