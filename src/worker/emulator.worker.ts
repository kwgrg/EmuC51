/// <reference lib="webworker" />

import { Cpu8051 } from "../core/cpu";
import { EmulatorFault } from "../core/types";
import type { EmulatorCommand, EmulatorEvent } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

let cpu: Cpu8051 | undefined;
let firmwareName = "";
let running = false;
let runToken = 0;
let activeRequestId = 0;
let remainingSteps = 0;
let traceEnabled = false;
let lastStateAt = 0;
let lastSnapshotAt = 0;

const post = (event: EmulatorEvent): void => scope.postMessage(event);

const requireCpu = (): Cpu8051 => {
  if (!cpu) {
    throw new EmulatorFault({
      code: "INVALID_SNAPSHOT",
      message: "尚未加载固件",
    });
  }
  return cpu;
};

const stopCurrentRun = (): void => {
  running = false;
  runToken += 1;
};

const reportFault = (requestId: number, error: unknown): void => {
  stopCurrentRun();
  const fault =
    error instanceof EmulatorFault
      ? error.data
      : {
          code: "INVALID_SNAPSHOT" as const,
          message: error instanceof Error ? error.message : "未知模拟器错误",
        };
  post({
    type: "ExecutionFault",
    requestId,
    error: fault,
    state: cpu?.state(),
    snapshot: cpu?.snapshot(),
  });
};

const pump = (token: number): void => {
  if (!running || token !== runToken || !cpu) return;
  try {
    const chunkLimit = Math.min(10_000, remainingSteps);
    const result = cpu.runChunk(chunkLimit, 16, traceEnabled);
    remainingSteps -= result.stepsExecuted;

    if (result.trace.length > 0) {
      post({
        type: "TraceBatch",
        requestId: activeRequestId,
        trace: result.trace,
      });
    }

    const currentTime = performance.now();
    if (currentTime - lastStateAt >= 100) {
      post({
        type: "StateChanged",
        requestId: activeRequestId,
        state: cpu.state(),
        running: true,
      });
      lastStateAt = currentTime;
    }
    if (currentTime - lastSnapshotAt >= 2000) {
      post({
        type: "SnapshotCreated",
        requestId: activeRequestId,
        snapshot: cpu.snapshot(),
        automatic: true,
      });
      lastSnapshotAt = currentTime;
    }

    if (remainingSteps <= 0) {
      running = false;
      post({
        type: "Stopped",
        requestId: activeRequestId,
        reason: "StepLimitReached",
        state: cpu.state(),
        snapshot: cpu.snapshot(),
      });
      return;
    }
    setTimeout(() => pump(token), 0);
  } catch (error) {
    reportFault(activeRequestId, error);
  }
};

scope.onmessage = (message: MessageEvent<EmulatorCommand>): void => {
  const command = message.data;
  try {
    switch (command.type) {
      case "LoadFirmware": {
        stopCurrentRun();
        firmwareName = command.name;
        cpu = new Cpu8051(new Uint8Array(command.bytes));
        post({
          type: "Ready",
          requestId: command.requestId,
          name: firmwareName,
          state: cpu.state(),
          snapshot: cpu.snapshot(),
        });
        return;
      }
      case "RestoreWorkspace": {
        stopCurrentRun();
        firmwareName = command.name;
        cpu = new Cpu8051(new Uint8Array(command.bytes));
        cpu.restore(command.snapshot);
        post({
          type: "Ready",
          requestId: command.requestId,
          name: firmwareName,
          state: cpu.state(),
          snapshot: cpu.snapshot(),
        });
        return;
      }
      case "Reset": {
        stopCurrentRun();
        const machine = requireCpu();
        machine.reset();
        post({
          type: "Stopped",
          requestId: command.requestId,
          reason: "Paused",
          state: machine.state(),
          snapshot: machine.snapshot(),
        });
        return;
      }
      case "Step": {
        stopCurrentRun();
        const machine = requireCpu();
        const step = machine.step();
        if (command.trace) {
          post({ type: "TraceBatch", requestId: command.requestId, trace: [step] });
        }
        post({
          type: "StateChanged",
          requestId: command.requestId,
          state: machine.state(),
          step,
          running: false,
        });
        post({
          type: "SnapshotCreated",
          requestId: command.requestId,
          snapshot: machine.snapshot(),
          automatic: false,
        });
        return;
      }
      case "Run": {
        stopCurrentRun();
        requireCpu();
        activeRequestId = command.requestId;
        remainingSteps = Math.max(0, Math.trunc(command.maxSteps));
        traceEnabled = command.trace;
        running = true;
        lastStateAt = performance.now();
        lastSnapshotAt = performance.now();
        const token = runToken;
        if (remainingSteps === 0) {
          running = false;
          const machine = requireCpu();
          post({
            type: "Stopped",
            requestId: command.requestId,
            reason: "StepLimitReached",
            state: machine.state(),
            snapshot: machine.snapshot(),
          });
        } else {
          setTimeout(() => pump(token), 0);
        }
        return;
      }
      case "Pause": {
        const machine = requireCpu();
        stopCurrentRun();
        post({
          type: "Stopped",
          requestId: command.requestId,
          reason: "Paused",
          state: machine.state(),
          snapshot: machine.snapshot(),
        });
        return;
      }
      case "ReadMemory": {
        const machine = requireCpu();
        post({
          type: "MemoryData",
          requestId: command.requestId,
          space: command.space,
          address: command.address,
          bytes: machine.readMemory(command.space, command.address, command.length),
        });
        return;
      }
      case "CreateSnapshot": {
        const machine = requireCpu();
        post({
          type: "SnapshotCreated",
          requestId: command.requestId,
          snapshot: machine.snapshot(),
          automatic: false,
        });
        return;
      }
    }
  } catch (error) {
    reportFault(command.requestId, error);
  }
};

export {};
