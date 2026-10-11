import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWorkspace,
  loadWorkspace,
  saveWorkspace,
  type WorkspaceRecord,
} from "../../src/persistence/db";
import { legacyWorkspaceFixture, workspaceFixture } from "./fixtures";

describe("IndexedDB 工作区", () => {
  beforeEach(async () => {
    await clearWorkspace();
  });

  it("保存并恢复完整固件、调试配置与 CPU 状态", async () => {
    await saveWorkspace(workspaceFixture());
    const restored = await loadWorkspace();
    expect(restored?.kind).toBe("complete");
    if (restored?.kind !== "complete") throw new Error("expected complete workspace");
    expect(restored.record.schemaVersion).toBe(3);
    expect(restored.record.coreStateVersion).toBe(2);
    expect(restored.record.firmware.name).toBe("demo.bin");
    expect(restored.record.cpu.pc).toBe(2);
    expect(restored.record.cpu.xram[0x1234]).toBe(0x88);
    expect(restored.record.settings.selectedMemorySpace).toBe("xram");
    expect(restored.record.settings.debugger?.breakpoints).toEqual([2, 0x1234]);
  });

  it("清除 current 工作区", async () => {
    await saveWorkspace(workspaceFixture());
    await clearWorkspace();
    expect(await loadWorkspace()).toBeUndefined();
  });

  it("迁移旧版快照并保留 CPU、固件与可选设置", async () => {
    const legacy = legacyWorkspaceFixture();
    delete legacy.settings.debugger;
    await saveWorkspace(legacy);
    const restored = await loadWorkspace();
    expect(restored?.kind).toBe("complete");
    if (restored?.kind !== "complete") throw new Error("expected complete workspace");
    expect(restored.record.cpu.pc).toBe(legacy.cpu.pc);
    expect(restored.record.cpu.steps).toBe(legacy.cpu.steps);
    expect(restored.record.cpu.xram).toEqual(legacy.cpu.xram);
    expect(restored.record.cpu.coreStateVersion).toBe(2);
    if (restored.record.cpu.coreStateVersion !== 2) throw new Error("expected migrated snapshot");
    expect(restored.record.cpu.peripherals.portInputs).toEqual([255, 255, 255, 255]);
    expect(restored.record.cpu.peripherals.interruptStack).toEqual([]);
    expect(restored.record.cpu.peripherals.serial.rxQueue).toEqual([]);
    expect(restored.record.settings.debugger).toBeUndefined();
  });

  it("快照损坏时保留固件并要求复位恢复", async () => {
    const invalid = workspaceFixture();
    invalid.cpu.iram = new Uint8Array(2);
    await saveWorkspace(invalid);
    const restored = await loadWorkspace();
    expect(restored?.kind).toBe("firmware-only");
    if (restored?.kind !== "firmware-only") throw new Error("expected recovery record");
    expect(restored.firmware.name).toBe("demo.bin");
    expect(restored.settings?.maxSteps).toBe(1_000_000);
  });

  it.each([
    ["pc", -1], ["pc", 65536], ["pc", 0.5],
    ["steps", NaN], ["steps", Number.MAX_SAFE_INTEGER + 1],
    ["machineCycles", -1], ["machineCycles", 1.5],
  ])("拒绝损坏计数器 %s=%s 并保留固件", async (field, value) => {
    const invalid = workspaceFixture();
    Object.assign(invalid.cpu, { [field]: value });
    await saveWorkspace(invalid);
    expect((await loadWorkspace())?.kind).toBe("firmware-only");
  });

  it("拒绝伪造 byteLength 对象而不会当作内存", async () => {
    const invalid = workspaceFixture();
    invalid.cpu.iram = { byteLength: 0x80 } as Uint8Array;
    await saveWorkspace(invalid);
    expect((await loadWorkspace())?.kind).toBe("firmware-only");
    invalid.firmware.bytes = { byteLength: 1 } as ArrayBuffer;
    await saveWorkspace(invalid);
    expect(await loadWorkspace()).toBeUndefined();
  });

  it("拒绝损坏的稀疏外设队列并保留固件", async () => {
    const invalid = workspaceFixture();
    if (invalid.cpu.coreStateVersion !== 2) throw new Error("expected v2 snapshot");
    invalid.cpu.peripherals.serial.rxQueue = Array<number>(4);
    await saveWorkspace(invalid);
    expect((await loadWorkspace())?.kind).toBe("firmware-only");
  });

  it("无效设置不会在固件恢复中继续使用", async () => {
    const invalid = workspaceFixture();
    invalid.settings.maxSteps = Infinity;
    await saveWorkspace(invalid);
    const restored = await loadWorkspace();
    expect(restored?.kind).toBe("firmware-only");
    if (restored?.kind !== "firmware-only") throw new Error("expected recovery record");
    expect(restored.settings).toBeUndefined();
  });

  it("未知版本只能恢复已验证结构的固件", async () => {
    const invalid = { ...workspaceFixture(), schemaVersion: 99 } as unknown as WorkspaceRecord;
    await saveWorkspace(invalid);
    expect((await loadWorkspace())?.kind).toBe("firmware-only");
  });
});

