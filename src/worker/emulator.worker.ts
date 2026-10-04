/// <reference lib="webworker" />

import { Cpu8051 } from "../core/cpu";
import { Debugger8051, assertDebugAddress, assertWritableAddress, type DebugStop } from "../core/debugger";
import { opcodeMeta } from "../core/opcodes";
import { EmulatorFault, type EmulatorFaultData, type MemorySpace, type StepResult } from "../core/types";
import type { EmulatorCommand, EmulatorEvent } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const debugger8051 = new Debugger8051();

let cpu: Cpu8051 | undefined;
let running = false;
let runToken = 0;
let activeRequestId = 0;
let remainingSteps = 0;
let traceEnabled = false;
let lastStateAt = 0;
let lastSnapshotAt = 0;
let target: { address: number; reason: "RunToAddress" | "StepComplete"; sp?: number } | undefined;

const post = (event: EmulatorEvent): void => scope.postMessage(event);

const invalid = (message: string): never => {
  throw new EmulatorFault({ code: "INVALID_INPUT", message });
};

const assertInteger = (value: number, minimum: number, maximum: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid(`${name}必须是 ${minimum} 到 ${maximum} 的整数`);
  }
};

const assertTrace = (value: boolean): void => {
  if (typeof value !== "boolean") invalid("跟踪开关必须是布尔值");
};

const requireCpu = (): Cpu8051 => {
  return cpu ?? invalid("尚未加载固件");
};

const requireStopped = (): Cpu8051 => {
  const machine = requireCpu();
  if (running) invalid("请先暂停模拟器再编辑内存或寄存器");
  return machine;
};

const stopCurrentRun = (): void => {
  running = false;
  runToken += 1;
  target = undefined;
};

const finishRun = (requestId: number, stop: DebugStop): void => {
  const machine = requireCpu();
  stopCurrentRun();
  debugger8051.stopped(stop);
  post({ type: "Stopped", requestId, ...stop, state: machine.state(), snapshot: machine.snapshot() });
};

const faultData = (error: unknown): EmulatorFaultData =>
  error instanceof EmulatorFault
    ? error.data
    : { code: "INVALID_SNAPSHOT", message: error instanceof Error ? error.message : "未知模拟器错误" };

const postSerialOutput = (requestId: number): void => {
  const bytes = cpu?.drainSerialOutput() ?? [];
  if (bytes.length > 0) post({ type: "SerialOutput", requestId, bytes });
};

const reportFault = (requestId: number, error: unknown): void => {
  stopCurrentRun();
  debugger8051.stopped({ reason: "Paused" });
  postSerialOutput(requestId);
  post({ type: "ExecutionFault", requestId, error: faultData(error), state: cpu?.state(), snapshot: cpu?.snapshot() });
};

const flushOutput = (requestId: number, trace: StepResult[], serial: number[]): void => {
  if (trace.length > 0) post({ type: "TraceBatch", requestId, trace });
  if (serial.length > 0) post({ type: "SerialOutput", requestId, bytes: serial });
};

const traceStep = (step: StepResult): StepResult => ({
  ...step,
  state: {
    ...step.state,
    peripherals: {
      ...step.state.peripherals,
      // Console history belongs in state updates and workspace snapshots.
      serial: { ...step.state.peripherals.serial, txOutput: [] },
    },
  },
});

