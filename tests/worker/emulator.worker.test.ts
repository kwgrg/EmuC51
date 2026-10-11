import { readFileSync } from "node:fs";
import { assemble } from "../../src/core/assembler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmulatorCommand, EmulatorEvent } from "../../src/worker/protocol";

type WithoutRequest<T> = T extends unknown ? Omit<T, "requestId"> : never;
type WorkerScope = {
  onmessage: ((event: MessageEvent<EmulatorCommand>) => void) | null;
  postMessage: (event: EmulatorEvent) => void;
};

let events: EmulatorEvent[];
let scope: WorkerScope;
let requestId: number;

const send = (command: WithoutRequest<EmulatorCommand>): number => {
  const id = ++requestId;
  scope.onmessage!({ data: { ...command, requestId: id } } as MessageEvent<EmulatorCommand>);
  return id;
};
const load = (...bytes: number[]): void => {
  send({ type: "LoadFirmware", name: "test.bin", bytes: Uint8Array.from(bytes).buffer });
};
const stopped = () => events.filter((event) => event.type === "Stopped").at(-1)!;
const traces = () => events.flatMap((event) => event.type === "TraceBatch" ? event.trace : []);

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockReturnValue(0);
  events = [];
  requestId = 0;
  scope = { onmessage: null, postMessage: (event) => events.push(event) };
  vi.stubGlobal("self", scope);
  await import("../../src/worker/emulator.worker");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("emulator worker debugger", () => {
  it("stops at address zero before executing, then bypasses one loop instruction on resume", () => {
    load(0x80, 0xfe);
    send({ type: "SetDebugConfig", breakpoints: [0], watchpoints: [] });
    send({ type: "Run", maxSteps: 20, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", address: 0, state: { pc: 0, steps: 0 } });
    expect(traces()).toHaveLength(0);
    send({ type: "Run", maxSteps: 20, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", address: 0, state: { pc: 0, steps: 1 } });
    expect(traces()).toHaveLength(1);
  });

  it("does not bypass a breakpoint after moving PC to another breakpoint", () => {
    load(0x00, 0x00);
    send({ type: "SetDebugConfig", breakpoints: [0, 1], watchpoints: [] });
    send({ type: "Run", maxSteps: 20, trace: false });
    vi.runAllTimers();
    send({ type: "SetRegister", name: "PC", value: 1 });
    send({ type: "Run", maxSteps: 20, trace: false });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", address: 1, state: { pc: 1, steps: 0 } });
  });

  it("runs to an address before executing it, including current address and last budget tick", () => {
    load(0x00, 0x00, 0x04);
    send({ type: "RunToAddress", address: 0, maxSteps: 0, trace: true });
    expect(stopped()).toMatchObject({ reason: "RunToAddress", state: { pc: 0, steps: 0 } });
    send({ type: "RunToAddress", address: 2, maxSteps: 2, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "RunToAddress", address: 2, state: { pc: 2, steps: 2, acc: 0 } });
  });

  it.each([
    [0x12, 0x00, 0x06, 0x00, 0x00, 0x00, 0x04, 0x22],
    [0x11, 0x06, 0x00, 0x00, 0x00, 0x00, 0x04, 0x22],
  ])("steps over calls and returns with the original stack pointer %#", (...program) => {
    load(...program);
    send({ type: "StepOver", maxSteps: 20, trace: true });
    vi.runAllTimers();
    const returnPc = program[0] === 0x12 ? 3 : 2;
    expect(stopped()).toMatchObject({ reason: "StepComplete", address: returnPc, state: { pc: returnPc, acc: 1, sp: 7, steps: 3 } });
    expect(traces()).toHaveLength(3);
  });

  it("does not complete step-over when a nested call visits the caller return address", () => {
    // Main calls 8; subroutine calls 3; PC=3 is reached with SP=11 before returning.
    load(0x12, 0x00, 0x08, 0x04, 0x22, 0x00, 0x00, 0x00, 0x12, 0x00, 0x03, 0x22);
    send({ type: "StepOver", maxSteps: 20, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "StepComplete", state: { pc: 3, sp: 7, acc: 1, steps: 5 } });
  });

  it("steps over a call when an interrupt enters before the call executes", () => {
    const bytes = new Uint8Array(0x22);
    bytes.set([0x12, 0x00, 0x20]);
    bytes.set([0x04, 0x32], 0x0b); // Timer 0 ISR: INC A; RETI.
    bytes.set([0x04, 0x22], 0x20);
    send({ type: "LoadFirmware", name: "interrupt.bin", bytes: bytes.buffer });
    const ready = events.find((event) => event.type === "Ready")!;
    ready.snapshot.sfr[0x08] = 0x20;
    ready.snapshot.sfr[0x28] = 0x82;
    send({ type: "RestoreWorkspace", name: "interrupt.bin", bytes: bytes.buffer, snapshot: ready.snapshot });
    send({ type: "StepOver", maxSteps: 20, trace: true });
    vi.runAllTimers();
    expect(traces()[0]!.kind).toBe("interrupt");
    expect(stopped()).toMatchObject({ reason: "StepComplete", state: { pc: 3, sp: 7, acc: 2, steps: 5 } });
  });

  it("steps over a non-call once and honors breakpoints inside calls", () => {
    load(0x04, 0x12, 0x00, 0x06, 0x00, 0x00, 0x22);
    send({ type: "StepOver", maxSteps: 20, trace: false });
    expect(stopped()).toMatchObject({ reason: "StepComplete", state: { pc: 1, steps: 1, acc: 1 } });
    send({ type: "SetDebugConfig", breakpoints: [1, 6], watchpoints: [] });
    send({ type: "StepOver", maxSteps: 20, trace: false });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", address: 6, state: { pc: 6, sp: 9 } });
  });

  it("observes a changed IRAM byte, skipping same-value writes", () => {
    load(0x75, 0x20, 0x00, 0x75, 0x20, 0x5a, 0x04);
    send({ type: "SetDebugConfig", breakpoints: [], watchpoints: [{ space: "iram", address: 0x20 }] });
    send({ type: "Run", maxSteps: 20, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({
      reason: "Watchpoint", address: 0x20, state: { pc: 6, steps: 2, acc: 0 },
      watchpoint: { space: "iram", address: 0x20, previous: 0, value: 0x5a },
    });
    expect(traces()).toHaveLength(2);
  });

  it("reports SFR watchpoints in address order and watches XRAM writes", () => {
    load(0x74, 0x01);
    send({ type: "SetDebugConfig", breakpoints: [], watchpoints: [{ space: "sfr", address: 0xe0 }, { space: "sfr", address: 0xd0 }] });
    send({ type: "Step", trace: true });
    expect(stopped()).toMatchObject({ reason: "Watchpoint", watchpoint: { space: "sfr", address: 0xd0, previous: 0, value: 1 } });
    load(0x90, 0x12, 0x34, 0x74, 0x42, 0xf0);
    send({ type: "SetDebugConfig", breakpoints: [], watchpoints: [{ space: "xram", address: 0x1234 }] });
    send({ type: "Run", maxSteps: 20, trace: false });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Watchpoint", state: { pc: 6, steps: 3 }, watchpoint: { space: "xram", address: 0x1234, previous: 0, value: 0x42 } });
  });

  it("retains successful trace steps before a fault and reports the fault PC", () => {
    load(0x00, 0x74, 0x5a, 0xa5);
    const runId = send({ type: "Run", maxSteps: 20, trace: true });
    vi.runAllTimers();
    expect(traces().map((step) => step.pcBefore)).toEqual([0, 1]);
    expect(events.at(-1)).toMatchObject({ type: "ExecutionFault", requestId: runId, error: { code: "ILLEGAL_OPCODE", pc: 3 }, state: { pc: 3, steps: 2, acc: 0x5a } });
    expect(events.findIndex((event) => event.type === "TraceBatch")).toBeLessThan(events.findIndex((event) => event.type === "ExecutionFault"));
  });

  it("bounds each trace batch to the latest 1000 steps", () => {
    load(0x80, 0xfe);
    send({ type: "Run", maxSteps: 2500, trace: true });
    vi.runAllTimers();
    const batches = events.filter((event) => event.type === "TraceBatch");
    expect(batches).toHaveLength(1);
    expect(batches[0]!.trace).toHaveLength(1000);
    expect(batches[0]!.trace[0]!.state.steps).toBe(1501);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { steps: 2500 } });
  });

  it("pauses between bounded chunks and invalidates scheduled work", () => {
    load(0x80, 0xfe);
    send({ type: "Run", maxSteps: 20000, trace: false });
    vi.runOnlyPendingTimers();
    const pauseId = send({ type: "Pause" });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ requestId: pauseId, reason: "Paused", state: { steps: 10000 } });
  });

  it("supports stopped memory and register editing with fresh snapshots", () => {
    load(0x00);
    send({ type: "WriteMemory", space: "iram", address: 0x20, value: 0x5a });
    send({ type: "ReadMemory", space: "iram", address: 0x20, length: 1 });
    expect(events.at(-1)).toMatchObject({ type: "MemoryData", bytes: Uint8Array.of(0x5a) });
    send({ type: "SetRegister", name: "ACC", value: 0x42 });
    send({ type: "SetRegister", name: "PC", value: 0x1234 });
    expect(events.at(-1)).toMatchObject({ type: "SnapshotCreated", snapshot: { pc: 0x1234 } });
    const states = events.filter((event) => event.type === "StateChanged");
    expect(states.at(-1)).toMatchObject({ state: { pc: 0x1234, acc: 0x42 }, running: false });
  });

  it("rejects edits during a run without stopping it, allowing live GPIO and serial inputs", () => {
    load(0x80, 0xfe);
    send({ type: "WriteMemory", space: "sfr", address: 0x98, value: 0x10 });
    send({ type: "Run", maxSteps: 2, trace: false });
    const editId = send({ type: "SetRegister", name: "ACC", value: 0x42 });
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", requestId: editId });
    send({ type: "SetPortInput", port: 1, value: 0x12 });
    const liveState = events.filter((event) => event.type === "StateChanged").at(-1)!;
    expect(liveState.running).toBe(true);
    expect(liveState.state.peripherals.ports[1]).toMatchObject({ input: 0x12, pins: 0x12 });
    send({ type: "ReceiveSerial", value: 0x5a, ninthBit: false });
    expect(events.filter((event) => event.type === "StateChanged").at(-1)!.running).toBe(true);
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { steps: 2, acc: 0 } });
  });

  it("emits serial bytes once, preserves console history, and omits history from traces", () => {
    // Mode 0 completes a transmit after eight machine cycles.
    load(0x75, 0x99, 0x41, 0x80, 0xfe);
    send({ type: "Run", maxSteps: 20, trace: true });
    vi.runAllTimers();
    expect(events.filter((event) => event.type === "SerialOutput").flatMap((event) => event.bytes)).toEqual([0x41]);
    expect(stopped().state.peripherals.serial.txOutput).toEqual([0x41]);
    expect(Math.max(...traces().map((step) => step.state.peripherals.serial.txOutput.length))).toBe(0);
    send({ type: "RestoreWorkspace", name: "test.bin", bytes: Uint8Array.of(0x75, 0x99, 0x41, 0x80, 0xfe).buffer, snapshot: stopped().snapshot });
    send({ type: "Run", maxSteps: 5, trace: false });
    vi.runAllTimers();
    expect(stopped().state.peripherals.serial.txOutput).toEqual([0x41]);
    expect(events.filter((event) => event.type === "SerialOutput").flatMap((event) => event.bytes)).toEqual([0x41]);
  });

  it("stops naturally on power-down and bounds idle ticks", () => {
    load(0x75, 0x87, 0x02);
    send({ type: "Run", maxSteps: 1000, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "PowerDown", state: { steps: 1, pc: 3 } });
    load(0x75, 0x87, 0x01);
    send({ type: "Run", maxSteps: 5, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { steps: 1, pc: 3, machineCycles: 6 } });
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid work budget %s", (maxSteps) => {
    load(0x00);
    const id = send({ type: "Run", maxSteps, trace: false });
    vi.runAllTimers();
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", requestId: id });
    expect(events.filter((event) => event.type === "Stopped")).toHaveLength(0);
  });

  it("keeps valid debugger config after rejecting a bad replacement", () => {
    load(0x00);
    send({ type: "SetDebugConfig", breakpoints: [0], watchpoints: [] });
    send({ type: "SetDebugConfig", breakpoints: [65536], watchpoints: [] });
    expect(events.at(-1)?.type).toBe("CommandRejected");
    send({ type: "Run", maxSteps: 1, trace: false });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { steps: 0 } });
  });

  it("rejects malformed requests and memory ranges without mutating CPU state", () => {
    load(0x00);
    scope.onmessage!({ data: null } as unknown as MessageEvent<EmulatorCommand>);
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", requestId: 0 });
    send({ type: "ReadMemory", space: "iram", address: 127, length: 2 });
    expect(events.at(-1)?.type).toBe("CommandRejected");
    send({ type: "WriteMemory", space: "iram", address: 0, value: 256 });
    expect(events.at(-1)?.type).toBe("CommandRejected");
    send({ type: "Run", maxSteps: 0, trace: false });
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { steps: 0 } });
  });
});

