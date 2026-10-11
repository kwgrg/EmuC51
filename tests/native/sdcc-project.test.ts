// Explicit native integration: SDCC_BIN must name the verified 4.5.0 installation.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "emuc51-project-test-")); roots.push(root);
  cpSync("tests/fixtures/sdcc-mixed/project", join(root, "project"), { recursive: true });
  return { root, manifest: join(root, "project/project.json"), output: join(root, "output") };
};
const build = (manifest: string, output: string) => execFileSync(process.execPath, [resolve("scripts/build-sdcc-project.mjs"), manifest, output], { env: process.env, encoding: "utf8", stdio: "pipe", timeout: 90000 });
it.skipIf(!process.env.SDCC_BIN)("rebuilds the actual mixed package byte-identically and refuses stale destinations", () => {
  const { manifest, output } = setup(); build(manifest, output);
  const result = readFileSync(join(output,"emuc51-project.build.json"),"utf8");
  expect(result).toBe(readFileSync("tests/fixtures/sdcc-mixed/emuc51-project.build.json","utf8"));
  expect(() => build(manifest, output)).toThrow();
  expect(readFileSync(join(output,"emuc51-project.build.json"),"utf8")).toBe(result);
});
it.skipIf(!process.env.SDCC_BIN)("never publishes a partial package after a real compilation failure", () => {
  const { root, manifest, output } = setup(); writeFileSync(join(root,"project/src/compute.c"),"not valid C !!!");
  expect(() => build(manifest, output)).toThrow(); expect(existsSync(output)).toBe(false);
});
it("rejects escaping includes, macro directives, symlinks and arbitrary project commands before compiling", () => {
  for (const malicious of ['#include "/etc/passwd"', '#include "../outside.h"', '#include NEXT', '#pragma preproc_asm +', '_Pragma("whatever")']) {
    const { root, manifest, output } = setup(); writeFileSync(join(root,"project/src/main.c"),malicious);
    expect(() => build(manifest, output)).toThrow(); expect(existsSync(output)).toBe(false);
  }
  const { root, manifest, output } = setup();
  rmSync(join(root,"project/src/main.c")); symlinkSync("/etc/passwd",join(root,"project/src/main.c"));
  expect(() => build(manifest, output)).toThrow(); expect(existsSync(output)).toBe(false);
  const other=setup(); writeFileSync(join(other.root,"project/asm/bridge.asm"),".module bridge\n.macro hidden\n.endm\n");
  expect(() => build(other.manifest, other.output)).toThrow(); expect(existsSync(other.output)).toBe(false);
  const command=setup(), project=JSON.parse(readFileSync(command.manifest,"utf8"));project.command="touch unsafe";writeFileSync(command.manifest,JSON.stringify(project));
  expect(()=>build(command.manifest,command.output)).toThrow();expect(existsSync(command.output)).toBe(false);
});
