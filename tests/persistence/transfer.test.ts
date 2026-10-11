import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearWorkspace, loadWorkspace, saveWorkspace } from "../../src/persistence/db";
import { exportWorkspace, importWorkspace, MAX_WORKSPACE_IMPORT_BYTES } from "../../src/persistence/transfer";
import { legacyWorkspaceFixture, workspaceFixture } from "./fixtures";

describe("工作区 JSON 导入导出", () => {
  beforeAll(() => { vi.stubGlobal("crypto", webcrypto); });
  afterAll(() => { vi.unstubAllGlobals(); });
  beforeEach(async () => { await clearWorkspace(); });

  it("完整往返固件、各类内存、GPIO、串口帧、中断栈和调试设置", async () => {
    const record = workspaceFixture();
    if (record.cpu.coreStateVersion !== 2) throw new Error("expected v2 snapshot");
    record.cpu.peripherals = {
      portInputs: [255, 127, 63, 31],
      lastPins: [255, 127, 63, 31],
      counterEdges: [2, 4],
      interruptStack: [{ source: "timer0", priority: 0 }, { source: "serial", priority: 1 }],
      interruptDelay: 1,
      serial: {
        rxBuffer: 0x50, rxQueue: [0x41, 0x1ff], txQueue: [0x43], txOutput: [0x44],
        txFrame: { value: 0x50, mode: 1, progress: 12, ninthBit: true },
        rxFrame: { value: 0x5a, mode: 1, progress: 20, ninthBit: false },
      },
    };
    record.settings.debugger!.breakpointOptions = [{ address: 2, enabled: false, hitCount: 5, condition: "ACC == 0x42" }];
    record.cpu.iram[0x20] = 0x77;
    record.settings.watchExpressions = ["ACC", "XRAM[0x1234]", "1/0"];
    record.settings.memoryAddress = 0x1234;
    const text = exportWorkspace(record);
    const encoded = JSON.parse(text);
    expect(Array.isArray(encoded.firmware.bytes)).toBe(true);
    expect(Array.isArray(encoded.cpu.iram)).toBe(true);
    const restored = await importWorkspace(text);
    expect(restored).toEqual(record);
    expect(restored.cpu.xram).toBeInstanceOf(Uint8Array);
    expect(restored.firmware.bytes).toBeInstanceOf(ArrayBuffer);
    expect(exportWorkspace(restored)).toBe(text);
    expect(await loadWorkspace()).toBeUndefined();
  });

  it("最大尺寸固件、XRAM、队列及调试设置的导出仍可重新导入", async () => {
    const record = workspaceFixture();
    const firmware = new Uint8Array(0x10000).fill(255);
    record.firmware.bytes = firmware.buffer;
    const { sha256Hex } = await import("../../src/persistence/db");
    record.firmware.sha256 = await sha256Hex(firmware.buffer);
    record.cpu.xram.fill(255);
    if (record.cpu.coreStateVersion !== 2) throw new Error("expected v2 snapshot");
    record.cpu.peripherals.serial.rxQueue = Array(4096).fill(255);
    record.cpu.peripherals.serial.txQueue = Array(4096).fill(255);
    record.cpu.peripherals.serial.txOutput = Array(4096).fill(255);
    record.settings.debugger = {
      breakpoints: Array.from({ length: 1024 }, (_, index) => 0xffff - index),
      breakpointOptions: Array.from({ length: 1024 }, (_, index) => ({ address: 0xffff - index, enabled: false, hitCount: 100_000_000, condition: "\u0001".repeat(256) })),
      watchpoints: Array.from({ length: 1024 }, (_, index) => ({ space: "xram", address: 0xffff - index })),
    };
    record.settings.watchExpressions = Array.from({ length: 32 }, (_, i) => String(i).padEnd(256, "\u0001"));
    record.settings.memoryAddress = 65535;
    const text = exportWorkspace(record);
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(1024 * 1024);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(MAX_WORKSPACE_IMPORT_BYTES);
    expect((await importWorkspace(text)).cpu.xram[65535]).toBe(255);
  });

  it("可导入旧版数组编码并升级 CPU 快照", async () => {
    const legacy = legacyWorkspaceFixture();
    const text = JSON.stringify({
      ...legacy,
      firmware: { ...legacy.firmware, bytes: Array.from(new Uint8Array(legacy.firmware.bytes)) },
      cpu: { ...legacy.cpu, iram: Array.from(legacy.cpu.iram), sfr: Array.from(legacy.cpu.sfr), xram: Array.from(legacy.cpu.xram) },
    });
    const restored = await importWorkspace(text);
    expect(restored.schemaVersion).toBe(4);
    expect(restored.cpu.coreStateVersion).toBe(2);
    expect(restored.cpu.pc).toBe(legacy.cpu.pc);
  });

  it("imports v2 records with default breakpoint behavior and rejects v3 fields under v2", async () => {
    const legacy = JSON.parse(exportWorkspace(workspaceFixture()));
    legacy.schemaVersion = 2;
    const restored = await importWorkspace(JSON.stringify(legacy));
    expect(restored.schemaVersion).toBe(4);
    expect(restored.settings.debugger?.breakpointOptions).toBeUndefined();
    legacy.settings.debugger.breakpointOptions = [{ address: 2, enabled: false, hitCount: 5 }];
    await expect(importWorkspace(JSON.stringify(legacy))).rejects.toThrow();
  });

  it("migrates v3 watches/counts and rejects conditions mislabeled as v3", async () => {
    const legacy = JSON.parse(exportWorkspace(workspaceFixture()));
    legacy.schemaVersion = 3;
    legacy.settings.watchExpressions = ["ACC"];
    legacy.settings.debugger.breakpointOptions = [{ address: 2, enabled: false, hitCount: 7 }];
    const restored = await importWorkspace(JSON.stringify(legacy));
    expect(restored.schemaVersion).toBe(4);
    expect(restored.settings.watchExpressions).toEqual(["ACC"]);
    expect(restored.settings.debugger?.breakpointOptions?.[0]).toEqual({ address: 2, enabled: false, hitCount: 7 });
    legacy.settings.debugger.breakpointOptions[0].condition = "ACC >= 3";
    await expect(importWorkspace(JSON.stringify(legacy))).rejects.toThrow();
    legacy.schemaVersion = 4;
    expect((await importWorkspace(JSON.stringify(legacy))).settings.debugger?.breakpointOptions?.[0]?.condition).toBe("ACC >= 3");
    for (const condition of [null, 42, "x".repeat(257)]) {
      legacy.settings.debugger.breakpointOptions[0].condition = condition;
      await expect(importWorkspace(JSON.stringify(legacy))).rejects.toThrow();
    }
  });

  it("校验和失败时不替换已有工作区", async () => {
    const existing = workspaceFixture();
    await saveWorkspace(existing);
    const changed = JSON.parse(exportWorkspace(existing));
    changed.firmware.bytes[0] ^= 1;
    await expect(importWorkspace(JSON.stringify(changed))).rejects.toThrow("SHA-256");
    const loaded = await loadWorkspace();
    expect(loaded?.kind).toBe("complete");
    if (loaded?.kind !== "complete") throw new Error("expected existing workspace");
    expect(loaded.record).toEqual(existing);
  });

  const invalidMutations: [string, string, unknown][] = [
    ["观察列表溢出", "settings.watchExpressions", Array(33).fill("PC")],
    ["观察列表类型", "settings.watchExpressions", [42]],
    ["浏览地址越界", "settings.memoryAddress", 65536],
    ["未知版本", "schemaVersion", 99],
    ["外层核心版本不一致", "coreStateVersion", 1],
    ["PC 越界", "cpu.pc", 65536],
    ["步数负值", "cpu.steps", -1],
    ["周期非整数", "cpu.machineCycles", 1.5],
    ["超安全整数", "cpu.steps", Number.MAX_SAFE_INTEGER + 1],
    ["IRAM 尺寸错误", "cpu.iram", Array(127).fill(0)],
    ["XRAM 字节越界", "cpu.xram.0", 256],
    ["SFR 字节小数", "cpu.sfr.0", 0.5],
    ["假内存对象", "cpu.iram", { byteLength: 128 }],
    ["固件过大", "firmware.bytes", Array(65537).fill(0)],
    ["空固件名称", "firmware.name", ""],
    ["错误摘要格式", "firmware.sha256", "hash"],
    ["无效时间戳", "updatedAt", -1],
    ["最大步数越界", "settings.maxSteps", 100_000_001],
    ["trace 不是布尔值", "settings.traceEnabled", "true"],
    ["未知内存空间", "settings.selectedMemorySpace", "other"],
    ["断点选项非数组", "settings.debugger.breakpointOptions", null],
    ["断点启停非布尔值", "settings.debugger.breakpointOptions", [{ address: 2, enabled: 1, hitCount: 1 }]],
    ["断点计数零", "settings.debugger.breakpointOptions", [{ address: 2, enabled: true, hitCount: 0 }]],
    ["断点计数小数", "settings.debugger.breakpointOptions", [{ address: 2, enabled: true, hitCount: 1.5 }]],
    ["断点计数超限", "settings.debugger.breakpointOptions", [{ address: 2, enabled: true, hitCount: 100_000_001 }]],
    ["孤立断点选项", "settings.debugger.breakpointOptions", [{ address: 3, enabled: true, hitCount: 1 }]],
    ["重复断点选项", "settings.debugger.breakpointOptions", [{ address: 2, enabled: true, hitCount: 1 }, { address: 2, enabled: false, hitCount: 2 }]],
    ["断点越界", "settings.debugger.breakpoints", [65536]],
    ["断点数量超限", "settings.debugger.breakpoints", Array(1025).fill(0)],
    ["IRAM 观察点越界", "settings.debugger.watchpoints", [{ space: "iram", address: 128 }]],
    ["未定义 SFR 观察点", "settings.debugger.watchpoints", [{ space: "sfr", address: 0x84 }]],
    ["只读 CODE 观察点", "settings.debugger.watchpoints", [{ space: "code", address: 0 }]],
    ["GPIO 输入越界", "cpu.peripherals.portInputs.0", 256],
    ["串口队列超限", "cpu.peripherals.serial.rxQueue", Array(4097).fill(0)],
    ["串口九位数据越界", "cpu.peripherals.serial.rxQueue", [512]],
    ["串口帧进度越界", "cpu.peripherals.serial.txFrame", { value: 0, mode: 1, progress: 704 }],
    ["模式零帧进度越界", "cpu.peripherals.serial.txFrame", { value: 0, mode: 0, progress: 8 }],
    ["串口第九位类型错误", "cpu.peripherals.serial.rxFrame", { value: 0, mode: 2, progress: 0, ninthBit: 1 }],
    ["无效中断优先级栈", "cpu.peripherals.interruptStack", [{ source: "timer0", priority: 1 }, { source: "timer1", priority: 0 }]],
  ];

  it.each(invalidMutations)("拒绝%s且不写入数据库", async (_name, path, replacement) => {
    const value: unknown = JSON.parse(exportWorkspace(workspaceFixture()));
    const keys = path.split(".");
    let target = value as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys[keys.length - 1]!] = replacement;
    await expect(importWorkspace(JSON.stringify(value))).rejects.toThrow();
    expect(await loadWorkspace()).toBeUndefined();
  });

  it.each(["{", "null", "[]", "true", "{}"])("拒绝无效 JSON 工作区 %s", async (text) => {
    await expect(importWorkspace(text)).rejects.toThrow();
  });

  it("读取前拒绝超限文件并按 UTF-8 字节计算限额", async () => {
    await expect(importWorkspace(" ".repeat(MAX_WORKSPACE_IMPORT_BYTES + 1))).rejects.toThrow("4 MiB");
    await expect(importWorkspace("中".repeat(Math.ceil(MAX_WORKSPACE_IMPORT_BYTES / 2)))).rejects.toThrow("4 MiB");
  });
});
