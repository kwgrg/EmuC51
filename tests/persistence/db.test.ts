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
    expect(restored.record.schemaVersion).toBe(2);
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
