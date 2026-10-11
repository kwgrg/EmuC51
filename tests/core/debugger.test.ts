import { describe, expect, it } from "vitest";
import { Debugger8051, normalizeDebugConfig } from "../../src/core/debugger";

const memory = () => ({ iram: new Uint8Array(128), sfr: new Uint8Array(128), xram: new Uint8Array(65536) });

describe("Debugger8051", () => {
  it("validates atomically, deduplicates and sorts configuration", () => {
    const debugger8051 = new Debugger8051();
    const config = debugger8051.setConfig({
      breakpoints: [42, 0, 42],
      watchpoints: [{ space: "xram", address: 3 }, { space: "iram", address: 32 }, { space: "iram", address: 32 }],
    });
    expect(config).toEqual({ breakpoints: [0, 42], watchpoints: [{ space: "iram", address: 32 }, { space: "xram", address: 3 }] });
    expect(() => debugger8051.setConfig({ breakpoints: [NaN], watchpoints: [] })).toThrow();
    expect(debugger8051.getConfig()).toEqual(config);
    config.breakpoints.push(99);
    expect(debugger8051.getConfig().breakpoints).toEqual([0, 42]);
  });

  it.each([
    { breakpoints: [Infinity], watchpoints: [] },
    { breakpoints: [1.5], watchpoints: [] },
    { breakpoints: [-1], watchpoints: [] },
    { breakpoints: [65536], watchpoints: [] },
    { breakpoints: [], watchpoints: [{ space: "iram", address: 128 }] },
    { breakpoints: [], watchpoints: [{ space: "sfr", address: 0x84 }] },
    { breakpoints: [], watchpoints: [{ space: "code", address: 0 }] },
    { breakpoints: Array.from({ length: 1025 }, () => 0), watchpoints: [] },
  ])("rejects invalid debugger configuration %#", (config) => {
    expect(() => normalizeDebugConfig(config as Parameters<typeof normalizeDebugConfig>[0])).toThrow();
  });

  it("bypasses exactly one instruction when resuming the same breakpoint", () => {
    const debugger8051 = new Debugger8051();
    debugger8051.setConfig({ breakpoints: [0, 1], watchpoints: [] });
    debugger8051.beginRun(0);
    const stop = debugger8051.beforeStep(0)!;
    expect(stop.reason).toBe("Breakpoint");
    debugger8051.stopped(stop);
    debugger8051.beginRun(0);
    expect(debugger8051.beforeStep(0)).toBeUndefined();
    expect(debugger8051.beforeStep(0)?.reason).toBe("Breakpoint");
    debugger8051.stopped(stop);
    debugger8051.beginRun(1);
    expect(debugger8051.beforeStep(1)?.reason).toBe("Breakpoint");
  });

  it("does not bypass after pause or a configuration removal", () => {
    const debugger8051 = new Debugger8051();
    debugger8051.setConfig({ breakpoints: [0], watchpoints: [] });
    debugger8051.stopped({ reason: "Breakpoint", address: 0 });
    debugger8051.stopped({ reason: "Paused" });
    debugger8051.beginRun(0);
    expect(debugger8051.beforeStep(0)?.reason).toBe("Breakpoint");
    debugger8051.stopped({ reason: "Breakpoint", address: 0 });
    debugger8051.setConfig({ breakpoints: [], watchpoints: [] });
    debugger8051.setConfig({ breakpoints: [0], watchpoints: [] });
    debugger8051.beginRun(0);
    expect(debugger8051.beforeStep(0)?.reason).toBe("Breakpoint");
  });

  it("detects changed stored bytes in deterministic space/address order", () => {
    const debugger8051 = new Debugger8051();
    debugger8051.setConfig({ breakpoints: [], watchpoints: [
      { space: "xram", address: 1 }, { space: "sfr", address: 0xe0 },
      { space: "iram", address: 2 }, { space: "iram", address: 1 },
    ] });
    const ram = memory();
    const before = debugger8051.capture(ram);
    expect(debugger8051.changed(ram, before)).toBeUndefined();
    ram.iram[1] = 3;
    ram.iram[2] = 4;
    ram.sfr[0x60] = 5;
    ram.xram[1] = 6;
    expect(debugger8051.changed(ram, before)?.watchpoint).toEqual({ space: "iram", address: 1, previous: 0, value: 3 });
    ram.iram.fill(0);
    expect(debugger8051.changed(ram, before)?.watchpoint).toEqual({ space: "sfr", address: 0xe0, previous: 0, value: 5 });
    ram.sfr.fill(0);
    expect(debugger8051.changed(ram, before)?.watchpoint).toEqual({ space: "xram", address: 1, previous: 0, value: 6 });
  });
});

