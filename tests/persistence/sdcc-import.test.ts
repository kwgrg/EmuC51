import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sdccFixture } from "../fixtures/sdcc-fixture";
import { importSdccFiles } from "../../src/persistence/sdcc-import";
import { verifySdccDebug } from "../../src/core/sdcc-debug";
import { exportWorkspace, importWorkspace } from "../../src/persistence/transfer";
import { normalizeWorkspaceSettings } from "../../src/persistence/db";
import { workspaceFixture } from "./fixtures";
import { Cpu8051 } from "../../src/core/cpu";
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const data = sdccFixture();
const files = () => [{ name: "emuc51-sdcc.json", text: JSON.stringify(data.manifest) }, ...(["source", "ihx", "cdb"] as const).map(key => ({ name: data.manifest.files[key].name, text: data[key] }))].map(({ name, text }) => ({ name, size: new TextEncoder().encode(text).length, arrayBuffer: async () => new TextEncoder().encode(text).buffer }) as File);
it("imports four files in any order and rejects missing/duplicate/mismatched files", async () => {
  expect((await importSdccFiles(files().reverse())).locations).toHaveLength(5);
  await expect(importSdccFiles(files().slice(1))).rejects.toThrow("四个");
  const duplicate = files(); duplicate[0] = duplicate[1]!;
  await expect(importSdccFiles(duplicate)).rejects.toThrow("四个");
  const renamed = files(); Object.assign(renamed[1]!, { name: "other.c" });
  await expect(importSdccFiles(renamed)).rejects.toThrow();
  const oversize = files(); Object.assign(oversize[2]!, { size: 256 * 1024 + 1 });
  await expect(importSdccFiles(oversize)).rejects.toThrow("256 KiB");
});
it("round-trips verified source debug data and rejects tampering before workspace replacement", async () => {
  const verified = await verifySdccDebug(data);
  const record = workspaceFixture();
  record.firmware = { ...record.firmware, bytes: verified.firmware, sha256: verified.firmwareSha256 };
  record.cpu = new Cpu8051(new Uint8Array(verified.firmware)).snapshot(); record.settings.sdccDebug = data;
  const text = exportWorkspace(record);
  expect((await importWorkspace(text)).settings.sdccDebug).toEqual(data);
  const stale = JSON.parse(text); stale.settings.sdccDebug.source += "\n";
  await expect(importWorkspace(JSON.stringify(stale))).rejects.toThrow("SHA-256");
  const different = workspaceFixture(); different.settings.sdccDebug = data;
  await expect(importWorkspace(exportWorkspace(different))).rejects.toThrow("当前固件");
});
it("does not allow concurrent ASM and SDCC firmware bindings", () => {
  expect(normalizeWorkspaceSettings({ ...workspaceFixture().settings, sdccDebug: data, asmProject: { name: "main.asm", source: "NOP" }, asmBinding: { assembler: "emuc51-asm-1", sourceSha256: "a".repeat(64), firmwareSha256: "b".repeat(64) } })).toBeUndefined();
});
