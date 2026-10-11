import { describe, expect, it, vi } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { SFR } from "../../src/core/memory";
import { evaluateExpression as evaluate, evaluateWatch } from "../../src/core/expressions";

describe("read-only watch expressions", () => {
  it.each([
    ["1 + 2 * 3", 7], ["(1 + 2) * 3", 9], ["10-3-2", 5], ["-7/2", -3], ["-7%2", -1],
    ["0xFF & 3 | 8 ^ 2", 11], ["1 << 2 + 1", 8], ["~0", 4294967295],
    ["-1 >> 31", 1], ["1 << 31", 2147483648], ["+0Xff", 255], ["9007199254740991", Number.MAX_SAFE_INTEGER],
  ])("evaluates %s", (source, value) => expect(evaluate(new Cpu8051(new Uint8Array()), source)).toBe(value));

  it("uses the selected register bank and explicit independent address spaces", () => {
    const cpu = new Cpu8051(Uint8Array.of(42));
    cpu.memory.writeDirect(SFR.PSW, 0x18);
    cpu.memory.writeIndirect(24, 19);
    cpu.memory.writeIndirect(0, 3);
    cpu.memory.writeXram(0, 7);
    cpu.memory.writeDirect(SFR.DPH, 0x12);
    cpu.memory.writeDirect(SFR.DPL, 0x34);
    cpu.memory.writeDirect(SFR.ACC, 17);
    expect(evaluateWatch(cpu, ["r0", "IRAM[0]", "XRAM[0]", "CODE[0]", "dptr", "a + ACC", "SFR[0xE0]"]).map(x => x.value)).toEqual([19, 3, 7, 42, 0x1234, 34, 17]);
  });

  it("reads SFR latches without peripheral accesses or changes to machine state", () => {
    const cpu = new Cpu8051(new Uint8Array());
    cpu.setPortInput(1, 0);
    cpu.memory.writeDirect(SFR.SBUF, 42);
    const snapshot = cpu.snapshot();
    const reads = vi.spyOn(cpu.memory.peripheralHooks!, "readSfr");
    expect(evaluate(cpu, "P1")).toBe(255);
    expect(evaluateWatch(cpu, ["SFR[0x90]", "SBUF", "IE", "IP", "DPTR", "R0"]).every(x => x.error === undefined)).toBe(true);
    expect(reads).not.toHaveBeenCalled();
    expect(cpu.snapshot()).toEqual(snapshot);
  });

  it.each(["", "A=1", "alert(1)", "PC.foo", "1 constructor 2", "__proto__", "1 2", "0x", "(1", "IRAM[1", "1/0", "1%0", "1<<32", "1>>-1", "9007199254740992", "9007199254740991+1", "IRAM[128]", "IRAM[-1]", "SFR[127]", "SFR[0x84]", "XRAM[65536]", "CODE[-1]", "DATA[0]", "1".repeat(257), "1+".repeat(64) + "1", "(".repeat(17) + "1" + ")".repeat(17)])("rejects invalid expression %s", source => {
    expect(() => evaluate(new Cpu8051(new Uint8Array()), source)).toThrow();
  });

  it("isolates errors per row", () => {
    expect(evaluateWatch(new Cpu8051(new Uint8Array()), ["PC", "1/0", "SP"])).toEqual([
      { expression: "PC", value: 0 }, { expression: "1/0", error: "不能除以零" }, { expression: "SP", value: 7 },
    ]);
  });
});