describe("counted breakpoint execution", () => {
  const configure = (hitCount = 3, enabled = true, address = 0) => send({
    type: "SetDebugConfig", breakpoints: [address], watchpoints: [],
    breakpointOptions: [{ address, enabled, hitCount }],
  });
  const run = (maxSteps = 50) => { send({ type: "Run", maxSteps, trace: true }); vi.runAllTimers(); };

  it("counts loop visits before execution, survives budgets/pause, and resumes once", () => {
    load(0x04, 0x80, 0xfd); // INC A; SJMP 0.
    configure();
    run(2);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { acc: 1 } });
    send({ type: "Pause" });
    configure(); // Applying identical settings preserves progress.
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { pc: 0, acc: 2, steps: 4 } });
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { pc: 0, acc: 5, steps: 10 } });
    send({ type: "Reset" });
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { acc: 2, steps: 4 } });
  });

  it("disabled breakpoints run through and re-enabling starts a fresh count", () => {
    load(0x04, 0x80, 0xfd);
    configure(3, false);
    run(10);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { acc: 5 } });
    configure(3);
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { acc: 7 } });
  });

  it("idle ticks are not encounters of the suspended PC", () => {
    load(0x75, 0x87, 0x01, 0x04, 0x80, 0xfd);
    configure(2, true, 3);
    run(10);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { pc: 3, steps: 1, acc: 0 } });
    send({ type: "WriteMemory", space: "sfr", address: 0x87, value: 0 });
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { pc: 3, acc: 1, steps: 3 } });
  });

  it("interrupt entry does not count as a visit to the interrupted instruction", () => {
    const program = new Uint8Array(12);
    program.set([0x04, 0x80, 0xfd]);
    program[0x0b] = 0x32; // RETI.
    load(...program);
    const snapshot = events.find((event) => event.type === "Ready")!.snapshot;
    snapshot.sfr[0x08] = 0x20; // TF0 pending.
    snapshot.sfr[0x28] = 0x82; // EA + ET0.
    send({ type: "RestoreWorkspace", name: "irq.bin", bytes: program.buffer, snapshot });
    configure(2);
    run();
    expect(traces()[0]!.kind).toBe("interrupt");
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { pc: 0, acc: 1, steps: 3, sp: 7 } });
  });

  it("single-step does not count; restoring and PC edits clear partial progress", () => {
    const program = Uint8Array.of(0x04, 0x80, 0xfd);
    load(...program);
    configure(2);
    send({ type: "Step", trace: true });
    send({ type: "Step", trace: true });
    run(2);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { acc: 2 } });
    const snapshot = stopped().snapshot;
    send({ type: "RestoreWorkspace", name: "loop.bin", bytes: program.buffer, snapshot });
    run(2);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { acc: 3 } });
    send({ type: "SetRegister", name: "PC", value: 0 });
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { acc: 4 } });
  });
});

