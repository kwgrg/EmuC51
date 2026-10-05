import type {
  CpuSnapshot,
  CpuViewState,
  EmulatorFaultData,
  MemorySpace,
  StepResult,
} from "../core/types";
import type { DebugConfig, DebugStopReason, WatchpointChange, WritableMemorySpace } from "../core/debugger";

interface CommandBase {
  requestId: number;
}

export interface LoadFirmwareCommand extends CommandBase {
  type: "LoadFirmware";
  name: string;
  bytes: ArrayBuffer;
}

export interface RestoreWorkspaceCommand extends CommandBase {
  type: "RestoreWorkspace";
  name: string;
  bytes: ArrayBuffer;
  snapshot: CpuSnapshot;
}

export interface ResetCommand extends CommandBase {
  type: "Reset";
}

export interface StepCommand extends CommandBase {
  type: "Step";
  trace: boolean;
}

export interface RunCommand extends CommandBase {
  type: "Run";
  maxSteps: number;
  trace: boolean;
}

export interface RunToAddressCommand extends CommandBase {
  type: "RunToAddress";
  address: number;
  maxSteps: number;
  trace: boolean;
}

export interface StepOverCommand extends CommandBase {
  type: "StepOver";
  maxSteps: number;
  trace: boolean;
}

export interface SetDebugConfigCommand extends CommandBase, DebugConfig {
  type: "SetDebugConfig";
}

export interface WriteMemoryCommand extends CommandBase {
  type: "WriteMemory";
  space: WritableMemorySpace;
  address: number;
  value: number;
}

export interface SetRegisterCommand extends CommandBase {
  type: "SetRegister";
  name: string;
  value: number;
}

export interface SetPortInputCommand extends CommandBase {
  type: "SetPortInput";
  port: number;
  value: number;
}

export interface ReceiveSerialCommand extends CommandBase {
  type: "ReceiveSerial";
  value: number;
  ninthBit?: boolean;
}

export interface PauseCommand extends CommandBase {
  type: "Pause";
}

export interface ReadMemoryCommand extends CommandBase {
  type: "ReadMemory";
  space: MemorySpace;
  address: number;
  length: number;
}

export interface CreateSnapshotCommand extends CommandBase {
  type: "CreateSnapshot";
}

export type EmulatorCommand =
  | LoadFirmwareCommand
  | RestoreWorkspaceCommand
  | ResetCommand
  | StepCommand
  | RunCommand
  | RunToAddressCommand
  | StepOverCommand
  | SetDebugConfigCommand
  | WriteMemoryCommand
  | SetRegisterCommand
  | SetPortInputCommand
  | ReceiveSerialCommand
  | PauseCommand
  | ReadMemoryCommand
  | CreateSnapshotCommand;

export type EmulatorEvent =
  | ({ type: "DebugConfigChanged"; requestId: number } & DebugConfig)
  | { type: "SerialOutput"; requestId: number; bytes: number[] }
  | { type: "CommandRejected"; requestId: number; error: EmulatorFaultData }
  | {
      type: "Ready";
      requestId: number;
      name: string;
      state: CpuViewState;
      snapshot: CpuSnapshot;
    }
  | {
      type: "StateChanged";
      requestId: number;
      state: CpuViewState;
      step?: StepResult;
      running: boolean;
    }
  | {
      type: "TraceBatch";
      requestId: number;
      trace: StepResult[];
    }
  | {
      type: "MemoryData";
      requestId: number;
      space: MemorySpace;
      address: number;
      bytes: Uint8Array;
    }
  | {
      type: "SnapshotCreated";
      requestId: number;
      snapshot: CpuSnapshot;
      automatic: boolean;
    }
  | {
      type: "Stopped";
      requestId: number;
      reason: DebugStopReason;
      address?: number;
      watchpoint?: WatchpointChange;
      state: CpuViewState;
      snapshot: CpuSnapshot;
    }
  | {
      type: "ExecutionFault";
      requestId: number;
      error: EmulatorFaultData;
      state?: CpuViewState;
      snapshot?: CpuSnapshot;
    };
