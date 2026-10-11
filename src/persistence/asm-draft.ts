import { normalizeAsmProject, type AsmProject } from "../core/assembler";
const KEY = "emuc51.asm-draft.v1";
export function readAsmDraft(): AsmProject | undefined {
  try { return normalizeAsmProject(JSON.parse(localStorage.getItem(KEY) ?? "null")); }
  catch { return undefined; }
}
export function saveAsmDraft(project?: AsmProject): void {
  if (project) localStorage.setItem(KEY, JSON.stringify(project));
  else localStorage.removeItem(KEY);
}