describe("v3 breakpoint settings", () => {
  it("migrates v2 records without changing the CPU snapshot", async () => {
    const legacy = { ...workspaceFixture(), schemaVersion: 2 as const };
    await saveWorkspace(legacy);
    const loaded = await loadWorkspace();
    if (loaded?.kind !== "complete") throw new Error("expected complete workspace");
    expect(loaded.record.schemaVersion).toBe(3);
    expect(loaded.record.coreStateVersion).toBe(2);
    expect(loaded.record.cpu).toEqual(legacy.cpu);
    expect(loaded.record.settings.debugger).toEqual(legacy.settings.debugger);
  });

  it("persists disabled and counted breakpoints and discards malformed settings on recovery", async () => {
    const record = workspaceFixture();
    record.settings.debugger!.breakpointOptions = [{ address: 2, enabled: false, hitCount: 3 }];
    await saveWorkspace(record);
    const loaded = await loadWorkspace();
    if (loaded?.kind !== "complete") throw new Error("expected complete workspace");
    expect(loaded.record).toEqual(record);
    record.settings.debugger!.breakpointOptions[0]!.hitCount = 0;
    await saveWorkspace(record);
    const recovery = await loadWorkspace();
    expect(recovery?.kind).toBe("firmware-only");
    if (recovery?.kind !== "firmware-only") throw new Error("expected firmware recovery");
    expect(recovery.settings).toBeUndefined();
  });
});

describe("optional debug session settings", () => {
  it("restores watches and a confirmed memory address, without persisting runtime history", async () => {
    const record = workspaceFixture();
    record.settings.watchExpressions = ["ACC", "XRAM[DPTR]", "1/0"];
    record.settings.memoryAddress = 0x1234;
    Object.assign(record.cpu, { callStack: { frames: [{ returnPc: 123 }] } });
    Object.assign(record.settings.debugger!, { encounterCounts: { 2: 99 } });
    await saveWorkspace(record);
    const loaded = await loadWorkspace();
    if (loaded?.kind !== "complete") throw new Error("expected complete record");
    expect(loaded.record.settings.watchExpressions).toEqual(["ACC", "XRAM[DPTR]", "1/0"]);
    expect(loaded.record.settings.memoryAddress).toBe(0x1234);
    expect(loaded.record.cpu).not.toHaveProperty("callStack");
    expect(loaded.record.settings.debugger).not.toHaveProperty("encounterCounts");
  });

  it.each([1, 2, 3] as const)("reads older v%s settings without inventing watches or a browse position", async version => {
    const record = version === 1 ? legacyWorkspaceFixture() : { ...workspaceFixture(), schemaVersion: version };
    await saveWorkspace(record);
    const loaded = await loadWorkspace();
    if (loaded?.kind !== "complete") throw new Error("expected complete record");
    expect(loaded.record.settings.watchExpressions).toBeUndefined();
    expect(loaded.record.settings.memoryAddress).toBeUndefined();
    expect(loaded.record.cpu.pc).toBe(record.cpu.pc);
    expect(loaded.record.settings.debugger).toEqual(record.settings.debugger);
  });

  it.each([null, {}, [1], [""], ["  "], ["PC", " PC "], Array(2), Array(33).fill("PC"), ["A".repeat(257)]])("rejects malformed watch lists %#", async watchExpressions => {
    const record = workspaceFixture();
    Object.assign(record.settings, { watchExpressions });
    await saveWorkspace(record);
    const loaded = await loadWorkspace();
    expect(loaded?.kind).toBe("firmware-only");
    if (loaded?.kind !== "firmware-only") throw new Error("expected safe fallback");
    expect(loaded.settings).toBeUndefined();
  });

  it.each([
    ["iram", 128], ["iram", -1], ["sfr", 127], ["sfr", 256], ["xram", 65536], ["code", 1.5], ["code", NaN],
  ])("rejects invalid browse address in %s: %s", async (space, address) => {
    const record = workspaceFixture();
    Object.assign(record.settings, { selectedMemorySpace: space, memoryAddress: address });
    await saveWorkspace(record);
    expect((await loadWorkspace())?.kind).toBe("firmware-only");
  });
});
