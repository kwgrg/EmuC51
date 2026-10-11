import { beforeEach, expect, it } from "vitest";
import { normalizeWorkspaceRecord, normalizeWorkspaceSettings } from "../../src/persistence/db";
import { readAsmDraft, saveAsmDraft } from "../../src/persistence/asm-draft";
import { workspaceFixture } from "./fixtures";
import { ASSEMBLER_VERSION, MAX_ASM_SOURCE } from "../../src/core/assembler";
const project = { name: "main.asm", source: "NOP" };
const binding = { assembler: ASSEMBLER_VERSION, sourceSha256: "a".repeat(64), firmwareSha256: workspaceFixture().firmware.sha256 } as const;
beforeEach(() => localStorage.clear());
it("round-trips bounded drafts and explicitly clears them independently of firmware", () => {
  saveAsmDraft(project); expect(readAsmDraft()).toEqual(project);
  saveAsmDraft(undefined); expect(readAsmDraft()).toBeUndefined();
  localStorage.setItem("emuc51.asm-draft.v1", "malformed"); expect(readAsmDraft()).toBeUndefined();
});
it("preserves project/binding and allows dirty source without claiming a verified build", () => {
  const record = workspaceFixture(); record.settings.asmProject = { ...project, source: "INC A" }; record.settings.asmBinding = binding;
  expect(normalizeWorkspaceRecord(record)?.settings).toMatchObject({ asmProject: { source: "INC A" }, asmBinding: binding });
  record.settings.asmBinding = { ...binding, firmwareSha256: "f".repeat(64) };
  expect(normalizeWorkspaceRecord(record)).toBeUndefined();
});
it.each([
  { asmProject: { ...project, source: "x".repeat(MAX_ASM_SOURCE+1) } },
  { asmProject: { ...project, name: "../../bad.asm" } },
  { asmBinding: binding },
  { asmProject: project, asmBinding: { ...binding, assembler: "untrusted" } },
  { asmProject: project, asmBinding: { ...binding, sourceSha256: "bad" } },
])("rejects malformed project settings %j", extra => {
  expect(normalizeWorkspaceSettings({ ...workspaceFixture().settings, ...extra })).toBeUndefined();
});
