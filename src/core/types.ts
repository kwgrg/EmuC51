export type MemorySpace = "code" | "iram" | "sfr" | "xram";

export type EmulatorFaultCode =
  | "FIRMWARE_TOO_LARGE"
  | "INVALID_IRAM_ADDRESS"
  | "UNDEFINED_SFR"
  | "NON_BIT_ADDRESSABLE_SFR"
  | "INVALID_REGISTER"
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
}

export interface CpuSnapshot {
  coreStateVersion: 1;
  pc: number;
  steps: number;
  machineCycles: number;
  iram: Uint8Array;
  sfr: Uint8Array;
  xram: Uint8Array;
}

export interface StepResult {
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
