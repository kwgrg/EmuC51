import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sdccFixture } from "../fixtures/sdcc-fixture";
import { verifySdccDebug } from "../../src/core/sdcc-debug";
import { symbolByteExpressions, parseCdbSymbols } from "../../src/core/cdb-symbols";
import { cdbIntegerEncoding, decodeCdbInteger } from "../../src/core/cdb-integers";
import { evaluateWatch } from "../../src/core/expressions";
import { Cpu8051 } from "../../src/core/cpu";
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());
it("interprets real integer storage boundaries, including enum storage, without claiming source types", async () => {
  const verified = await verifySdccDebug(sdccFixture("integers", "sdcc-integers"));
  const cpu = new Cpu8051(new Uint8Array(verified.firmware));
  for (let i = 0; i < 3000; i++) cpu.step();
  const before = cpu.snapshot();
  const expected: Record<string, number> = {
    sc_min: -128, sc_max: 127, sc_negative_one: -1, uc_max: 255, uc_zero: 0,
    si_min: -32768, si_max: 32767, si_negative_one: -1, ui_max: 65535, ui_zero: 0,
    sl_min: -2147483648, sl_max: 2147483647, sl_negative_one: -1, ul_max: 4294967295, ul_zero: 0,
    code_negative: -2147483647, idata_max: 255, enum_value: -1,
  };
  for (const [name, value] of Object.entries(expected)) {
    const symbol = verified.symbols.find(item => item.name === name)!;
    const sample = evaluateWatch(cpu, symbolByteExpressions(symbol));
    expect(decodeCdbInteger(symbol, sample), name).toBe(value);
  }
  for (const name of ["boolean_value", "bit_value", "ll_value", "float_value", "pointer_value", "pair_value", "array_value"]) {
    const symbol = verified.symbols.find(item => item.name === name)!;
    expect(cdbIntegerEncoding(symbol), name).toBeUndefined();
    expect(decodeCdbInteger(symbol, evaluateWatch(cpu, symbolByteExpressions(symbol))), name).toBeUndefined();
  }
  expect(cpu.snapshot()).toEqual(before);
});
const scalar = parseCdbSymbols("S:G$value$0_0$0({2}SI:U),E,0,0\nL:G$value$0_0$0:8", "sample", 256)[0]!;
const valid = [{ expression: "IRAM[8]", value: 255 }, { expression: "IRAM[9]", value: 255 }];
it.each([
  [], valid.slice(0, 1), [...valid, valid[0]!], [...valid].reverse(),
  [{ ...valid[0]!, value: -1 }, valid[1]!], [{ ...valid[0]!, value: 256 }, valid[1]!],
  [{ ...valid[0]!, value: 1.5 }, valid[1]!], [{ ...valid[0]!, value: NaN }, valid[1]!],
  [{ expression: "IRAM[8]" }, valid[1]!], [{ ...valid[0]!, error: "failed" }, valid[1]!],
].map(sample => ({ sample })))("never decodes incomplete, stale-address, out-of-range or error samples %#", ({ sample }) => {
  expect(decodeCdbInteger(scalar, sample)).toBeUndefined();
});
it("does not reinterpret unavailable locations or a size/type mismatch", () => {
  expect(decodeCdbInteger(scalar, valid)).toBe(65535);
  for (const change of [{ size: 8 }, { type: "DG,SI:U" }, { unavailable: "unknown location" }, { memorySpace: undefined }]) {
    expect(cdbIntegerEncoding({ ...scalar, ...change })).toBeUndefined();
  }
});