describe("breakpoint resume around interrupts", () => {
  it("preserves the one-time bypass until the interrupted instruction really executes", () => {
    const program = new Uint8Array(12);
    program.set([0x04, 0x80, 0xfd]);
    program[0x0b] = 0x32;
    load(...program);
    const snapshot = events.find((event) => event.type === "Ready")!.snapshot;
    snapshot.sfr[0x28] = 0x82;
    send({ type: "RestoreWorkspace", name: "irq.bin", bytes: program.buffer, snapshot });
    send({ type: "SetDebugConfig", breakpoints: [0], watchpoints: [] });
    send({ type: "Run", maxSteps: 50, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { acc: 0, steps: 0 } });
    send({ type: "WriteMemory", space: "sfr", address: 0x88, value: 0x20 });
    send({ type: "Run", maxSteps: 50, trace: true });
    vi.runAllTimers();
    expect(traces()[0]!.kind).toBe("interrupt");
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { pc: 0, acc: 1, steps: 3, sp: 7 } });
  });

  it("counts subroutine visits across separate step-over operations", () => {
    load(0x12, 0, 6, 0x80, 0xfb, 0, 0x04, 0x22);
    send({ type: "SetDebugConfig", breakpoints: [6], watchpoints: [], breakpointOptions: [{ address: 6, enabled: true, hitCount: 2 }] });
    send({ type: "StepOver", maxSteps: 50, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "StepComplete", state: { pc: 3, acc: 1 } });
    send({ type: "Step", trace: true });
    send({ type: "StepOver", maxSteps: 50, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { pc: 6, acc: 1, steps: 5, sp: 9 } });
  });
});

describe("Step Out with verified frames", () => {
  const out = (maxSteps = 50) => { send({ type: "StepOut", maxSteps, trace: true }); vi.runAllTimers(); };

  it("leaves exactly the selected nested frame and completes at the budget boundary", () => {
    load(0x12, 0, 4, 0, 0x12, 0, 8, 0x22, 0x04, 0x22);
    send({ type: "Step", trace: true });
    expect(stopped().state.callStack.frames).toHaveLength(1);
    out(4); // Nested CALL, INC A, RET, outer RET.
    expect(stopped()).toMatchObject({ reason: "StepComplete", state: { pc: 3, sp: 7, acc: 1, steps: 5 } });
    expect(stopped().state.callStack.frames).toHaveLength(0);
    out();
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", running: false });
  });

  it("honors internal breakpoints, resumes, and does not stop on an address match alone", () => {
    // Helper deliberately visits the outer return address at PC 3 with a deeper SP.
    load(0x12, 0, 8, 0x04, 0x22, 0, 0, 0, 0x12, 0, 3, 0x22);
    send({ type: "Step", trace: true });
    send({ type: "SetDebugConfig", breakpoints: [3], watchpoints: [] });
    out();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { pc: 3, sp: 11 } });
    expect(stopped().state.callStack.frames).toHaveLength(2);
    out(); // New command selects the current (inner) frame.
    expect(stopped()).toMatchObject({ reason: "StepComplete", state: { pc: 11, sp: 9, acc: 1 } });
    out();
    expect(stopped()).toMatchObject({ reason: "StepComplete", state: { pc: 3, sp: 7 } });
  });

  it("finishes an interrupt frame on RETI and preserves unknown older history", () => {
    const program = new Uint8Array(12);
    program[0x0b] = 0x32;
    load(...program);
    const snapshot = events.find((event) => event.type === "Ready")!.snapshot;
    snapshot.sfr[8] = 0x20;
    snapshot.sfr[0x28] = 0x82;
    send({ type: "RestoreWorkspace", name: "irq.bin", bytes: program.buffer, snapshot });
    send({ type: "Step", trace: true });
    expect(stopped().state.callStack).toMatchObject({ complete: false, frames: [{ kind: "interrupt", source: "timer0" }] });
    out(1);
    expect(stopped()).toMatchObject({ reason: "StepComplete", state: { pc: 0, sp: 7, steps: 1 } });
    expect(stopped().state.peripherals.interrupt.activePriorities).toEqual([]);
  });

  it.each([
    ["return slot write", [0x75, 8, 3, 0x22]],
    ["explicit SP edit", [0x75, 0x81, 9, 0x22]],
    ["mismatched RETI", [0x32]],
    ["unbalanced PUSH then RET", [0xc0, 0xe0, 0x22]],
  ])("stops instead of pretending to return after %s", (_name, body) => {
    load(0x12, 0, 4, 0, ...body);
    send({ type: "Step", trace: true });
    out();
    expect(stopped().reason).toBe("CallStackInvalidated");
    expect(stopped().state.callStack).toMatchObject({ complete: false, frames: [] });
  });

  it("is bounded, can pause between chunks, and cancels stale scheduled work", () => {
    load(0x12, 0, 4, 0, 0x80, 0xfe);
    send({ type: "Step", trace: true });
    out(0);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { steps: 1 } });
    out(5);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { steps: 6 } });
    send({ type: "StepOut", maxSteps: 100_000, trace: false });
    vi.runOnlyPendingTimers();
    send({ type: "Pause" });
    const steps = stopped().state.steps;
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Paused", state: { steps } });
    expect(stopped().state.callStack.frames).toHaveLength(1);
  });

  it("reports stack faults, preserves trustworthy caller frames and respects power-down", () => {
    load(0x12, 0, 4, 0, 0x12, 0, 4);
    send({ type: "SetRegister", name: "SP", value: 0x7d });
    send({ type: "Step", trace: true });
    out();
    expect(events.at(-1)).toMatchObject({ type: "ExecutionFault", error: { code: "INVALID_IRAM_ADDRESS" } });
    const fault = events.at(-1);
    if (fault?.type !== "ExecutionFault") throw new Error("expected fault");
    expect(fault.state!.callStack.frames).toHaveLength(1);
    load(0x12, 0, 4, 0, 0x75, 0x87, 2);
    send({ type: "Step", trace: true });
    out();
    expect(stopped().reason).toBe("PowerDown");
  });

  it("rejects missing history and invalid requests without starting or cancelling a run", () => {
    load(0x12, 0, 4, 0, 0x80, 0xfe);
    out();
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", running: false });
    send({ type: "Step", trace: true });
    const snapshot = stopped().snapshot;
    send({ type: "RestoreWorkspace", name: "restored.bin", bytes: Uint8Array.of(0x12, 0, 4, 0, 0x80, 0xfe).buffer, snapshot });
    out();
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", running: false });
    send({ type: "Run", maxSteps: 5, trace: false });
    send({ type: "StepOut", maxSteps: 5, trace: false });
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", running: true });
    vi.runAllTimers();
    expect(stopped().reason).toBe("StepLimitReached");
  });
});

