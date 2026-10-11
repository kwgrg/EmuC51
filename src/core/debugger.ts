import { MAX_EXPRESSION_LENGTH } from "./expressions";
import { SFR } from "./memory";
import { EmulatorFault, type StopReason } from "./types";

export type WritableMemorySpace = "iram" | "sfr" | "xram";

export interface MemoryWatchpoint {
  space: WritableMemorySpace;
  address: number;
}

export interface BreakpointOptions {
  address: number;
  enabled: boolean;
  hitCount: number;
  condition?: string;
}

export const MAX_BREAKPOINT_HIT_COUNT = 100_000_000;

export interface DebugConfig {
  breakpoints: number[];
  breakpointOptions?: BreakpointOptions[];
  watchpoints: MemoryWatchpoint[];
}

export interface WatchpointChange extends MemoryWatchpoint {
  previous: number;
  value: number;
}

export type DebugStopReason =
  | StopReason
  | "Breakpoint"
  | "BreakpointConditionError"
  | "Watchpoint"
  | "StepComplete"
  | "RunToAddress"
  | "PowerDown"
  | "CallStackInvalidated";

export interface DebugStop {
  reason: DebugStopReason;
  address?: number;
  watchpoint?: WatchpointChange;
  conditionError?: { expression: string; message: string };
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

/** Missing options preserve legacy always-enabled, every-visit breakpoints. */
export const breakpointOptions = (config: DebugConfig, address: number): BreakpointOptions =>
  config.breakpointOptions?.find((item) => item.address === address) ?? { address, enabled: true, hitCount: 1 };

export const removeBreakpoint = (config: DebugConfig, address: number): DebugConfig => ({
  ...config,
  breakpoints: config.breakpoints.filter((value) => value !== address),
  ...(config.breakpointOptions ? { breakpointOptions: config.breakpointOptions.filter((item) => item.address !== address) } : {}),
});

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
  const options = new Map<number, BreakpointOptions>();
  if (config.breakpointOptions !== undefined) {
    if (!Array.isArray(config.breakpointOptions) || config.breakpointOptions.length > 1024) invalid("断点选项必须是最多 1024 项的数组");
    for (const item of config.breakpointOptions) {
      if (!item || typeof item !== "object") invalid("断点选项无效");
      assertDebugAddress(item.address);
      if (!config.breakpoints.includes(item.address) || options.has(item.address) ||
          typeof item.enabled !== "boolean" || !Number.isSafeInteger(item.hitCount) ||
          item.hitCount < 1 || item.hitCount > MAX_BREAKPOINT_HIT_COUNT) invalid("断点选项需对应唯一地址，命中次数须为 1 到 100000000 的整数");
      if (item.condition !== undefined && (typeof item.condition !== "string" || item.condition.length > MAX_EXPRESSION_LENGTH)) invalid("断点条件须为最多 256 字符的字符串");
      const condition = item.condition?.trim();
      options.set(item.address, { address: item.address, enabled: item.enabled, hitCount: item.hitCount, ...(condition ? { condition } : {}) });
    }
  }
  const watchpoints = new Map<string, MemoryWatchpoint>();
  for (const point of config.watchpoints) {
    if (!point || typeof point !== "object") invalid("内存观察点无效");
    assertWritableAddress(point.space, point.address);
    watchpoints.set(`${point.space}:${point.address}`, { space: point.space, address: point.address });
  }
  return {
    breakpoints: [...new Set(config.breakpoints)].sort((a, b) => a - b),
    ...(config.breakpointOptions !== undefined ? { breakpointOptions: [...options.values()].sort((a, b) => a.address - b.address) } : {}),
    watchpoints: [...watchpoints.values()].sort(
      (a, b) => spaces.indexOf(a.space) - spaces.indexOf(b.space) || a.address - b.address,
    ),
  };
};

/** Breakpoints run before instructions; watchpoints observe changed stored bytes. */
export class Debugger8051 {
  private config: DebugConfig = { breakpoints: [], watchpoints: [] };
  private breakpoints = new Map<number, BreakpointOptions>();
  private hits = new Map<number, number>();
  private lastBreakpoint: number | undefined;
  private skipBreakpoint: number | undefined;

  setConfig(config: DebugConfig): DebugConfig {
    const validated = normalizeDebugConfig(config);
    const next = new Map(validated.breakpoints.map((address) => [address, breakpointOptions(validated, address)]));
    for (const [address, old] of this.breakpoints) {
      const option = next.get(address);
      if (!option || option.enabled !== old.enabled || option.hitCount !== old.hitCount || option.condition !== old.condition) {
        this.hits.delete(address);
        if (this.lastBreakpoint === address) this.lastBreakpoint = undefined;
        if (this.skipBreakpoint === address) this.skipBreakpoint = undefined;
      }
    }
    this.config = validated;
    this.breakpoints = next;
    return this.getConfig();
  }

  getConfig(): DebugConfig {
    return {
      breakpoints: [...this.config.breakpoints],
      ...(this.config.breakpointOptions ? { breakpointOptions: this.config.breakpointOptions.map((item) => ({ ...item })) } : {}),
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

  beforeStep(pc: number, evaluate?: (expression: string) => number): DebugStop | undefined {
    if (this.skipBreakpoint === pc) {
      this.skipBreakpoint = undefined;
      return undefined;
    }
    const option = this.breakpoints.get(pc);
    if (!option?.enabled) return undefined;
    if (option.condition) {
      try {
        if (!evaluate) throw new Error("条件求值器不可用");
        const value = evaluate(option.condition);
        if (!Number.isSafeInteger(value)) throw new Error("条件结果不是安全整数");
        if (value === 0) return undefined;
      } catch (error) {
        return { reason: "BreakpointConditionError", address: pc, conditionError: {
          expression: option.condition, message: error instanceof Error ? error.message : "条件求值失败",
        } };
      }
    }
    const hits = (this.hits.get(pc) ?? 0) + 1;
    this.hits.set(pc, hits === option.hitCount ? 0 : hits);
    return hits === option.hitCount ? { reason: "Breakpoint", address: pc } : undefined;
  }

  resetHits(): void {
    this.hits.clear();
    this.lastBreakpoint = undefined;
    this.skipBreakpoint = undefined;
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
