export type MemorySpace = "code" | "iram" | "sfr" | "xram";

export type EmulatorFaultCode =
  | "FIRMWARE_TOO_LARGE"
  | "INVALID_IRAM_ADDRESS"
  | "UNDEFINED_SFR"
  | "NON_BIT_ADDRESSABLE_SFR"
  | "INVALID_REGISTER"
  | "INVALID_INPUT"
  | "ILLEGAL_OPCODE"
  | "UNSUPPORTED_OPCODE"
  | "INVALID_SNAPSHOT";

export interface EmulatorFaultData {
  code: EmulatorFaultCode;
  message: string;
  pc?: number;
  opcode?: number;
  address?: number;
}

export class EmulatorFault extends Error {
  readonly data: EmulatorFaultData;

  constructor(data: EmulatorFaultData) {
    super(data.message);
    this.name = "EmulatorFault";
    this.data = data;
  }
}

export interface CpuViewState {
  pc: number;
  acc: number;
  b: number;
  psw: number;
  sp: number;
  dptr: number;
  registers: number[];
  steps: number;
  machineCycles: number;
  peripherals: PeripheralViewState;
}

export type InterruptSource = "external0" | "timer0" | "external1" | "timer1" | "serial";

export interface SerialFrame {
  value: number;
  mode: 0 | 1 | 2 | 3;
  progress: number;
  ninthBit?: boolean;
}

export interface PeripheralSnapshot {
  portInputs: [number, number, number, number];
  lastPins: [number, number, number, number];
  counterEdges: [number, number];
  interruptStack: { source: InterruptSource; priority: 0 | 1 }[];
  interruptDelay: number;
  serial: {
    rxBuffer: number;
    rxQueue: number[];
    txQueue: number[];
    txOutput: number[];
    txFrame: SerialFrame | null;
    rxFrame: SerialFrame | null;
  };
}

export interface PeripheralViewState {
  ports: { latch: number; input: number; pins: number }[];
  timers: { mode: number; value: number; running: boolean; counter: boolean; gate: boolean; overflow: boolean }[];
  serial: { mode: number; receiving: boolean; txBusy: boolean; rxQueued: number; rxBuffer: number; txOutput: number[] };
  interrupt: { activePriorities: number[]; pending: InterruptSource[] };
  powerMode: "running" | "idle" | "power-down";
}

export interface LegacyCpuSnapshot {
  coreStateVersion: 1;
  pc: number;
  steps: number;
  machineCycles: number;
  iram: Uint8Array;
  sfr: Uint8Array;
  xram: Uint8Array;
}

export interface CpuSnapshotV2 extends Omit<LegacyCpuSnapshot, "coreStateVersion"> {
  coreStateVersion: 2;
  peripherals: PeripheralSnapshot;
}

export type CpuSnapshot = LegacyCpuSnapshot | CpuSnapshotV2;

export interface StepResult {
  kind?: "instruction" | "interrupt" | "idle" | "power-down";
  pcBefore: number;
  pcAfter: number;
  bytes: [number, number, number];
  length: 1 | 2 | 3;
  mnemonic: string;
  machineCycles: number;
  state: CpuViewState;
}

export interface RunChunkResult {
  stepsExecuted: number;
  timeBudgetReached: boolean;
  trace: StepResult[];
}

export type StopReason = "StepLimitReached" | "Paused";