describe("breakpoint enablement and encounter counts", () => {
  const config = (hitCount = 3, enabled = true) => ({
    breakpoints: [0], watchpoints: [], breakpointOptions: [{ address: 0, enabled, hitCount }],
  });

  it("stops every N encounters and bypasses only the resumed instruction", () => {
    const debug = new Debugger8051();
    debug.setConfig(config());
    debug.beginRun(0);
    expect(debug.beforeStep(0)).toBeUndefined();
    expect(debug.beforeStep(0)).toBeUndefined();
    const stop = debug.beforeStep(0)!;
    expect(stop).toEqual({ reason: "Breakpoint", address: 0 });
    debug.stopped(stop);
    debug.beginRun(0);
    expect(debug.beforeStep(0)).toBeUndefined(); // Resume is not a new encounter.
    expect(debug.beforeStep(0)).toBeUndefined();
    expect(debug.beforeStep(0)).toBeUndefined();
    expect(debug.beforeStep(0)?.reason).toBe("Breakpoint");
  });

  it("preserves progress across pauses and unchanged or unrelated config", () => {
    const debug = new Debugger8051();
    debug.setConfig(config());
    debug.beginRun(0);
    expect(debug.beforeStep(0)).toBeUndefined();
    debug.stopped({ reason: "Paused" });
    debug.setConfig({ ...config(), watchpoints: [{ space: "iram", address: 0 }] });
    debug.beginRun(0);
    expect(debug.beforeStep(0)).toBeUndefined();
    expect(debug.beforeStep(0)?.reason).toBe("Breakpoint");
  });

  it("disabled breakpoints never count, and enablement/count edits reset that address", () => {
    const debug = new Debugger8051();
    debug.setConfig(config(2));
    expect(debug.beforeStep(0)).toBeUndefined();
    debug.setConfig(config(2, false));
    for (let i = 0; i < 10; i += 1) expect(debug.beforeStep(0)).toBeUndefined();
    debug.setConfig(config(2));
    expect(debug.beforeStep(0)).toBeUndefined();
    debug.setConfig(config(3));
    expect(debug.beforeStep(0)).toBeUndefined();
    expect(debug.beforeStep(0)).toBeUndefined();
    expect(debug.beforeStep(0)?.reason).toBe("Breakpoint");
  });

  it("resetting clears partial counts and resume bypass state", () => {
    const debug = new Debugger8051();
    debug.setConfig(config(2));
    debug.beforeStep(0);
    debug.resetHits();
    expect(debug.beforeStep(0)).toBeUndefined();
    const stop = debug.beforeStep(0)!;
    debug.stopped(stop);
    debug.resetHits();
    debug.beginRun(0);
    expect(debug.beforeStep(0)).toBeUndefined();
    expect(debug.beforeStep(0)?.reason).toBe("Breakpoint");
  });

  it.each([0, -1, 1.5, NaN, Infinity, 100_000_001])("rejects invalid count %s without changing progress", (count) => {
    const debug = new Debugger8051();
    debug.setConfig(config(2));
    debug.beforeStep(0);
    expect(() => debug.setConfig(config(count))).toThrow();
    expect(debug.beforeStep(0)?.reason).toBe("Breakpoint");
  });

  it("rejects orphan, duplicate and malformed options and returns defensive copies", () => {
    const debug = new Debugger8051();
    expect(() => debug.setConfig({ ...config(), breakpoints: [] })).toThrow();
    expect(() => debug.setConfig({ ...config(), breakpointOptions: [...config().breakpointOptions, ...config().breakpointOptions] })).toThrow();
    expect(() => debug.setConfig({ ...config(), breakpointOptions: null } as unknown as Parameters<typeof debug.setConfig>[0])).toThrow();
    expect(() => debug.setConfig(config(2, "false" as unknown as boolean))).toThrow();
    const result = debug.setConfig(config(2));
    result.breakpointOptions![0]!.enabled = false;
    expect(debug.getConfig().breakpointOptions![0]!.enabled).toBe(true);
  });
});
