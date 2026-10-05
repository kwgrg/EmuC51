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
