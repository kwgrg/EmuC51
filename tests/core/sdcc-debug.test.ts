import { sdccFixture as fixture } from "../fixtures/sdcc-fixture";
import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { parseCdbLines, verifySdccDebug, toggleSourceBreakpoints } from "../../src/core/sdcc-debug";
import { parseFirmware } from "../../src/core/firmware";
import { Cpu8051 } from "../../src/core/cpu";
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
const data = fixture();
const firmware = parseFirmware(new TextEncoder().encode(data.ihx), "main.ihx");
const parse = (cdb: string, bytes = firmware) => parseCdbLines(cdb, "main.c", data.source, bytes);
it("binds real linked SDCC files and does not infer startup or gap source lines", async () => {
  const verified = await verifySdccDebug(data);
  expect(verified.locations).toEqual([{ line: 3, address: 0xa8 }, { line: 4, address: 0xa8 }, { line: 6, address: 0xab }, { line: 7, address: 0xad }, { line: 9, address: 0xb2 }]);
  expect(verified.locations.some(item => item.address === 0 || item.address === 0xb0)).toBe(false);
  const cpu = new Cpu8051(new Uint8Array(verified.firmware));
  for (let steps = 0; cpu.pc !== 0xab && steps < 1000; steps++) cpu.step();
  expect(cpu.pc).toBe(0xab); cpu.step(); expect(cpu.memory.iram[8]).toBe(1);
});
it("preserves all distinct addresses on a genuine multi-function physical line", async () => {
  const verified = await verifySdccDebug(fixture("flow", "sdcc-flow"));
  expect(verified.locations.filter(item => item.line === 3).map(item => item.address)).toEqual([0xa8, 0xaa, 0xb2]);
  expect(verified.locations.some(item => item.address === 0xab)).toBe(false);
});
it.each(["source", "ihx", "cdb"] as const)("rejects a mixed or modified %s", async key => {
  await expect(verifySdccDebug({ ...data, [key]: data[key] + "\n" })).rejects.toThrow("SHA-256");
});
it("rejects mismatched active firmware", async () => {
  await expect(verifySdccDebug(data, new Uint8Array([0]).buffer)).rejects.toThrow("当前固件");
});
it.each([
  ["module", data.cdb.replace("M:main", "M:other")],
  ["duplicate module", data.cdb + "\nM:main"],
  ["file", data.cdb.replace("L:C$main.c", "L:C$other.c")],
  ["zero line", data.cdb.replace("$3$0_0$2:A8", "$0$0_0$2:A8")],
  ["line bounds", data.cdb.replace("$3$0_0$2:A8", "$999$0_0$2:A8")],
  ["address bounds", data.cdb.replace("$3$0_0$2:A8", "$3$0_0$2:FFFF")],
  ["nonhex", data.cdb.replace("$3$0_0$2:A8", "$3$0_0$2:ZZ")],
  ["missing asm link", data.cdb.replace("L:A$main$483:A8", "")],
  ["unlinked", "M:main\nS:G$main$0$0"],
  ["control", data.cdb + "\u0000"],
  ["nonascii", data.cdb + "中"],
  ["unsupported", data.cdb + "\nL:Q$foo:AA"],
  ["record bounds", data.cdb + "\nS:" + "x".repeat(4096)],
])("rejects malformed CDB: %s", (_name, cdb) => expect(() => parse(cdb)).toThrow());
it("deduplicates duplicate line/address records", () => expect(parse(data.cdb + "\nL:C$main.c$6$3_0$4:AB")).toHaveLength(5));
it("rejects illegal and truncated mapped instructions", () => {
  const illegal = firmware.slice(); illegal[0xa8] = 0xa5;
  expect(() => parse(data.cdb, illegal)).toThrow("指令");
  const truncated = firmware.slice(0, 0xa9); truncated[0xa8] = 0x75;
  expect(() => parse("M:main\nL:A$main$1:A8\nL:C$main.c$3$0_0$2:A8", truncated)).toThrow("指令");
});
it("toggles a whole line atomically, preserving configured condition/count/enable options", () => {
  const initial = { breakpoints: [0xa8], breakpointOptions: [{ address: 0xa8, enabled: false, hitCount: 3, condition: "ACC == 1" }], watchpoints: [] };
  const added = toggleSourceBreakpoints(initial, [0xa8, 0xaa, 0xb2, 0xa8]);
  expect(added.breakpoints).toEqual([0xa8, 0xaa, 0xb2]); expect(added.breakpointOptions).toEqual(initial.breakpointOptions);
  expect(toggleSourceBreakpoints(added, [0xa8, 0xaa, 0xb2])).toMatchObject({ breakpoints: [], breakpointOptions: [] });
  const full = { breakpoints: Array.from({ length: 1024 }, (_, i) => i), watchpoints: [] };
  expect(() => toggleSourceBreakpoints(full, [1024])).toThrow("1024"); expect(full.breakpoints).toHaveLength(1024);
});