describe("Step Out stop boundaries", () => {
  it("does not finish when control jumps to the return address without returning", () => {
    load(0x12, 0, 6, 0x80, 0xfe, 0, 0x02, 0, 3);
    send({ type: "Step", trace: false });
    send({ type: "StepOut", maxSteps: 5, trace: false });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { pc: 3, sp: 9 } });
    expect(stopped().state.callStack.frames).toHaveLength(1);
  });

  it("honors watchpoints and charges idle cycles against the Step Out budget", () => {
    load(0x12, 0, 4, 0, 0x75, 0x20, 0x42, 0x75, 0x87, 1);
    send({ type: "Step", trace: false });
    send({ type: "SetDebugConfig", breakpoints: [], watchpoints: [{ space: "iram", address: 0x20 }] });
    send({ type: "StepOut", maxSteps: 50, trace: false });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "Watchpoint", state: { pc: 7, steps: 2 } });
    expect(stopped().state.callStack.frames).toHaveLength(1);
    send({ type: "StepOut", maxSteps: 5, trace: false });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { pc: 10, steps: 3, peripherals: { powerMode: "idle" } } });
  });
});

describe("watch expression sampling", () => {
  it("returns a coherent batch, isolates errors and leaves execution untouched", () => {
    load(0x04, 0x80, 0xfd);
    send({ type: "SetDebugConfig", breakpoints: [], watchpoints: [{ space: "iram", address: 0 }] });
    send({ type: "Run", maxSteps: 20, trace: false });
    const id = send({ type: "EvaluateExpressions", expressions: ["PC", "ACC", "IRAM[0]", "1/0"] });
    expect(events.find(e => e.type === "WatchResults" && e.requestId === id)).toMatchObject({
      pc: 0, steps: 0, results: [{ value: 0 }, { value: 0 }, { value: 0 }, { error: "不能除以零" }],
    });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { steps: 20, acc: 10 } });
  });

  it("rejects malformed or oversized batches without losing the machine", () => {
    load(0);
    for (const expressions of [Array(33).fill("PC"), Array(2), [42], null]) {
      const id = send({ type: "EvaluateExpressions", expressions: expressions as string[] });
      expect(events.find(e => e.requestId === id)).toMatchObject({ type: "CommandRejected" });
    }
    const id = send({ type: "EvaluateExpressions", expressions: ["SP"] });
    expect(events.find(e => e.requestId === id)).toMatchObject({ type: "WatchResults", results: [{ value: 7 }] });
  });
});

describe("conditional breakpoint execution", () => {
  const configure = (condition: string, hitCount = 1, address = 0, enabled = true) => send({
    type: "SetDebugConfig", breakpoints: [address], watchpoints: [], breakpointOptions: [{ address, enabled, hitCount, condition }],
  });
  const run = (maxSteps = 100) => { send({ type: "Run", maxSteps, trace: true }); vi.runAllTimers(); };
  it("counts matching loop visits and resumes once, resets condition progress on restore", () => {
    const program = Uint8Array.of(0x04, 0x80, 0xfd);
    load(...program);
    configure("ACC >= 2", 2);
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { pc: 0, acc: 3, steps: 6 } });
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { acc: 5, steps: 10 } });
    const snapshot = stopped().snapshot;
    send({ type: "RestoreWorkspace", name: "loop.bin", bytes: program.buffer, snapshot });
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { acc: 6, steps: 12 } });
  });
  it.each(["1/ACC", "IRAM[128]", "missing == 0", "ACC = 1"])("stops on %s before execution and retries errors on resume", condition => {
    load(0x04, 0x80, 0xfd);
    configure(condition);
    run();
    expect(stopped()).toMatchObject({ reason: "BreakpointConditionError", state: { pc: 0, acc: 0, steps: 0 }, conditionError: { expression: condition } });
    const snapshot = stopped().snapshot;
    run();
    expect(stopped().snapshot).toEqual(snapshot);
    expect(stopped().reason).toBe("BreakpointConditionError");
    configure("ACC == 0");
    run();
    expect(stopped()).toMatchObject({ reason: "Breakpoint", state: { steps: 0 } });
    send({ type: "Step", trace: false });
    expect(stopped()).toMatchObject({ reason: "StepComplete", state: { acc: 1 } });
  });
  it("does not evaluate an idle instruction or the interrupted PC before IRQ entry", () => {
    const program = new Uint8Array(12);
    program[0x0b] = 0x32;
    load(...program);
    configure("1/0");
    send({ type: "WriteMemory", space: "sfr", address: 0x87, value: 1 });
    run(3);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { pc: 0, steps: 0 } });
    send({ type: "WriteMemory", space: "sfr", address: 0x88, value: 0x20 });
    send({ type: "WriteMemory", space: "sfr", address: 0xa8, value: 0x82 });
    run();
    expect(traces().some(step => step.kind === "interrupt")).toBe(true);
    expect(stopped()).toMatchObject({ reason: "BreakpointConditionError", state: { pc: 0, sp: 7, steps: 1 } });
  });
  it("does not use peripheral read hooks or mutate the CPU while testing a true condition", () => {
    load(0x00);
    send({ type: "SetPortInput", port: 1, value: 0 });
    send({ type: "ReceiveSerial", value: 42 });
    send({ type: "CreateSnapshot" });
    const before = events.filter(event => event.type === "SnapshotCreated").at(-1)!.snapshot;
    configure("(P1 == 255) & (SFR[0x90] == 255) & (SBUF >= 0) & (IE >= 0) & (IP >= 0)");
    run();
    expect(stopped().reason).toBe("Breakpoint");
    expect(stopped().snapshot).toEqual(before);
  });
  it("preserves completed trace and the verified frame when Step Over/Out stops on a condition error", () => {
    load(0x12, 0, 6, 0x00, 0x00, 0x00, 0x04, 0x22);
    configure("1/0", 1, 7);
    send({ type: "StepOver", maxSteps: 20, trace: true });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "BreakpointConditionError", state: { pc: 7, acc: 1, steps: 2 } });
    expect(traces()).toHaveLength(2);
    expect(stopped().state.callStack.frames).toHaveLength(1);
    // Move back one instruction while keeping the same trusted frame using a fresh run.
    send({ type: "Reset" });
    send({ type: "Step", trace: false });
    send({ type: "StepOut", maxSteps: 20, trace: false });
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ reason: "BreakpointConditionError", state: { pc: 7, sp: 9 } });
    configure("0", 1, 7);
    run(1);
    expect(stopped()).toMatchObject({ reason: "StepLimitReached", state: { pc: 3, sp: 7 } });
  });
});

