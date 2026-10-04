import { SFR } from "./memory";
import { EmulatorFault, type StopReason } from "./types";

export type WritableMemorySpace = "iram" | "sfr" | "xram";

export interface MemoryWatchpoint {
  space: WritableMemorySpace;
  address: number;
}

export interface DebugConfig {
  breakpoints: number[];
  watchpoints: MemoryWatchpoint[];
}

export interface WatchpointChange extends MemoryWatchpoint {
  previous: number;
  value: number;
}

export type DebugStopReason =
  | StopReason
  | "Breakpoint"
  | "Watchpoint"
  | "StepComplete"
  | "RunToAddress"
  | "PowerDown";

export interface DebugStop {
  reason: DebugStopReason;
  address?: number;
  watchpoint?: WatchpointChange;
}

interface DebugMemory {
  iram: Uint8Array;
  sfr: Uint8Array;
  xram: Uint8Array;
}

const definedSfr = new Set<number>(Object.values(SFR));
const spaces: WritableMemorySpace[] = ["iram", "sfr", "xram"];

const invalid = (message: string): never => {
  throw new EmulatorFault({ code: "INVALID_INPUT", message });
};

export const assertDebugAddress = (address: number): void => {
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
    invalid("调试地址必须是 0 到 65535 的整数");
  }
};

export const assertWritableAddress = (
  space: WritableMemorySpace,
  address: number,
): void => {
  assertDebugAddress(address);
  if (
    !spaces.includes(space) ||
    (space === "iram" && address > 0x7f) ||
    (space === "sfr" && !definedSfr.has(address))
  ) {
    invalid("内存空间或地址不属于经典 8051 可写内存");
  }
};

/** Validate the whole replacement before changing any active debugger state. */
export const normalizeDebugConfig = (config: DebugConfig): DebugConfig => {
  if (
    !config ||
    !Array.isArray(config.breakpoints) ||
    !Array.isArray(config.watchpoints) ||
    config.breakpoints.length > 1024 ||
    config.watchpoints.length > 1024
  ) {
    invalid("断点和观察点必须是数组，每类最多 1024 个");
  }
  for (const address of config.breakpoints) assertDebugAddress(address);
  const watchpoints = new Map<string, MemoryWatchpoint>();
  for (const point of config.watchpoints) {
    if (!point || typeof point !== "object") invalid("内存观察点无效");
    assertWritableAddress(point.space, point.address);
    watchpoints.set(`${point.space}:${point.address}`, { space: point.space, address: point.address });
  }
  return {
    breakpoints: [...new Set(config.breakpoints)].sort((a, b) => a - b),
    watchpoints: [...watchpoints.values()].sort(
      (a, b) => spaces.indexOf(a.space) - spaces.indexOf(b.space) || a.address - b.address,
    ),
  };
};

/** Breakpoints run before instructions; watchpoints observe changed stored bytes. */
export class Debugger8051 {
  private config: DebugConfig = { breakpoints: [], watchpoints: [] };
  private breakpoints = new Set<number>();
  private lastBreakpoint: number | undefined;
  private skipBreakpoint: number | undefined;

  setConfig(config: DebugConfig): DebugConfig {
    const validated = normalizeDebugConfig(config);
    this.config = validated;
    this.breakpoints = new Set(validated.breakpoints);
    if (this.lastBreakpoint !== undefined && !this.breakpoints.has(this.lastBreakpoint)) {
      this.lastBreakpoint = undefined;
    }
    return this.getConfig();
  }

  getConfig(): DebugConfig {
    return {
      breakpoints: [...this.config.breakpoints],
      watchpoints: this.config.watchpoints.map((point) => ({ ...point })),
    };
  }

  beginRun(pc: number, bypassCurrent = false): void {
    this.skipBreakpoint =
      bypassCurrent || (this.lastBreakpoint === pc && this.breakpoints.has(pc))
        ? pc
        : undefined;
    this.lastBreakpoint = undefined;
  }

  beforeStep(pc: number): DebugStop | undefined {
    const skip = this.skipBreakpoint === pc;
    this.skipBreakpoint = undefined;
    return !skip && this.breakpoints.has(pc)
      ? { reason: "Breakpoint", address: pc }
      : undefined;
  }

  stopped(stop: DebugStop): void {
    this.lastBreakpoint = stop.reason === "Breakpoint" ? stop.address : undefined;
    this.skipBreakpoint = undefined;
  }

  capture(memory: DebugMemory): number[] {
    return this.config.watchpoints.map(({ space, address }) =>
      memory[space][space === "sfr" ? address - 0x80 : address] ?? 0,
    );
  }

  changed(memory: DebugMemory, previous: number[]): DebugStop | undefined {
    for (let index = 0; index < this.config.watchpoints.length; index += 1) {
      const point = this.config.watchpoints[index]!;
      const value = memory[point.space][point.space === "sfr" ? point.address - 0x80 : point.address] ?? 0;
      if (value !== previous[index]) {
        return {
          reason: "Watchpoint",
          address: point.address,
          watchpoint: { ...point, previous: previous[index]!, value },
        };
      }
    }
    return undefined;
  }
}
