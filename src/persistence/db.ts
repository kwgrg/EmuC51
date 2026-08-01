import { openDB, type DBSchema } from "idb";
import type { CpuSnapshot, MemorySpace } from "../core/types";

export interface WorkspaceSettings {
  maxSteps: number;
  traceEnabled: boolean;
  selectedMemorySpace: MemorySpace;
}

export interface WorkspaceRecord {
  schemaVersion: 1;
  coreStateVersion: 1;
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
  await db.put("workspace", record, "current");
};

export const loadWorkspace = async (): Promise<LoadedWorkspace | undefined> => {
  const db = await database();
  const value: unknown = await db.get("workspace", "current");
  if (!value || typeof value !== "object") return undefined;
  if (isWorkspaceRecord(value)) return { kind: "complete", record: value };
  const partial = value as Partial<WorkspaceRecord>;
  if (!isFirmwareRecord(partial.firmware)) return undefined;
  return {
    kind: "firmware-only",
    firmware: partial.firmware,
    settings: isWorkspaceSettings(partial.settings) ? partial.settings : undefined,
  };
};

export const clearWorkspace = async (): Promise<void> => {
  const db = await database();
  await db.delete("workspace", "current");
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

const hasByteLength = (value: unknown, length?: number): boolean => {
  if (!value || typeof value !== "object" || !("byteLength" in value)) return false;
  const byteLength = (value as { byteLength?: unknown }).byteLength;
  return typeof byteLength === "number" && (length === undefined || byteLength === length);
};

const isFirmwareRecord = (
  firmware: unknown,
): firmware is WorkspaceRecord["firmware"] => {
  if (!firmware || typeof firmware !== "object") return false;
  const candidate = firmware as Partial<WorkspaceRecord["firmware"]>;
  return (
    hasByteLength(candidate.bytes) &&
    (candidate.bytes?.byteLength ?? 0) <= 0x10000 &&
    typeof candidate.name === "string" &&
    typeof candidate.sha256 === "string" &&
    typeof candidate.loadedAt === "number"
  );
};

const isWorkspaceSettings = (settings: unknown): settings is WorkspaceSettings => {
  if (!settings || typeof settings !== "object") return false;
  const candidate = settings as Partial<WorkspaceSettings>;
  return (
    typeof candidate.maxSteps === "number" &&
    typeof candidate.traceEnabled === "boolean" &&
    ["code", "iram", "sfr", "xram"].includes(candidate.selectedMemorySpace ?? "")
  );
};

const isWorkspaceRecord = (value: unknown): value is WorkspaceRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<WorkspaceRecord>;
  const firmware = record.firmware;
  const cpu = record.cpu;
  const settings = record.settings;
  if (!firmware || !cpu || !settings) return false;
  return (
    record.schemaVersion === 1 &&
    record.coreStateVersion === 1 &&
    isFirmwareRecord(firmware) &&
    cpu.coreStateVersion === 1 &&
    hasByteLength(cpu.iram, 0x80) &&
    hasByteLength(cpu.sfr, 0x80) &&
    hasByteLength(cpu.xram, 0x10000) &&
    isWorkspaceSettings(settings)
  );
};
