import { expect, it } from "vitest";
import { parseCdbFunctions, nameCallEntry } from "../../src/core/cdb-functions";
import { parseFirmware } from "../../src/core/firmware";
import { Cpu8051 } from "../../src/core/cpu";
import { SFR } from "../../src/core/memory";
import { sdccFixture } from "../fixtures/sdcc-fixture";
const data = sdccFixture("frames", "sdcc-frames");
const bytes = parseFirmware(new TextEncoder().encode(data.ihx), "frames.ihx");
const parse = (cdb = data.cdb) => parseCdbFunctions(cdb, "frames", bytes);
const functions = parse();
it("links real global/static F declarations to exact entry and inclusive endpoint instructions", () => {
  expect(functions.map(fn => [fn.name, fn.entry, fn.end])).toEqual([
    ["leaf", 0xb0, 0xb2], ["nested", 0xb3, 0xb8], ["recursive", 0xb9, 0xc7], ["timer", 0xc8, 0xca], ["main", 0xcb, 0xd9],
  ]);
  expect(nameCallEntry(functions, 0xb0).label).toBe("CDB::frames::Fframes$leaf$0$0");
  expect(nameCallEntry(functions, 0xb1)).toEqual({ label: "入口位于函数内部，未命名" });
  expect(nameCallEntry(functions, 0)).toEqual({ label: "无已验证函数入口" });
});
it.each([
  ["missing end", (s: string) => s.replace("L:XG$nested$0$0:B8", "")],
  ["duplicate start", (s: string) => s + "\nL:G$nested$0$0:B3"],
  ["duplicate end", (s: string) => s + "\nL:XG$nested$0$0:B8"],
  ["backwards", (s: string) => s.replace("L:XG$nested$0$0:B8", "L:XG$nested$0$0:B0")],
  ["operand endpoint", (s: string) => s.replace("L:XG$nested$0$0:B8", "L:XG$nested$0$0:B4")],
  ["out of bounds", (s: string) => s.replace("L:XG$nested$0$0:B8", "L:XG$nested$0$0:FFFF")],
])("leaves %s metadata unnamed", (_label, change) => {
  expect(parse(change(data.cdb)).some(fn => fn.name === "nested")).toBe(false);
});
it("does not choose between aliases or partially overlapping verified ranges", () => {
  const alias = data.cdb + "\nF:G$alias$0_0$0({2}DF,SV:S),C,0,0,0,0,0\nL:G$alias$0$0:B3\nL:XG$alias$0$0:B8";
  expect(nameCallEntry(parse(alias), 0xb3).definition).toBeUndefined();
  const overlap = data.cdb.replace("L:XG$nested$0$0:B8", "L:XG$nested$0$0:C7");
  expect(nameCallEntry(parse(overlap), 0xb9).label).toContain("重叠");
  expect(nameCallEntry(parse(overlap), 0xb3).label).toContain("重叠");
});
it("rejects duplicate declarations and does not require a guessed C definition line", () => {
  const duplicate = data.cdb + "\nF:G$nested$0_0$0({2}DF,SV:S),C,0,0,0,0,0";
  expect(parse(duplicate).some(fn => fn.name === "nested")).toBe(false);
  const flow = sdccFixture("flow", "sdcc-flow");
  const firmware = parseFirmware(new TextEncoder().encode(flow.ihx), "flow.ihx");
  const catalog = parseCdbFunctions(flow.cdb, "flow", firmware);
  expect(nameCallEntry(catalog, 0xab).definition?.name).toBe("two");
});
it("bounds the catalog even with otherwise valid function declarations", () => {
  expect(() => parse(Array.from({ length: 257 }, (_, i) => `F:G$f${i}$0_0$0({2}DF,SV:S),C,0,0,0,0,0`).join("\n"))).toThrow("数量");
});
it("annotates real nested and recursive frames without changing machine history", () => {
  const cpu = new Cpu8051(bytes);
  let nested = false, recursive = false;
  for (let i = 0; i < 1000; i++) {
    cpu.step();
    const state = cpu.state().callStack;
    const names = state.frames.map(frame => nameCallEntry(functions, frame.entryAddress).definition?.name);
    nested ||= names.slice(-2).join(",") === "nested,leaf";
    recursive ||= names.filter(name => name === "recursive").length === 3;
    expect(cpu.state().callStack).toEqual(state);
  }
  expect(nested).toBe(true); expect(recursive).toBe(true);
  cpu.restore(cpu.snapshot());
  expect(cpu.state().callStack).toMatchObject({ frames: [], complete: false });
  for (let i = 0; i < 1000 && !cpu.state().callStack.frames.length; i++) cpu.step();
  expect(cpu.state().callStack.complete).toBe(false);
  expect(cpu.state().callStack.frames.length).toBeGreaterThan(0);
});
it("keeps a real timer vector unnamed across its jump to the C ISR and balanced RETI", () => {
  const cpu = new Cpu8051(bytes);
  for (let i = 0; i < 1000 && cpu.pc !== 0xcb; i++) cpu.step();
  expect(cpu.pc).toBe(0xcb);
  cpu.memory.writeDirect(SFR.IE, 0x82);
  cpu.memory.writeDirect(SFR.TCON, 0x20);
  let seen = false, returned = false;
  for (let i = 0; i < 20; i++) {
    cpu.step(); const frame = cpu.state().callStack.frames.find(item => item.kind === "interrupt");
    if (frame) { seen = true; expect(frame.entryAddress).toBe(0x0b); expect(nameCallEntry(functions, frame.entryAddress).definition).toBeUndefined(); }
    if (seen && !frame) { returned = true; break; }
  }
  expect(seen && returned).toBe(true);
});
