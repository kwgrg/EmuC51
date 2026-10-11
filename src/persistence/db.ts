import { normalizeInputScenario, type InputScenario } from "../core/input-scenario";
import { normalizeSdccDebug, type SdccDebugData } from "../core/sdcc-debug";
import { ASSEMBLER_VERSION, normalizeAsmProject, type AsmProject, type AsmBinding } from "../core/assembler";
import { openDB, type DBSchema } from "idb";
import { MAX_EXPRESSION_LENGTH, MAX_WATCH_EXPRESSIONS } from "../core/expressions";
import { Cpu8051 } from "../core/cpu";
import { normalizeDebugConfig, type DebugConfig } from "../core/debugger";
import { validatePeripheralSnapshot } from "../core/peripherals";
import type { CpuSnapshot, MemorySpace } from "../core/types";

export type WorkspaceDebugConfig = DebugConfig;

export interface WorkspaceSettings {
  inputScenario?: InputScenario;
  sdccDebug?: SdccDebugData;
  asmProject?: AsmProject;
  asmBinding?: AsmBinding;
  maxSteps: number;
  traceEnabled: boolean;
  selectedMemorySpace: MemorySpace;
  debugger?: WorkspaceDebugConfig;
  watchExpressions?: string[];
  memoryAddress?: number;
}

export interface WorkspaceRecord {
  // v4 adds condition semantics; v1-v3 remain readable, CPU stays v2.
  schemaVersion: 1 | 2 | 3 | 4;
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

export { sha256Hex } from "../core/digest";

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

const normalizeWorkspaceDebugConfig = (value: unknown): WorkspaceDebugConfig | undefined => {
  try {
    return normalizeDebugConfig(value as DebugConfig);
  } catch {
    return undefined;
  }
};

export const normalizeWorkspaceSettings = (value: unknown): WorkspaceSettings | undefined => {
  if (!isObject(value)) return undefined;
  if (
    !isInteger(value.maxSteps, 0, 100_000_000) ||
    typeof value.traceEnabled !== "boolean" ||
    typeof value.selectedMemorySpace !== "string" ||
    !["code", "iram", "sfr", "xram"].includes(value.selectedMemorySpace)
  ) return undefined;
  let inputScenario: InputScenario | undefined;
  if (value.inputScenario !== undefined) {
    try { inputScenario = normalizeInputScenario(value.inputScenario); } catch { return undefined; }
  }
  let sdccDebug: SdccDebugData | undefined;
  if (value.sdccDebug !== undefined) {
    try { sdccDebug = normalizeSdccDebug(value.sdccDebug); } catch { return undefined; }
  }
  if (sdccDebug && value.asmBinding !== undefined) return undefined;
  const asmProject = value.asmProject === undefined ? undefined : normalizeAsmProject(value.asmProject);
  if (value.asmProject !== undefined && !asmProject) return undefined;
  let asmBinding: AsmBinding | undefined;
  if (value.asmBinding !== undefined) {
    const binding = value.asmBinding;
    if (!asmProject || !isObject(binding) || binding.assembler !== ASSEMBLER_VERSION ||
      typeof binding.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(binding.sourceSha256) ||
      typeof binding.firmwareSha256 !== "string" || !/^[a-f0-9]{64}$/.test(binding.firmwareSha256)) return undefined;
    asmBinding = { assembler: ASSEMBLER_VERSION, sourceSha256: binding.sourceSha256, firmwareSha256: binding.firmwareSha256 };
  }
  const debuggerConfig = value.debugger === undefined ? undefined : normalizeWorkspaceDebugConfig(value.debugger);
  if (value.debugger !== undefined && !debuggerConfig) return undefined;
  let watchExpressions: string[] | undefined;
  if (value.watchExpressions !== undefined) {
    if (!Array.isArray(value.watchExpressions) || value.watchExpressions.length > MAX_WATCH_EXPRESSIONS ||
        Array.from(value.watchExpressions).some(item => typeof item !== "string" || !item.trim() || item.length > MAX_EXPRESSION_LENGTH)) return undefined;
    watchExpressions = (value.watchExpressions as string[]).map(item => item.trim());
    if (new Set(watchExpressions).size !== watchExpressions.length) return undefined;
  }
  const minimum = value.selectedMemorySpace === "sfr" ? 0x80 : 0;
  const maximum = value.selectedMemorySpace === "iram" ? 0x7f : value.selectedMemorySpace === "sfr" ? 0xff : 0xffff;
  if (value.memoryAddress !== undefined && !isInteger(value.memoryAddress, minimum, maximum)) return undefined;
  return {
    ...(inputScenario ? { inputScenario } : {}),
    ...(sdccDebug ? { sdccDebug } : {}),
    ...(asmProject ? { asmProject } : {}),
    ...(asmBinding ? { asmBinding } : {}),
    maxSteps: value.maxSteps,
    traceEnabled: value.traceEnabled,
    selectedMemorySpace: value.selectedMemorySpace as MemorySpace,
    ...(debuggerConfig ? { debugger: debuggerConfig } : {}),
    ...(watchExpressions ? { watchExpressions } : {}),
    ...(value.memoryAddress !== undefined ? { memoryAddress: value.memoryAddress as number } : {}),
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
    !firmware || !settings || (settings.inputScenario && settings.inputScenario.firmwareSha256 !== firmware.sha256) || (settings.asmBinding && settings.asmBinding.firmwareSha256 !== firmware.sha256) || !isInteger(value.updatedAt, 0) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4) ||
    value.coreStateVersion !== (value.schemaVersion === 1 ? 1 : 2) ||
    ((value.schemaVersion === 1 || value.schemaVersion === 2) && settings.debugger?.breakpointOptions !== undefined) ||
    (value.schemaVersion !== 4 && settings.debugger?.breakpointOptions?.some(option => option.condition !== undefined)) ||
    (value.schemaVersion !== 4 && settings.debugger?.accessWatchpoints !== undefined) ||
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
      schemaVersion: 4,
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
