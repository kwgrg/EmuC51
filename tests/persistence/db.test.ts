import { beforeEach, describe, expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import {
  clearWorkspace,
  loadWorkspace,
  saveWorkspace,
  type WorkspaceRecord,
} from "../../src/persistence/db";

describe("IndexedDB 工作区", () => {
  beforeEach(async () => {
    await clearWorkspace();
  });

  it("保存并恢复完整固件与 CPU 状态", async () => {
    const firmware = Uint8Array.from([0x74, 0x42, 0x00]);
    const cpu = new Cpu8051(firmware);
    cpu.step();
    cpu.memory.writeXram(0x1234, 0x88);
    const record: WorkspaceRecord = {
      schemaVersion: 1,
      coreStateVersion: 1,
      firmware: {
        name: "demo.bin",
        bytes: firmware.buffer.slice(0),
        sha256: "test",
        loadedAt: 1,
      },
      cpu: cpu.snapshot(),
      settings: {
        maxSteps: 1_000_000,
        traceEnabled: true,
        selectedMemorySpace: "xram",
      },
      updatedAt: 2,
    };
    await saveWorkspace(record);
    const restored = await loadWorkspace();
    expect(restored?.kind).toBe("complete");
    if (restored?.kind !== "complete") throw new Error("expected complete workspace");
    expect(restored.record.firmware.name).toBe("demo.bin");
    expect(restored.record.cpu.pc).toBe(2);
    expect(restored.record.cpu.xram[0x1234]).toBe(0x88);
    expect(restored.record.settings.selectedMemorySpace).toBe("xram");
  });

  it("清除 current 工作区", async () => {
    expect(await loadWorkspace()).toBeUndefined();
  });

  it("快照损坏时保留固件并要求复位恢复", async () => {
    const cpu = new Cpu8051(Uint8Array.from([0x00]));
    const invalid = {
      schemaVersion: 1,
      coreStateVersion: 1,
      firmware: {
        name: "recover.bin",
        bytes: Uint8Array.from([0]).buffer,
        sha256: "recover",
        loadedAt: 1,
      },
      cpu: { ...cpu.snapshot(), iram: new Uint8Array(2) },
      settings: {
        maxSteps: 10,
        traceEnabled: false,
        selectedMemorySpace: "code",
      },
      updatedAt: 2,
    } as unknown as WorkspaceRecord;
    await saveWorkspace(invalid);
    const restored = await loadWorkspace();
    expect(restored?.kind).toBe("firmware-only");
    if (restored?.kind !== "firmware-only") throw new Error("expected recovery record");
    expect(restored.firmware.name).toBe("recover.bin");
    expect(restored.settings?.maxSteps).toBe(10);
  });
});