const pump = (token: number): void => {
  if (!running || token !== runToken || !cpu) return;
  const machine = cpu;
  const trace: StepResult[] = [];
  const serial: number[] = [];
  const startedAt = performance.now();
  try {
    const chunkLimit = Math.min(10_000, remainingSteps);
    let stop: DebugStop | undefined;
    for (let executed = 0; executed < chunkLimit; executed += 1) {
      if (target?.address === machine.pc && (target.sp === undefined || target.sp === machine.state().sp)) {
        stop = { reason: target.reason, address: target.address };
        break;
      }
      stop = debugger8051.beforeStep(machine.pc);
      if (stop) break;

      const watched = debugger8051.capture(machine.memory);
      const result = machine.step();
      remainingSteps -= 1;
      if (traceEnabled) {
        trace.push(traceStep(result));
        if (trace.length > 1000) trace.shift();
      }
      // Drain each step so trace states do not repeatedly copy a growing TX queue.
      serial.push(...machine.drainSerialOutput());
      stop = debugger8051.changed(machine.memory, watched);
      if (stop) break;
      if (result.state.peripherals.powerMode === "power-down") {
        stop = { reason: "PowerDown", address: machine.pc };
        break;
      }
      // A reached target wins over the instruction budget at the same boundary.
      if (target?.address === machine.pc && (target.sp === undefined || target.sp === machine.state().sp)) {
        stop = { reason: target.reason, address: target.address };
        break;
      }
      if (performance.now() - startedAt >= 16) break;
    }
    flushOutput(activeRequestId, trace, serial);
    if (stop) {
      finishRun(activeRequestId, stop);
      return;
    }
    if (remainingSteps <= 0) {
      finishRun(activeRequestId, { reason: "StepLimitReached" });
      return;
    }

    const currentTime = performance.now();
    if (currentTime - lastStateAt >= 100) {
      post({ type: "StateChanged", requestId: activeRequestId, state: machine.state(), running: true });
      lastStateAt = currentTime;
    }
    if (currentTime - lastSnapshotAt >= 2000) {
      post({ type: "SnapshotCreated", requestId: activeRequestId, snapshot: machine.snapshot(), automatic: true });
      lastSnapshotAt = currentTime;
    }
    setTimeout(() => pump(token), 0);
  } catch (error) {
    // A later failing instruction must not discard successful instructions in this chunk.
    flushOutput(activeRequestId, trace, serial);
    reportFault(activeRequestId, error);
  }
};

const startRun = (
  requestId: number,
  maxSteps: number,
  trace: boolean,
  runTarget?: typeof target,
  bypassCurrent = false,
): void => {
  assertInteger(maxSteps, 0, Number.MAX_SAFE_INTEGER, "执行步数");
  assertTrace(trace);
  const machine = requireCpu();
  stopCurrentRun();
  debugger8051.beginRun(machine.pc, bypassCurrent);
  activeRequestId = requestId;
  remainingSteps = maxSteps;
  traceEnabled = trace;
  target = runTarget;
  running = true;
  lastStateAt = performance.now();
  lastSnapshotAt = lastStateAt;
  if (target?.address === machine.pc && target.sp === undefined) {
    finishRun(requestId, { reason: target.reason, address: target.address });
  } else if (remainingSteps === 0) {
    finishRun(requestId, { reason: "StepLimitReached" });
  } else {
    const token = runToken;
    setTimeout(() => pump(token), 0);
  }
};

const stepOnce = (requestId: number, trace: boolean): void => {
  stopCurrentRun();
  const machine = requireCpu();
  debugger8051.stopped({ reason: "StepComplete" });
  const watched = debugger8051.capture(machine.memory);
  const step = machine.step();
  flushOutput(requestId, trace ? [traceStep(step)] : [], machine.drainSerialOutput());
  post({ type: "StateChanged", requestId, state: machine.state(), step, running: false });
  post({ type: "SnapshotCreated", requestId, snapshot: machine.snapshot(), automatic: false });
  finishRun(requestId, debugger8051.changed(machine.memory, watched) ?? {
    reason: step.state.peripherals.powerMode === "power-down" ? "PowerDown" : "StepComplete",
  });
};

const postEditedState = (requestId: number): void => {
  const machine = requireCpu();
  post({ type: "StateChanged", requestId, state: machine.state(), running });
  post({ type: "SnapshotCreated", requestId, snapshot: machine.snapshot(), automatic: false });
};

const assertReadMemory = (space: MemorySpace, address: number, length: number): void => {
  if (!["code", "iram", "sfr", "xram"].includes(space)) invalid("内存空间无效");
  const minimum = space === "sfr" ? 0x80 : 0;
  const maximum = space === "iram" ? 0x7f : space === "sfr" ? 0xff : 0xffff;
  assertInteger(address, minimum, maximum, "内存地址");
  assertInteger(length, 0, maximum - minimum + 1, "读取长度");
  if (address + length > maximum + 1) invalid("读取范围超出内存空间");
};

