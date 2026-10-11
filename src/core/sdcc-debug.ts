import { parseCdbSymbols, type CdbSymbol } from "./cdb-symbols";
import { parseFirmware } from "./firmware";
import { sha256Hex } from "./digest";
import { opcodeMeta } from "./opcodes";
import { normalizeDebugConfig, removeBreakpoint, type DebugConfig } from "./debugger";

export const SDCC_TEXT_LIMIT = 256 * 1024;
export const SDCC_SOURCE_LIMIT = 65536;
export const SDCC_LINE_LIMIT = 8192;
export const SDCC_OPTIONS = ["-mmcs51", "--model-small", "--iram-size", "128", "--debug"] as const;
interface FileIdentity { name: string; sha256: string }
export interface SdccManifest {
  format: "emuc51-sdcc-debug"; version: 1;
  compiler: "SDCC 4.5.0 #15242";
  target: "classic-8051";
  options: string[];
  files: { source: FileIdentity; ihx: FileIdentity; cdb: FileIdentity };
}
export interface SdccDebugData { manifest: SdccManifest; source: string; ihx: string; cdb: string }
export interface SourceLocation { line: number; address: number }
export interface VerifiedSdccDebug {
  data: SdccDebugData; firmware: ArrayBuffer; firmwareSha256: string; locations: SourceLocation[]; symbols: CdbSymbol[];
}
const invalid = (message: string): never => { throw new Error(`SDCC 导入：${message}`); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const sourceLines = (source: string) => source.split(/\r\n|\n|\r/);
const identity = (value: unknown, extension: string): FileIdentity => {
  if (!object(value) || typeof value.name !== "string" || !new RegExp(`^[A-Za-z_][A-Za-z0-9_-]{0,63}\\.${extension}$`).test(value.name) ||
    typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) return invalid("文件名称或 SHA-256 无效");
  return { name: value.name, sha256: value.sha256 };
};
export function normalizeSdccDebug(value: unknown): SdccDebugData {
  if (!object(value) || !object(value.manifest)) return invalid("缺少构建摘要清单");
  const m = value.manifest;
  if (m.format !== "emuc51-sdcc-debug" || m.version !== 1 || m.compiler !== "SDCC 4.5.0 #15242" || m.target !== "classic-8051" ||
    !Array.isArray(m.options) || JSON.stringify(m.options) !== JSON.stringify(SDCC_OPTIONS) || !object(m.files)) return invalid("仅支持 SDCC 4.5.0 #15242 / classic-8051 / small / --iram-size 128 / --debug 构建清单");
  const source = identity(m.files.source, "c");
  const ihx = identity(m.files.ihx, "ihx");
  const cdb = identity(m.files.cdb, "cdb");
  if (ihx.name !== source.name.replace(/\.c$/, ".ihx") || cdb.name !== source.name.replace(/\.c$/, ".cdb")) return invalid("单文件产物必须与源文件同名");
  if (typeof value.source !== "string" || value.source.length > SDCC_SOURCE_LIMIT || sourceLines(value.source).length > SDCC_LINE_LIMIT ||
    typeof value.ihx !== "string" || value.ihx.length > SDCC_TEXT_LIMIT || typeof value.cdb !== "string" || value.cdb.length > SDCC_TEXT_LIMIT) return invalid("源码或调试文件超出大小/行数限制");
  return { manifest: { format: "emuc51-sdcc-debug", version: 1, compiler: m.compiler, target: m.target, options: [...SDCC_OPTIONS], files: { source, ihx, cdb } }, source: value.source, ihx: value.ihx, cdb: value.cdb };
}

/** Only exact linked C-line addresses; never fill gaps or infer source from HEX. */
export function parseCdbLines(cdb: string, filename: string, source: string, firmware: Uint8Array): SourceLocation[] {
  if (cdb.length > SDCC_TEXT_LIMIT || [...cdb].some(char => !"\t\n\r".includes(char) && (char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126))) return invalid("CDB 须为有界 ASCII 记录");
  const records = cdb.split(/\r\n|\n|\r/);
  if (records.length > 16384) return invalid("CDB 记录过多");
  const module = filename.replace(/\.c$/, "");
  const lineCount = sourceLines(source).length;
  const asmAddresses = new Set<number>();
  const pairs = new Map<string, SourceLocation>();
  let moduleFound = false;
  const address = (hex: string): number => {
    const value = Number.parseInt(hex, 16);
    if (!Number.isSafeInteger(value) || value < 0 || value >= firmware.length || value > 0xffff) return invalid("链接地址超出当前固件");
    return value;
  };
  for (const raw of records) {
    const record = raw.trim(); if (!record) continue;
    if (record.length > 4096 || (!/^[MFSTL]:.+$/.test(record) || [...record].some(char => char.charCodeAt(0) < 32))) return invalid("CDB 记录格式无效");
    if (record.startsWith("M:")) {
      if (record !== `M:${module}` || moduleFound) return invalid("CDB 模块与单个源文件不匹配");
      moduleFound = true;
    } else if (record.startsWith("L:C")) {
      const match = /^L:C\$([^$]+)\$(\d+)\$(\d+(?:_\d+)*)\$(\d+):([0-9a-fA-F]{1,8})$/.exec(record);
      if (!match || match[1] !== filename) return invalid("CDB 源文件不匹配或 C 行记录畸形");
      const line = Number(match[2]);
      if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) return invalid("CDB 源码行越界");
      const pc = address(match[5]!);
      pairs.set(`${line}:${pc}`, { line, address: pc });
      if (pairs.size > SDCC_LINE_LIMIT) return invalid("CDB 源码映射项过多");
    } else if (record.startsWith("L:A")) {
      const match = /^L:A\$([^$]+)\$(\d+):([0-9a-fA-F]{1,8})$/.exec(record);
      if (!match || match[1] !== module || Number(match[2]) < 1 || !Number.isSafeInteger(Number(match[2]))) return invalid("CDB 汇编链接行无效");
      asmAddresses.add(address(match[3]!));
    } else if (record.startsWith("L:") && !/^L:(?:G|F|L|XG|XF)[^:]+:[0-9a-fA-F]{1,8}$/.test(record)) return invalid("不支持或畸形的 CDB 链接记录");
    // Exact C line validation is independent of the separately bounded S/L symbol subset.
  }
  if (!moduleFound || !pairs.size) return invalid("缺少模块或链接后的 C 行地址；不能使用未链接调试文件");
  for (const location of pairs.values()) {
    const meta = opcodeMeta(firmware[location.address]!);
    if (!asmAddresses.has(location.address) || !meta.legal || location.address + meta.length > firmware.length) return invalid("C 行地址没有有效的汇编链接指令对应");
  }
  return [...pairs.values()].sort((a, b) => a.line - b.line || a.address - b.address);
}

