import { describe, expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { OPCODE_META } from "../../src/core/opcodes";
import { EmulatorFault } from "../../src/core/types";

describe("8051 操作码表", () => {
  it("覆盖全部 256 个编码且仅 0xA5 非法", () => {
    expect(OPCODE_META).toHaveLength(256);
    expect(OPCODE_META.filter((meta) => meta.legal)).toHaveLength(255);
    expect(OPCODE_META.filter((meta) => !meta.legal).map((meta) => meta.opcode)).toEqual([
      0xa5,
    ]);
    for (const meta of OPCODE_META) {
      expect([1, 2, 3]).toContain(meta.length);
      if (meta.legal) expect(meta.machineCycles).toBeGreaterThan(0);
    }
  });

  it("每个有效编码都能进入已实现语义", () => {
    for (let opcode = 0; opcode <= 0xff; opcode += 1) {
      if (opcode === 0xa5) continue;
      const cpu = new Cpu8051(Uint8Array.from([opcode, 0, 0]));
      try {
        cpu.step();
      } catch (error) {
        if (error instanceof EmulatorFault) {
          expect(error.data.code, `opcode 0x${opcode.toString(16)}`).not.toBe(
            "UNSUPPORTED_OPCODE",
          );
        }
        throw error;
      }
    }
  });

  it("0xA5 返回可诊断非法操作码且不推进 PC", () => {
    const cpu = new Cpu8051(Uint8Array.from([0xa5]));
    expect(() => cpu.step()).toThrowError(EmulatorFault);
    expect(cpu.state().pc).toBe(0);
    expect(cpu.state().steps).toBe(0);
  });
});
