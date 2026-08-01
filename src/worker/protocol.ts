import type {
  CpuSnapshot,
  CpuViewState,
  EmulatorFaultData,
  MemorySpace,
  StepResult,
  StopReason,
} from "../core/types";

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
  | PauseCommand
  | ReadMemoryCommand
  | CreateSnapshotCommand;

export type EmulatorEvent =
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
      reason: StopReason;
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