scope.onmessage = (message: MessageEvent<EmulatorCommand>): void => {
  const command = message.data;
  const requestId = command && Number.isSafeInteger(command.requestId) && command.requestId >= 0 ? command.requestId : 0;
  let executing = false;
  try {
    if (!command || typeof command !== "object") invalid("模拟器命令无效");
    assertInteger(command.requestId, 0, Number.MAX_SAFE_INTEGER, "请求编号");
    switch (command.type) {
      case "LoadFirmware":
      case "RestoreWorkspace": {
        if (!(command.bytes instanceof ArrayBuffer) || typeof command.name !== "string") invalid("固件命令无效");
        const loaded = new Cpu8051(new Uint8Array(command.bytes));
        if (command.type === "RestoreWorkspace") loaded.restore(command.snapshot);
        stopCurrentRun();
        debugger8051.stopped({ reason: "Paused" });
        cpu = loaded;
        post({ type: "Ready", requestId, name: command.name, state: cpu.state(), snapshot: cpu.snapshot() });
        return;
      }
      case "Reset": {
        requireCpu().reset();
        finishRun(requestId, { reason: "Paused" });
        return;
      }
      case "Step":
        assertTrace(command.trace);
        requireCpu();
        executing = true;
        stepOnce(requestId, command.trace);
        return;
      case "Run":
        startRun(requestId, command.maxSteps, command.trace);
        return;
      case "RunToAddress":
        assertDebugAddress(command.address);
        startRun(requestId, command.maxSteps, command.trace, { address: command.address, reason: "RunToAddress" });
        return;
      case "StepOver": {
        assertInteger(command.maxSteps, 0, Number.MAX_SAFE_INTEGER, "执行步数");
        assertTrace(command.trace);
        const machine = requireCpu();
        const opcode = machine.memory.readCode(machine.pc);
        if (command.maxSteps === 0) {
          finishRun(requestId, { reason: "StepLimitReached" });
        } else if (opcode === 0x12 || (opcode & 0x1f) === 0x11) {
          const address = (machine.pc + opcodeMeta(opcode).length) & 0xffff;
          startRun(requestId, command.maxSteps, command.trace, { address, reason: "StepComplete", sp: machine.state().sp }, true);
        } else {
          executing = true;
          stepOnce(requestId, command.trace);
        }
        return;
      }
      case "Pause":
        finishRun(requestId, { reason: "Paused" });
        return;
      case "SetDebugConfig": {
        const config = debugger8051.setConfig(command);
        post({ type: "DebugConfigChanged", requestId, ...config });
        return;
      }
      case "WriteMemory": {
        assertWritableAddress(command.space, command.address);
        assertInteger(command.value, 0, 0xff, "内存值");
        requireStopped().writeMemory(command.space, command.address, command.value);
        postEditedState(requestId);
        return;
      }
      case "SetRegister": {
        if (typeof command.name !== "string") invalid("寄存器名称无效");
        assertInteger(command.value, 0, 0xffff, "寄存器值");
        requireStopped().setRegister(command.name, command.value);
        postEditedState(requestId);
        return;
      }
      case "SetPortInput":
        assertInteger(command.port, 0, 3, "GPIO 端口");
        assertInteger(command.value, 0, 0xff, "GPIO 输入值");
        requireCpu().setPortInput(command.port, command.value);
        postEditedState(requestId);
        return;
      case "ReceiveSerial":
        assertInteger(command.value, 0, 0xff, "串口接收值");
        if (command.ninthBit !== undefined && typeof command.ninthBit !== "boolean") invalid("串口第九位必须是布尔值");
        requireCpu().receiveSerial(command.value, command.ninthBit);
        postEditedState(requestId);
        return;
      case "ReadMemory": {
        assertReadMemory(command.space, command.address, command.length);
        const bytes = requireCpu().readMemory(command.space, command.address, command.length);
        post({ type: "MemoryData", requestId, space: command.space, address: command.address, bytes });
        return;
      }
      case "CreateSnapshot":
        post({ type: "SnapshotCreated", requestId, snapshot: requireCpu().snapshot(), automatic: false });
        return;
      default:
        invalid("未知模拟器命令");
    }
  } catch (error) {
    if (executing) reportFault(requestId, error);
    else post({ type: "CommandRejected", requestId, error: faultData(error) });
  }
};

export {};
