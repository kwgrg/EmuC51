import { normalizeWorkspaceRecord, sha256Hex, type WorkspaceRecord } from "./db";

// A maximum-size 64 KiB firmware and 64 KiB XRAM encoded as JSON byte arrays,
// including bounded peripheral queues and debugger configuration, fit in 1 MiB.
export const MAX_WORKSPACE_IMPORT_BYTES = 1024 * 1024;

const invalidWorkspace = (): Error => new Error("工作区文件无效：版本、内存、外设状态或设置未通过校验");

const decodeByteArray = (value: unknown, maxLength: number, exactLength?: number): Uint8Array => {
  if (!Array.isArray(value) || value.length > maxLength || (exactLength !== undefined && value.length !== exactLength)) {
    throw invalidWorkspace();
  }
  for (const byte of value) {
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 0xff) throw invalidWorkspace();
  }
  return Uint8Array.from(value as number[]);
};

/** Create a portable JSON file; native binary buffers are explicitly encoded as byte arrays. */
export const exportWorkspace = (record: WorkspaceRecord): string => {
  const normalized = normalizeWorkspaceRecord(record);
  if (!normalized) throw invalidWorkspace();
  return JSON.stringify({
    ...normalized,
    firmware: {
      ...normalized.firmware,
      bytes: Array.from(new Uint8Array(normalized.firmware.bytes)),
    },
    cpu: {
      ...normalized.cpu,
      iram: Array.from(normalized.cpu.iram),
      sfr: Array.from(normalized.cpu.sfr),
      xram: Array.from(normalized.cpu.xram),
    },
  });
};

/** Validate and verify the firmware checksum before the caller changes its current workspace. */
export const importWorkspace = async (text: string): Promise<WorkspaceRecord> => {
  if (typeof text !== "string" || text.length > MAX_WORKSPACE_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_WORKSPACE_IMPORT_BYTES) {
    throw new Error("工作区文件超过 1 MiB 上限");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("工作区文件不是有效的 JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalidWorkspace();
  const candidate = value as Record<string, unknown>;
  if (!candidate.firmware || typeof candidate.firmware !== "object" || Array.isArray(candidate.firmware) ||
      !candidate.cpu || typeof candidate.cpu !== "object" || Array.isArray(candidate.cpu)) throw invalidWorkspace();
  const firmware = candidate.firmware as Record<string, unknown>;
  const cpu = candidate.cpu as Record<string, unknown>;
  const record = normalizeWorkspaceRecord({
    ...candidate,
    firmware: { ...firmware, bytes: decodeByteArray(firmware.bytes, 0x10000).buffer },
    cpu: {
      ...cpu,
      iram: decodeByteArray(cpu.iram, 0x80, 0x80),
      sfr: decodeByteArray(cpu.sfr, 0x80, 0x80),
      xram: decodeByteArray(cpu.xram, 0x10000, 0x10000),
    },
  });
  if (!record) throw invalidWorkspace();
  if (await sha256Hex(record.firmware.bytes) !== record.firmware.sha256) {
    throw new Error("工作区固件 SHA-256 校验失败，文件可能已损坏");
  }
  return record;
};