describe("instruction coverage transport and execution boundaries", () => {
  const enable = () => send({ type: "SetCoverage", enabled: true });
  const read = (addresses = [0, 1, 2, 3, 6, 7]) => {
    const id = send({ type: "ReadCoverage", addresses });
    return events.find(event => event.type === "CoverageData" && event.requestId === id)! as Extract<EmulatorEvent, { type: "CoverageData" }>;
  };
  const run = (maxSteps: number) => { send({ type: "Run", maxSteps, trace: false }); vi.runAllTimers(); };
  it("defaults off, counts only starts, preserves disabled records and resumes accumulation", () => {
    load(0x74, 0x12, 0x80, 0xfc);
    run(4);
    expect(read().summary.instructions).toBe(0);
    enable();
    run(4);
    expect(read([0, 1, 2, 3])).toMatchObject({ counts: [2, 0, 2, 0], summary: { instructions: 4, uniqueAddresses: 2 } });
    send({ type: "SetCoverage", enabled: false });
    run(6);
    expect(read().summary.instructions).toBe(4);
    enable();
    send({ type: "Step", trace: false });
    expect(read([0, 2]).counts).toEqual([3, 2]);
  });
  it("does not count pre-instruction breakpoint/condition stops or failed instructions", () => {
    load(0x00, 0xa5); // NOP; reserved opcode.
    enable();
    send({ type: "SetDebugConfig", breakpoints: [0], watchpoints: [], breakpointOptions: [{ address: 0, enabled: true, hitCount: 1, condition: "1/0" }] });
    run(10);
    expect(stopped().reason).toBe("BreakpointConditionError");
    expect(read().summary.instructions).toBe(0);
    send({ type: "SetDebugConfig", breakpoints: [], watchpoints: [] });
    run(10);
    expect(events.at(-1)?.type).toBe("ExecutionFault");
    expect(read([0, 1])).toMatchObject({ counts: [1, 0], summary: { instructions: 1, uniqueAddresses: 1 } });
  });
  it("excludes idle/power-down and IRQ entry but counts actual ISR instructions", () => {
    const program = new Uint8Array(12);
    program[0x0b] = 0x32;
    load(...program);
    enable();
    send({ type: "WriteMemory", space: "sfr", address: 0x87, value: 1 });
    run(5);
    expect(read().summary.instructions).toBe(0);
    send({ type: "WriteMemory", space: "sfr", address: 0x88, value: 0x20 });
    send({ type: "WriteMemory", space: "sfr", address: 0xa8, value: 0x82 });
    run(3); // IE-write delay idle tick, IRQ entry, then RETI.
    expect(read([0, 0x0b])).toMatchObject({ counts: [0, 1], summary: { instructions: 1 } });
    send({ type: "WriteMemory", space: "sfr", address: 0x87, value: 2 });
    send({ type: "Step", trace: false });
    expect(read().summary.instructions).toBe(1);
  });
  it("counts calls/returns during Step Over/Out and the write that triggers a watchpoint", () => {
    load(0x12, 0, 6, 0, 0, 0, 0x04, 0x22);
    enable();
    send({ type: "StepOver", maxSteps: 10, trace: false });
    vi.runAllTimers();
    expect(read([0, 6, 7]).counts).toEqual([1, 1, 1]);
    send({ type: "SetRegister", name: "PC", value: 0 });
    send({ type: "Step", trace: false });
    send({ type: "StepOut", maxSteps: 10, trace: false });
    vi.runAllTimers();
    expect(read([0, 6, 7]).counts).toEqual([2, 2, 2]);
    send({ type: "SetRegister", name: "PC", value: 6 });
    send({ type: "SetDebugConfig", breakpoints: [], watchpoints: [{ space: "sfr", address: 0xe0 }] });
    run(10);
    expect(stopped().reason).toBe("Watchpoint");
    expect(read([6]).counts).toEqual([3]);
  });
  it("clears on reset, disables on restore/replacement, and does not serialize coverage", () => {
    const bytes = Uint8Array.of(0x00);
    load(...bytes);
    enable();
    send({ type: "Step", trace: false });
    expect(stopped().snapshot).not.toHaveProperty("coverage");
    const snapshot = stopped().snapshot;
    send({ type: "RestoreWorkspace", name: "invalid.bin", bytes: bytes.buffer, snapshot: { ...snapshot, iram: new Uint8Array(2) } });
    expect(events.at(-1)?.type).toBe("CommandRejected");
    expect(read().summary).toMatchObject({ enabled: true, instructions: 1 });
    send({ type: "Reset" });
    expect(read().summary).toMatchObject({ enabled: true, instructions: 0 });
    send({ type: "Step", trace: false });
    send({ type: "RestoreWorkspace", name: "same.bin", bytes: bytes.buffer, snapshot });
    expect(read().summary).toMatchObject({ enabled: false, instructions: 0 });
    enable();
    send({ type: "Step", trace: false });
    load(0);
    expect(read().summary).toMatchObject({ enabled: false, instructions: 0 });
  });
  it("bounds read payloads, rejects malformed requests, and clears between running chunks without cancelling execution", () => {
    load(0x80, 0xfe);
    enable();
    const id = send({ type: "Run", maxSteps: 20_000, trace: false });
    vi.runOnlyPendingTimers();
    expect(read().summary.instructions).toBe(10_000);
    const before = read().summary.epoch;
    for (const addresses of [Array(257).fill(0), [-1], [65536], Array(1)]) {
      const requestId = send({ type: "ReadCoverage", addresses });
      expect(events.find(event => event.requestId === requestId)).toMatchObject({ type: "CommandRejected", running: true });
    }
    send({ type: "SetCoverage", enabled: "true" as unknown as boolean });
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", running: true });
    expect(read().summary).toMatchObject({ enabled: true, instructions: 10_000 });
    send({ type: "ClearCoverage" });
    expect(read().summary).toMatchObject({ enabled: true, instructions: 0 });
    expect(read().summary.epoch).toBeGreaterThan(before);
    vi.runAllTimers();
    expect(stopped()).toMatchObject({ requestId: id, reason: "StepLimitReached", state: { steps: 20_000 } });
    expect(read().summary.instructions).toBe(10_000);
    expect(read(Array.from({ length: 256 }, (_, i) => i)).counts).toHaveLength(256);
    // No automatic dense coverage messages in the hot execution loop.
    expect(events.filter(event => event.type === "CoverageChanged" && event.requestId === id)).toHaveLength(1);
  });
});

