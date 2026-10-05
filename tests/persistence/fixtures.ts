import { createHash } from "node:crypto";
import { Cpu8051 } from "../../src/core/cpu";
import type { LegacyCpuSnapshot } from "../../src/core/types";
import type { WorkspaceRecord } from "../../src/persistence/db";

export const workspaceFixture = (): WorkspaceRecord => {
  const firmware = Uint8Array.from([0x74, 0x42, 0x00]);
  const cpu = new Cpu8051(firmware);
  cpu.step();
  cpu.memory.writeXram(0x1234, 0x88);
  return {
    schemaVersion: 2,
    coreStateVersion: 2,
    firmware: {
      name: "demo.bin",
      bytes: firmware.buffer.slice(0),
      sha256: createHash("sha256").update(firmware).digest("hex"),
      loadedAt: 1,
    },
    cpu: cpu.snapshot(),
    settings: {
      maxSteps: 1_000_000,
      traceEnabled: true,
      selectedMemorySpace: "xram",
      debugger: {
        breakpoints: [2, 0x1234],
        watchpoints: [{ space: "iram", address: 0x20 }, { space: "sfr", address: 0xe0 }, { space: "xram", address: 0x1234 }],
      },
    },
    updatedAt: 2,
  };
};

export const legacyWorkspaceFixture = (): WorkspaceRecord => {
  const current = workspaceFixture();
  const snapshot: LegacyCpuSnapshot = {
    coreStateVersion: 1,
    pc: current.cpu.pc,
    steps: current.cpu.steps,
    machineCycles: current.cpu.machineCycles,
    iram: current.cpu.iram,
    sfr: current.cpu.sfr,
    xram: current.cpu.xram,
  };
  return { ...current, schemaVersion: 1, coreStateVersion: 1, cpu: snapshot };
};
