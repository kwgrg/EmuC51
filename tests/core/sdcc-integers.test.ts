import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sdccFixture } from "../fixtures/sdcc-fixture";
import { verifySdccDebug } from "../../src/core/sdcc-debug";
import { symbolByteExpressions } from "../../src/core/cdb-symbols";
import { evaluateWatch } from "../../src/core/expressions";
import { Cpu8051 } from "../../src/core/cpu";
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
it("records actual little-endian integer boundary bytes with no observation side effects", async () => {
  const verified = await verifySdccDebug(sdccFixture("integers", "sdcc-integers"));
  const cpu = new Cpu8051(new Uint8Array(verified.firmware));
  for (let i = 0; i < 3000; i++) cpu.step();
  const before = cpu.snapshot();
  const expected: Record<string, number[]> = {
    sc_min: [128], sc_max: [127], sc_negative_one: [255], uc_max: [255], uc_zero: [0],
    si_min: [0,128], si_max: [255,127], si_negative_one: [255,255], ui_max: [255,255], ui_zero: [0,0],
    sl_min: [0,0,0,128], sl_max: [255,255,255,127], sl_negative_one: [255,255,255,255],
    ul_max: [255,255,255,255], ul_zero: [0,0,0,0], code_negative: [1,0,0,128], idata_max: [255],
  };
  for (const [name, bytes] of Object.entries(expected)) {
    const symbol = verified.symbols.find(item => item.name === name)!;
    expect(symbol.unavailable, name).toBeUndefined();
    expect(evaluateWatch(cpu, symbolByteExpressions(symbol)).map(result => result.value), name).toEqual(bytes);
  }
  expect(cpu.snapshot()).toEqual(before);
});
it("proves enum identity is lost in real CDB, so SC alone cannot certify a C char", async () => {
  const verified = await verifySdccDebug(sdccFixture("integers", "sdcc-integers"));
  const lookup = (name: string) => verified.symbols.find(item => item.name === name)!;
  const ordinary = lookup("sc_min"), enumeration = lookup("enum_value");
  expect(enumeration).toMatchObject({ type: "SC:S", size: 1, spaceCode: "E", memorySpace: "iram" });
  expect([ordinary.type, ordinary.size, ordinary.spaceCode]).toEqual([enumeration.type, enumeration.size, enumeration.spaceCode]);
  for (const name of ["boolean_value", "bit_value", "ll_value", "float_value", "pointer_value", "pair_value"]) {
    expect(lookup(name).unavailable, name).toBeTruthy();
    expect(symbolByteExpressions(lookup(name))).toEqual([]);
  }
  expect(lookup("ll_value")).toMatchObject({ type: "SI:S", size: 8 });
  expect(lookup("array_value")).toMatchObject({ type: "DA2d,SC:U", size: 2 });
});
