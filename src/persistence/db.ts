import { openDB, type DBSchema } from "idb";
import { Cpu8051 } from "../core/cpu";
import { SFR } from "../core/memory";
import { validatePeripheralSnapshot } from "../core/peripherals";
import type { CpuSnapshot, MemorySpace } from "../core/types";

export interface WorkspaceDebugConfig {
  breakpoints: number[];
  watchpoints: { space: Exclude<MemorySpace, "code">; address: number }[];
}

export interface WorkspaceSettings {
  maxSteps: number;
  traceEnabled: boolean;
  selectedMemorySpace: MemorySpace;
  debugger?: WorkspaceDebugConfig;
}

export interface WorkspaceRecord {
  // Version 1 remains readable; new records and exports use version 2.
  schemaVersion: 1 | 2;
  coreStateVersion: 1 | 2;
  firmware: {
    name: string;
    bytes: ArrayBuffer;
    sha256: string;
    loadedAt: number;
  };
  cpu: CpuSnapshot;
  settings: WorkspaceSettings;
  updatedAt: number;
}

interface EmuC51Database extends DBSchema {
  workspace: {
    key: "current";
    value: WorkspaceRecord;
  };
}

export type LoadedWorkspace =
  | { kind: "complete"; record: WorkspaceRecord }
  | {
      kind: "firmware-only";
      firmware: WorkspaceRecord["firmware"];
      settings?: WorkspaceSettings;
    };

const database = () =>
  openDB<EmuC51Database>("emuc51", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("workspace")) {
        db.createObjectStore("workspace");
      }
    },
  });

export const saveWorkspace = async (record: WorkspaceRecord): Promise<void> => {
  const db = await database();
  try {
    await db.put("workspace", record, "current");
  } finally {
    db.close();
  }
};

export const loadWorkspace = async (): Promise<LoadedWorkspace | undefined> => {
  const db = await database();
  let value: unknown;
  try {
    value = await db.get("workspace", "current");
  } finally {
    db.close();
  }
  const record = normalizeWorkspaceRecord(value);
  if (record) return { kind: "complete", record };
  if (!isObject(value)) return undefined;
  const firmware = normalizeFirmwareRecord(value.firmware);
  if (!firmware) return undefined;
  return {
    kind: "firmware-only",
    firmware,
    settings: normalizeWorkspaceSettings(value.settings),
  };
};

export const clearWorkspace = async (): Promise<void> => {
  const db = await database();
  try {
    await db.delete("workspace", "current");
  } finally {
    db.close();
  }
};

export const requestPersistentStorage = async (): Promise<boolean | undefined> => {
  if (!navigator.storage?.persist) return undefined;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
};

export const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isInteger = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

// Use the intrinsic getter so objects with a fabricated byteLength are rejected,
// while genuine ArrayBuffers from another realm remain readable.
const bufferLength = (value: unknown): number | undefined => {
  try {
    const getter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
    return getter?.call(value) as number | undefined;
  } catch {
    return undefined;
  }
};

const isByteArray = (value: unknown, length: number): value is Uint8Array =>
  ArrayBuffer.isView(value) &&
  Object.prototype.toString.call(value) === "[object Uint8Array]" &&
  value.byteLength === length;

const normalizeFirmwareRecord = (value: unknown): WorkspaceRecord["firmware"] | undefined => {
  if (!isObject(value)) return undefined;
  const length = bufferLength(value.bytes);
  if (
    length === undefined || length > 0x10000 ||
    typeof value.name !== "string" || value.name.length < 1 || value.name.length > 1024 ||
    typeof value.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(value.sha256) ||
    !isInteger(value.loadedAt, 0)
  ) return undefined;
  return {
    name: value.name,
    bytes: new Uint8Array(value.bytes as ArrayBuffer).slice().buffer,
    sha256: value.sha256.toLowerCase(),
    loadedAt: value.loadedAt,
  };
};

const normalizeDebugConfig = (value: unknown): WorkspaceDebugConfig | undefined => {
  if (!isObject(value) || !Array.isArray(value.breakpoints) || !Array.isArray(value.watchpoints)) return undefined;
  if (value.breakpoints.length > 1024 || value.watchpoints.length > 1024) return undefined;
  const breakpoints = Array.from(value.breakpoints);
  if (!breakpoints.every((address) => isInteger(address, 0, 0xffff))) return undefined;
  const sfrAddresses = new Set<number>(Object.values(SFR));
  const watchpoints: WorkspaceDebugConfig["watchpoints"] = [];
  for (const item of value.watchpoints) {
    if (!isObject(item) || !isInteger(item.address, 0, 0xffff)) return undefined;
    if (
      (item.space === "iram" && item.address <= 0x7f) ||
      (item.space === "sfr" && sfrAddresses.has(item.address)) ||
      item.space === "xram"
    ) {
      watchpoints.push({ space: item.space, address: item.address });
    } else return undefined;
  }
  return { breakpoints: breakpoints as number[], watchpoints };
};

export const normalizeWorkspaceSettings = (value: unknown): WorkspaceSettings | undefined => {
  if (!isObject(value)) return undefined;
  if (
    !isInteger(value.maxSteps, 0, 100_000_000) ||
    typeof value.traceEnabled !== "boolean" ||
    typeof value.selectedMemorySpace !== "string" ||
    !["code", "iram", "sfr", "xram"].includes(value.selectedMemorySpace)
  ) return undefined;
  const debuggerConfig = value.debugger === undefined ? undefined : normalizeDebugConfig(value.debugger);
  if (value.debugger !== undefined && !debuggerConfig) return undefined;
  return {
    maxSteps: value.maxSteps,
    traceEnabled: value.traceEnabled,
    selectedMemorySpace: value.selectedMemorySpace as MemorySpace,
    ...(debuggerConfig ? { debugger: debuggerConfig } : {}),
  };
};

const isCpuSnapshot = (value: unknown): value is CpuSnapshot => {
  if (!isObject(value)) return false;
  return (
    (value.coreStateVersion === 1 || value.coreStateVersion === 2) &&
    isInteger(value.pc, 0, 0xffff) &&
    isInteger(value.steps, 0) &&
    isInteger(value.machineCycles, 0) &&
    isByteArray(value.iram, 0x80) &&
    isByteArray(value.sfr, 0x80) &&
    isByteArray(value.xram, 0x10000) &&
    (value.coreStateVersion === 1 || validatePeripheralSnapshot(value.peripherals))
  );
};

/** Validate structured-clone records and migrate legacy CPU state without executing it. */
export const normalizeWorkspaceRecord = (value: unknown): WorkspaceRecord | undefined => {
  if (!isObject(value)) return undefined;
  const firmware = normalizeFirmwareRecord(value.firmware);
  const settings = normalizeWorkspaceSettings(value.settings);
  if (
    !firmware || !settings || !isInteger(value.updatedAt, 0) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    value.coreStateVersion !== value.schemaVersion ||
    !isCpuSnapshot(value.cpu) || value.cpu.coreStateVersion !== value.coreStateVersion
  ) return undefined;
  try {
    const cpu = new Cpu8051(new Uint8Array(firmware.bytes));
    cpu.restore({
      ...value.cpu,
      iram: new Uint8Array(value.cpu.iram),
      sfr: new Uint8Array(value.cpu.sfr),
      xram: new Uint8Array(value.cpu.xram),
    });
    return {
      schemaVersion: 2,
      coreStateVersion: 2,
      firmware,
      cpu: cpu.snapshot(),
      settings,
      updatedAt: value.updatedAt,
    };
  } catch {
    return undefined;
  }
};