export async function verifySdccDebug(value: unknown, currentFirmware?: ArrayBuffer): Promise<VerifiedSdccDebug> {
  const data = normalizeSdccDebug(value);
  const encoder = new TextEncoder();
  for (const key of ["source", "ihx", "cdb"] as const) {
    const bytes = encoder.encode(data[key]);
    if (bytes.byteLength > SDCC_TEXT_LIMIT || await sha256Hex(bytes.buffer) !== data.manifest.files[key].sha256) return invalid(`${key} SHA-256 不匹配；请使用同一次构建的文件`);
  }
  const firmware = new Uint8Array(parseFirmware(encoder.encode(data.ihx), data.manifest.files.ihx.name)).buffer;
  const firmwareSha256 = await sha256Hex(firmware);
  if (currentFirmware && await sha256Hex(currentFirmware) !== firmwareSha256) return invalid("调试文件与当前固件不匹配");
  const locations = parseCdbLines(data.cdb, data.manifest.files.source.name, data.source, new Uint8Array(firmware));
  const symbols=parseCdbSymbols(data.cdb,data.manifest.files.source.name.replace(/\.c$/,""),firmware.byteLength);
  return { data, firmware, firmwareSha256, locations, symbols };
}

export function toggleSourceBreakpoints(config: DebugConfig, addresses: number[]): DebugConfig {
  const unique = [...new Set(addresses)];
  if (!unique.length) return config;
  if (unique.every(address => config.breakpoints.includes(address))) return unique.reduce((next, address) => removeBreakpoint(next, address), config);
  // Existing per-address enable/count/condition options remain untouched.
  return normalizeDebugConfig({ ...config, breakpoints: [...new Set([...config.breakpoints, ...unique])].sort((a, b) => a - b) });
}