describe("coverage report snapshots", () => {
  const reports = () => events.filter(event => event.type === "CoverageReportCreated");
  const deferDigest = () => {
    let resolve!: (value: ArrayBuffer) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<ArrayBuffer>((yes, no) => { resolve = yes; reject = no; });
    const digest = vi.fn(() => promise);
    vi.stubGlobal("crypto", { subtle: { digest } });
    return { resolve, reject, digest };
  };
  const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

  it("hashes the actual loaded bytes and exports exact counts, PC and execution steps", async () => {
    const { webcrypto, createHash } = await import("node:crypto");
    vi.stubGlobal("crypto", webcrypto);
    load(0x74, 0x42, 0x80, 0xfc);
    send({ type: "SetCoverage", enabled: true });
    send({ type: "Run", maxSteps: 7, trace: false });
    vi.runAllTimers();
    const id = send({ type: "CreateCoverageReport" });
    await vi.waitFor(() => expect(reports()).toHaveLength(1));
    expect(reports()[0]).toMatchObject({ requestId: id, report: {
      format: "emuc51-instruction-coverage", version: 1, scope: "successful-instruction-starts",
      firmware: { name: "test.bin", byteLength: 4, sha256: createHash("sha256").update(Buffer.from([0x74, 0x42, 0x80, 0xfc])).digest("hex") },
      pc: 2, steps: 7, summary: { instructions: 7, uniqueAddresses: 2 },
      entries: [{ address: 0, count: 4 }, { address: 2, count: 3 }],
    } });
  });

  it("captures all mutable data before asynchronous hashing while execution keeps running", async () => {
    const digest = deferDigest();
    load(0x80, 0xfe);
    send({ type: "SetCoverage", enabled: true });
    send({ type: "Run", maxSteps: 40000, trace: false });
    vi.advanceTimersToNextTimer();
    send({ type: "CreateCoverageReport" });
    vi.advanceTimersToNextTimer();
    digest.resolve(new ArrayBuffer(32));
    await flush();
    expect(reports()[0]?.report).toMatchObject({ steps: 10000, summary: { instructions: 10000 }, entries: [{ address: 0, count: 10000 }] });
    expect(events.filter(event => event.type === "Stopped")).toHaveLength(0);
    vi.runAllTimers();
    expect(stopped().state.steps).toBe(40000);
    expect(reports()[0]?.report.summary.instructions).toBe(10000);
    send({ type: "CreateCoverageReport" });
    await flush();
    expect(reports()[1]?.report.summary.instructions).toBe(40000);
    expect(digest.digest).toHaveBeenCalledOnce();
  });

  it.each(["clear", "reset", "disable", "replace", "restore"])("discards delayed reports after %s", async action => {
    const digest = deferDigest();
    load(0x80, 0xfe);
    send({ type: "SetCoverage", enabled: true });
    send({ type: "Step", trace: false });
    send({ type: "CreateCoverageReport" });
    if (action === "clear") send({ type: "ClearCoverage" });
    else if (action === "reset") send({ type: "Reset" });
    else if (action === "disable") send({ type: "SetCoverage", enabled: false });
    else if (action === "replace") load(0);
    else send({ type: "RestoreWorkspace", name: "same.bin", bytes: Uint8Array.from([0x80, 0xfe]).buffer, snapshot: stopped().snapshot });
    digest.resolve(new ArrayBuffer(32));
    await flush();
    expect(reports()).toEqual([]);
    send({ type: "CreateCoverageReport" });
    await flush();
    expect(reports()).toHaveLength(1);
    expect(reports()[0]?.report.summary.instructions).toBe(action === "disable" ? 1 : 0);
  });

  it("rejects without firmware and recovers from a digest failure without cancelling a run", async () => {
    const noFirmware = send({ type: "CreateCoverageReport" });
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", requestId: noFirmware });
    const digest = deferDigest();
    load(0x80, 0xfe);
    send({ type: "Run", maxSteps: 40000, trace: false });
    const id = send({ type: "CreateCoverageReport" });
    digest.reject(new Error("digest unavailable"));
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "CommandRejected", requestId: id, running: true });
    const retry = deferDigest();
    send({ type: "CreateCoverageReport" });
    retry.resolve(new ArrayBuffer(32));
    await flush();
    expect(reports()).toHaveLength(1);
    vi.runAllTimers();
    expect(stopped().state.steps).toBe(40000);
  });
});

describe("explicit byte operand access watches", () => {
  it("stops on identical writes after the instruction and preserves all matched RMW events", () => {
    load(0x75,0x20,0,0x05,0x20,0x80,0xfe);
    send({ type:"SetDebugConfig",breakpoints:[],watchpoints:[{space:"iram",address:0x20}],accessWatchpoints:[{space:"data",address:0x20,access:"readwrite"}] });
    send({type:"Run",maxSteps:10,trace:false});vi.runAllTimers();
    expect(stopped()).toMatchObject({reason:"OperandWatchpoint",state:{pc:3,steps:1},accesses:[{space:"data",address:0x20,kind:"write",value:0,pc:0}]});
    send({type:"Run",maxSteps:10,trace:false});vi.runAllTimers();
    expect(stopped()).toMatchObject({reason:"OperandWatchpoint",state:{pc:5,steps:2},accesses:[{kind:"read",value:0,pc:3},{kind:"write",value:1,pc:3}]});
  });
  it("isolates DATA/IDATA and supports single-step without tracing", () => {
    load(0x75,0x20,0x42,0x78,0x20,0xe6,0x00);
    send({type:"SetDebugConfig",breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"idata",address:0x20,access:"read"}]});
    send({type:"Run",maxSteps:10,trace:false});vi.runAllTimers();
    expect(stopped()).toMatchObject({reason:"OperandWatchpoint",state:{pc:6,steps:3,acc:0x42},accesses:[{space:"idata",pc:5,kind:"read"}]});
    send({type:"SetRegister",name:"PC",value:5});send({type:"Step",trace:false});
    expect(stopped()).toMatchObject({reason:"OperandWatchpoint",state:{pc:6}});
    send({type:"Step",trace:false});expect(stopped().reason).toBe("StepComplete");
    expect(traces()).toEqual([]);
  });
  it("does not stop for inspection, expression evaluation, edits, GPIO or timer-only updates", () => {
    load(0x00,0x80,0xfd);
    send({type:"SetDebugConfig",breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"sfr",address:0x8a,access:"readwrite"},{space:"sfr",address:0x90,access:"readwrite"},{space:"data",address:0x20,access:"readwrite"}]});
    send({type:"WriteMemory",space:"sfr",address:0x89,value:1});send({type:"WriteMemory",space:"sfr",address:0x88,value:0x10});
    send({type:"WriteMemory",space:"iram",address:0x20,value:9});send({type:"ReadMemory",space:"sfr",address:0x80,length:128});
    send({type:"EvaluateExpressions",expressions:["IRAM[0x20]","SFR[0x90]"]});send({type:"SetPortInput",port:1,value:0});
    expect(events.filter(event=>event.type==="Stopped")).toEqual([]);
    send({type:"Run",maxSteps:5,trace:false});vi.runAllTimers();
    expect(stopped().reason).toBe("StepLimitReached"); expect(stopped().snapshot.sfr[0x8a-0x80]).toBeGreaterThan(0);
  });
  it("runs to a target or steps over calls while still honoring operand watches and resets stale events", () => {
    load(0x12,0,6,0x00,0x80,0xfe,0x75,0x20,0x44,0x22);
    send({type:"SetDebugConfig",breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"data",address:0x20,access:"write"}]});
    send({type:"StepOver",maxSteps:20,trace:false});vi.runAllTimers();
    expect(stopped()).toMatchObject({reason:"OperandWatchpoint",state:{pc:9},accesses:[{pc:6,value:0x44}]});
    send({type:"Reset"});expect(stopped().accesses).toBeUndefined();
    send({type:"RunToAddress",address:3,maxSteps:20,trace:false});vi.runAllTimers();
    expect(stopped().reason).toBe("OperandWatchpoint");
    send({type:"SetDebugConfig",breakpoints:[],watchpoints:[],accessWatchpoints:[]});
    send({type:"RunToAddress",address:3,maxSteps:20,trace:false});vi.runAllTimers();
    expect(stopped()).toMatchObject({reason:"RunToAddress",state:{pc:3}});expect(stopped().accesses).toBeUndefined();
  });
  it("rejects invalid replacements atomically and restores configured operand capture after firmware replacement", () => {
    send({type:"SetDebugConfig",breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"xdata",address:0,access:"write"}]});
    load(0xf0);
    send({type:"SetDebugConfig",breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"idata",address:128,access:"write"}]});
    expect(events.at(-1)?.type).toBe("CommandRejected");
    send({type:"Step",trace:false});expect(stopped()).toMatchObject({reason:"OperandWatchpoint",accesses:[{space:"xdata",address:0,kind:"write",pc:0}]});
    const snapshot=stopped().snapshot;
    send({type:"RestoreWorkspace",name:"again.bin",bytes:Uint8Array.from([0xf0]).buffer,snapshot:{...snapshot,pc:0}});
    send({type:"Step",trace:false});expect(stopped().reason).toBe("OperandWatchpoint");
  });
});

