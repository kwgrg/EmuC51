/** Shared browser/native project contract. No commands, user flags or absolute paths. */
export const PROJECT_OPTIONS = ["-mmcs51", "--model-small", "--iram-size", "128", "--debug"] as const;
export const PROJECT_BUNDLE_LIMIT = 2 * 1024 * 1024;
export interface SdccProject {
  format: "emuc51-sdcc-project"; version: 1;
  entry: string;
  sources: { path: string; language: "c" | "sdas8051" }[];
  headers: string[];
  includeDirs: string[];
  options: string[];
}
export interface ProjectInput { path: string; text: string; sha256: string }
const fail = (): never => { throw new Error("混合工程清单无效：仅支持有界规范相对路径、唯一模块及固定构建参数"); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export function projectPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !/^(?:[A-Za-z_][A-Za-z0-9_-]{0,31}\/){0,4}[A-Za-z_][A-Za-z0-9_]{0,63}\.(?:c|h|asm)$/.test(value)) return fail();
  return value;
}
export function normalizeSdccProject(value: unknown): SdccProject {
  if (!object(value) || Object.keys(value).some(key => !["format","version","entry","sources","headers","includeDirs","options"].includes(key)) ||
    value.format !== "emuc51-sdcc-project" || value.version !== 1 || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 16 ||
    !Array.isArray(value.headers) || value.headers.length > 16 || !Array.isArray(value.includeDirs) || value.includeDirs.length > 8 ||
    JSON.stringify(value.options) !== JSON.stringify(PROJECT_OPTIONS)) return fail();
  const sources = value.sources.map(item => {
    if (!object(item) || Object.keys(item).some(key => !["path","language"].includes(key))) return fail();
    const path = projectPath(item.path), language = item.language;
    if ((language !== "c" || !path.endsWith(".c")) && (language !== "sdas8051" || !path.endsWith(".asm"))) return fail();
    return { path, language: language as "c" | "sdas8051" };
  });
  const headers = value.headers.map(path => { const name = projectPath(path); if (!name.endsWith(".h")) return fail(); return name; });
  const paths = [...sources.map(item => item.path), ...headers];
  // CDB records lose directories. Reject ambiguous basenames before compiling.
  const names = paths.map(path => path.split("/").at(-1)!.toLowerCase());
  const modules = sources.map(item => item.path.split("/").at(-1)!.replace(/\.[^.]+$/, "").toLowerCase());
  if (new Set(names).size !== names.length || new Set(modules).size !== modules.length || modules.includes("firmware")) return fail();
  const entry = projectPath(value.entry);
  if (!sources.some(item => item.path === entry && item.language === "c") || !sources.some(item => item.language === "sdas8051")) return fail();
  const includeDirs = value.includeDirs.map(dir => {
    if (typeof dir !== "string" || dir.length > 128 || !/^[A-Za-z_][A-Za-z0-9_-]{0,31}(?:\/[A-Za-z_][A-Za-z0-9_-]{0,31}){0,3}$/.test(dir) || !headers.some(path => path.startsWith(`${dir}/`))) return fail();
    return dir;
  });
  if (new Set(includeDirs).size !== includeDirs.length) return fail();
  return { format: value.format, version: 1, entry, sources, headers, includeDirs, options: [...PROJECT_OPTIONS] };
}
export function normalizeProjectInputs(project: SdccProject, value: unknown): ProjectInput[] {
  const paths = [...project.sources.map(item => item.path), ...project.headers];
  if (!Array.isArray(value) || value.length !== paths.length) return fail();
  let size = 0;
  const inputs = value.map(item => {
    if (!object(item) || Object.keys(item).some(key => !["path","text","sha256"].includes(key)) || typeof item.text !== "string" ||
      item.text.length > 65536 || item.text.split(/\r\n|\n|\r/).length > 8192 || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) return fail();
    const path = projectPath(item.path); if (!paths.includes(path)) return fail();
    size += item.text.length;
    return { path, text: item.text, sha256: item.sha256 };
  });
  if (size > 512 * 1024 || new Set(inputs.map(item => item.path)).size !== paths.length) return fail();
  return inputs;
}
