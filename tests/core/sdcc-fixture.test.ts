import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { parseFirmware } from "../../src/core/firmware";

it("executes a real SDCC 4.5.0 small-model IHX through startup into its C counter loop", () => {
  const hex = readFileSync("tests/fixtures/sdcc-counter/main.ihx", "utf8");
  const program = parseFirmware(new TextEncoder().encode(hex), "main.ihx");
  const cpu = new Cpu8051(program);
  for (let i = 0; i < 1000; i++) cpu.step();
  expect([0xab, 0xad, 0xb0]).toContain(cpu.pc);
  expect(cpu.memory.iram[8]).toBeGreaterThan(0);
  const counter = cpu.memory.iram[8]!;
  expect([counter, (counter - 1) & 0xff]).toContain(cpu.memory.readSfrLatch(0x90));
  for (let i = 0; i < 3; i++) cpu.step();
  expect(cpu.memory.iram[8]).toBe((counter + 1) & 0xff);
  // Genuine compiler records also used by the separate source-debugger regressions.
  const cdb = readFileSync("tests/fixtures/sdcc-counter/main.cdb", "utf8");
  expect(cdb).toContain("L:C$main.c$6$3_0$4:AB");
  expect(cdb).toContain("L:C$main.c$7$3_0$4:AD");
});
