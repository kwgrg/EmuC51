import { describe, expect, it } from "vitest";
import { InstructionCoverage } from "../../src/core/coverage";

describe("instruction coverage", () => {
  it("starts disabled and counts instruction start addresses without counting operand bytes", () => {
    const coverage = new InstructionCoverage();
    expect(coverage.summary()).toMatchObject({ enabled: false, instructions: 0, uniqueAddresses: 0 });
    coverage.setEnabled(true);
    for (const address of [0, 3, 0, 65535]) coverage.record(address);
    expect(coverage.summary()).toMatchObject({ instructions: 4, uniqueAddresses: 3 });
    expect(coverage.read([0, 1, 2, 3, 65535])).toEqual([2, 0, 0, 1, 1]);
  });
  it("retains data while disabled and gives clears/mode changes distinct epochs", () => {
    const coverage = new InstructionCoverage();
    coverage.setEnabled(true);
    coverage.record(2);
    const epoch = coverage.summary().epoch;
    coverage.setEnabled(false);
    expect(coverage.summary().epoch).toBeGreaterThan(epoch);
    expect(coverage.read([2])).toEqual([1]);
    coverage.setEnabled(true);
    coverage.record(2);
    expect(coverage.read([2])).toEqual([2]);
    coverage.clear();
    expect(coverage.summary()).toMatchObject({ enabled: true, instructions: 0, uniqueAddresses: 0 });
    coverage.record(0);
    coverage.clear(true);
    expect(coverage.summary()).toMatchObject({ enabled: false, instructions: 0, uniqueAddresses: 0 });
    expect(coverage.read([0, 2])).toEqual([0, 0]);
  });
  it("saturates counters rather than wrapping them to zero", () => {
    const coverage = new InstructionCoverage();
    coverage.setEnabled(true);
    // Reach the boundary without executing billions of test instructions.
    const internal = coverage as unknown as { counts: Uint32Array; instructions: number };
    internal.counts[0] = 0xffffffff;
    internal.instructions = Number.MAX_SAFE_INTEGER;
    coverage.record(0);
    expect(coverage.read([0])).toEqual([0xffffffff]);
    expect(coverage.summary()).toMatchObject({ instructions: Number.MAX_SAFE_INTEGER, saturated: true });
  });
});

it("exports detached sparse address-ordered records, including the last CODE address", () => {
  const coverage = new InstructionCoverage();
  expect(coverage.entries()).toEqual([]);
  coverage.setEnabled(true);
  for (const address of [65535, 3, 65535, 0]) coverage.record(address);
  const entries = coverage.entries();
  expect(entries).toEqual([{ address: 0, count: 1 }, { address: 3, count: 1 }, { address: 65535, count: 2 }]);
  coverage.record(3);
  coverage.clear();
  expect(entries[1]?.count).toBe(1);
  expect(coverage.entries()).toEqual([]);
});