describe("explicit bit operand watches", () => {
  it("preserves pin/latch reads, RMW ordering, same-value writes and instruction PCs through execution controls", () => {
    load(0xa2,0x90,0xb2,0x90,0xc2,0x90,0x10,0x90,0,0x80,0xfe);
    send({type:"SetDebugConfig",breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"bit",address:0x90,access:"readwrite"},{space:"sfr",address:0x90,access:"readwrite"}]});
    send({type:"SetPortInput",port:1,value:0});
    send({type:"Run",maxSteps:20,trace:false});vi.runAllTimers();
    expect(stopped()).toMatchObject({reason:"OperandWatchpoint",state:{pc:2},accesses:[{space:"bit",address:0x90,pc:0,kind:"read",value:0,bit:{byteSpace:"sfr",byteAddress:0x90,index:0,readSource:"pins"}}]});
    send({type:"StepOver",maxSteps:20,trace:false});vi.runAllTimers();
    expect(stopped()).toMatchObject({reason:"OperandWatchpoint",state:{pc:4},accesses:[{pc:2,kind:"read",value:1,bit:{readSource:"latch"}},{pc:2,kind:"write",value:0}]});
    send({type:"RunToAddress",address:9,maxSteps:20,trace:false});vi.runAllTimers();
    expect(stopped()).toMatchObject({state:{pc:6},accesses:[{pc:4,kind:"write",value:0}]});
    send({type:"Step",trace:false}); expect(stopped().accesses).toHaveLength(1);
    expect(stopped()).toMatchObject({state:{pc:9},accesses:[{pc:6,kind:"read",value:0}]});
    send({type:"Step",trace:false}); expect(stopped().reason).toBe("StepComplete");
  });
  it("does not treat byte writes or implicit flags as bit access and retains valid watches after invalid replacements", () => {
    load(0x75,0x20,1,0x74,0xff,0x24,1,0xd3,0xa2,0,0x80,0xfe);
    send({type:"SetDebugConfig",breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"bit",address:0,access:"readwrite"},{space:"bit",address:0xd7,access:"write"}]});
    send({type:"SetDebugConfig",breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"bit",address:0xc0,access:"write"}]});
    expect(events.at(-1)?.type).toBe("CommandRejected");
    send({type:"Run",maxSteps:20,trace:false});vi.runAllTimers();
    expect(stopped()).toMatchObject({reason:"OperandWatchpoint",state:{pc:10,steps:5},accesses:[{pc:8,space:"bit",address:0,kind:"read",value:1,bit:{byteSpace:"data",byteAddress:0x20,index:0}}]});
    expect(stopped().accesses).toHaveLength(1);
    const snapshot=stopped().snapshot;
    send({type:"RestoreWorkspace",name:"bits.bin",bytes:Uint8Array.from([0xa2,0]).buffer,snapshot:{...snapshot,pc:0}});
    send({type:"Step",trace:false}); expect(stopped()).toMatchObject({reason:"OperandWatchpoint",accesses:[{pc:0,space:"bit",address:0,kind:"read",value:1}]});
  });
});

 it("UART TI wakes idle before output completes and a restored acknowledged frame cannot retrigger the ISR", () => {
   const built=assemble(readFileSync("tests/fixtures/peripherals/uart-ti-idle.asm","utf8"));
   expect(built.diagnostics).toEqual([]); load(...built.bytes!);
   send({type:"SetDebugConfig",breakpoints:[0x23],watchpoints:[]});
   send({type:"Run",maxSteps:450,trace:false}); vi.runAllTimers();
   expect(stopped()).toMatchObject({reason:"Breakpoint",state:{pc:0x23},snapshot:{peripherals:{serial:{txFrame:{mode:1,progress:290,tiRaised:true},txOutput:[]}}}});
   send({type:"Step",trace:false}); send({type:"Step",trace:false});
   const snapshot=stopped().snapshot;
   expect(snapshot.sfr[0x98-0x80]!&2).toBe(0);
   send({type:"RestoreWorkspace",name:"uart-ti-idle.bin",bytes:built.bytes!.buffer,snapshot});
   send({type:"Run",maxSteps:450,trace:false}); vi.runAllTimers();
   expect(stopped().reason).toBe("StepLimitReached");
   expect(stopped().snapshot.iram.slice(0x30,0x33)).toEqual(Uint8Array.from([0x23,1,0x55]));
   const final=stopped().snapshot;
   if(final.coreStateVersion!==2) throw new Error("expected v2 snapshot");
   expect(final.peripherals.serial.txOutput).toEqual([0x41]);
   expect(final.peripherals.interruptStack).toEqual([]);
 });

describe("declarative input replay",()=>{
  let definition: import("../../src/core/input-scenario").InputScenario;
  beforeEach(async()=>{
    const {createHash}=await import("node:crypto");
    vi.stubGlobal("crypto",{subtle:{digest:vi.fn(async(_algorithm:string,bytes:ArrayBuffer)=>Uint8Array.from(createHash("sha256").update(new Uint8Array(bytes)).digest()).buffer)}});
    definition={format:"emuc51-input-scenario",version:1,name:"replay",firmwareSha256:createHash("sha256").update(Uint8Array.of(0x80,0xfe)).digest("hex"),events:[{cycle:1,type:"gpio",port:1,value:0x42},{cycle:5,type:"gpio",port:1,value:0x24}]};
  });
  const replayState=()=>events.filter(event=>event.type==="ScenarioChanged").at(-1)!.replay;
  const install=async()=>{send({type:"InstallScenario",scenario:definition});await Promise.resolve();await Promise.resolve();await Promise.resolve();};
  it("prepares without mutation, starts clean, delivers once across pause/breakpoint/budget and cancels pending",async()=>{
    load(0x80,0xfe);send({type:"WriteMemory",space:"iram",address:0x20,value:99});
    await install();expect(replayState().active).toBe(false);
    send({type:"StartScenario"});expect(stopped().snapshot.iram[0x20]).toBe(0);
    send({type:"SetDebugConfig",breakpoints:[0],watchpoints:[]});
    send({type:"Run",maxSteps:20,trace:false});vi.runAllTimers();expect(stopped().state.machineCycles).toBe(0);expect(replayState().delivered).toEqual([]);
    send({type:"Run",maxSteps:20,trace:false});vi.runAllTimers();expect(stopped().reason).toBe("Breakpoint");expect(replayState().delivered).toEqual([2]);
    send({type:"Pause"});expect(replayState().delivered).toEqual([2]);
    send({type:"Step",trace:false});expect(replayState().delivered).toEqual([2]);
    send({type:"CancelScenario"});send({type:"Run",maxSteps:20,trace:false});vi.runAllTimers();expect(replayState()).toEqual({active:false,delivered:[2]});
    send({type:"Reset"});expect(replayState()).toEqual({active:false,delivered:[]});
  });
  it("rejects manual writes and repeated start while active, while cancellation leaves the CPU running",async()=>{
    load(0x80,0xfe);await install();send({type:"StartScenario"});
    for(const command of [{type:"SetPortInput",port:1,value:0},{type:"ReceiveSerial",value:65},{type:"SetRegister",name:"A",value:1},{type:"WriteMemory",space:"iram",address:0x20,value:1},{type:"StartScenario"},{type:"InstallScenario",scenario:definition},{type:"ClearScenario"}] as WithoutRequest<EmulatorCommand>[]) {
      const id=send(command);expect(events.some(event=>event.type==="CommandRejected"&&event.requestId===id)).toBe(true);
    }
    send({type:"Run",maxSteps:10,trace:false});send({type:"CancelScenario"});vi.runAllTimers();
    expect(stopped().reason).toBe("StepLimitReached");expect(stopped().state.steps).toBe(10);expect(replayState().delivered).toEqual([]);
    send({type:"SetPortInput",port:1,value:0x7f});expect(events.at(-1)!.type).toBe("SnapshotCreated");
  });
  it("preserves StepOut and counts only successful instructions in coverage",async()=>{
    const bytes=Uint8Array.of(0x12,0,6,0x80,0xfe,0,0,0x22);
    const {createHash}=await import("node:crypto");definition.firmwareSha256=createHash("sha256").update(bytes).digest("hex");
    load(...bytes);await install();send({type:"SetCoverage",enabled:true});send({type:"StartScenario"});
    send({type:"Step",trace:false});expect(stopped().state.pc).toBe(6);
    send({type:"StepOut",maxSteps:20,trace:true});vi.runAllTimers();
    expect(stopped().reason).toBe("StepComplete");expect(stopped().state.pc).toBe(3);expect(replayState().delivered).toEqual([2]);
    send({type:"ReadCoverage",addresses:[0,6,7]});expect(events.at(-1)).toMatchObject({type:"CoverageData",counts:[1,1,1]});
    send({type:"CreateSnapshot"});expect(events.at(-1)).toMatchObject({type:"SnapshotCreated",snapshot:{machineCycles:5}});
    send({type:"CancelScenario"});send({type:"StartScenario"});send({type:"ReadCoverage",addresses:[0,6,7]});expect(events.at(-1)).toMatchObject({counts:[0,0,0]});
  });
  it("restore keeps CPU inputs but disarms scheduling; replacement removes the definition",async()=>{
    load(0x80,0xfe);await install();send({type:"StartScenario"});send({type:"Run",maxSteps:2,trace:false});vi.runAllTimers();
    const snapshot=stopped().snapshot;
    send({type:"RestoreWorkspace",name:"test.bin",bytes:Uint8Array.of(0x80,0xfe).buffer,snapshot});await install();
    expect(replayState()).toEqual({active:false,delivered:[]});send({type:"Run",maxSteps:10,trace:false});vi.runAllTimers();
    expect(stopped().snapshot.coreStateVersion).toBe(2);
    expect((stopped().snapshot as import("../../src/core/types").CpuSnapshotV2).peripherals.portInputs[1]).toBe(0x42);
    load(0);send({type:"StartScenario"});expect(events.at(-1)!.type).toBe("CommandRejected");
  });
  it("rejects malformed and mismatched definitions before replacing an installed scene",async()=>{
    load(0x80,0xfe);await install();const changed=events.filter(event=>event.type==="ScenarioChanged"&&event.definitionChanged).length;
    send({type:"InstallScenario",scenario:{...definition,events:Array(1025).fill(definition.events[0])}});expect(events.at(-1)!.type).toBe("CommandRejected");
    definition={...definition,firmwareSha256:"0".repeat(64)};await install();expect(events.at(-1)!.type).toBe("CommandRejected");
    expect(events.filter(event=>event.type==="ScenarioChanged"&&event.definitionChanged)).toHaveLength(changed);
    send({type:"StartScenario"});expect(replayState().active).toBe(true);
  });
  it("automatic snapshots retain delivered CPU inputs without serializing an active scheduler",async()=>{
    load(0x80,0xfe);await install();send({type:"StartScenario"});
    let clock=0;vi.mocked(performance.now).mockImplementation(()=>clock+=2100);
    send({type:"Run",maxSteps:4,trace:false});vi.runAllTimers();
    const saved=events.filter(event=>event.type==="SnapshotCreated"&&event.automatic);
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.at(-1)).toMatchObject({snapshot:{machineCycles:6,peripherals:{portInputs:[255,66,255,255]}}});
    expect(stopped().state.steps).toBe(4);expect(replayState().delivered).toEqual([2,6]);
  });
  it("recovers from a digest failure without replacing the CPU",async()=>{
    load(0x80,0xfe);vi.mocked(crypto.subtle.digest).mockRejectedValueOnce(new Error("digest failed"));
    await install();await Promise.resolve();expect(events.at(-1)!.type).toBe("CommandRejected");
    await install();await Promise.resolve();expect(replayState().active).toBe(false);
    send({type:"StartScenario"});expect(replayState().active).toBe(true);
  });
  it.each(["CancelScenario","Reset","Run","LoadFirmware"] as const)("does not commit late digest after %s",async(type)=>{
    let resolve!:(bytes:ArrayBuffer)=>void;
    vi.stubGlobal("crypto",{subtle:{digest:()=>new Promise<ArrayBuffer>(done=>{resolve=done;})}});
    load(0x80,0xfe);send({type:"InstallScenario",scenario:definition});
    if(type==="Run")send({type,maxSteps:0,trace:false});else if(type==="LoadFirmware")load(0);else send({type});
    resolve(Uint8Array.from(definition.firmwareSha256.match(/../g)!,byte=>parseInt(byte,16)).buffer);
    for(let i=0;i<8;i++)await Promise.resolve();
    expect(events.some(event=>event.type==="ScenarioChanged"&&event.definitionChanged)).toBe(false);
    expect(events.some(event=>event.type==="CommandRejected")).toBe(false);
  });
});
