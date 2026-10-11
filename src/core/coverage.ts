export interface CoverageSummary {
  enabled: boolean;
  epoch: number;
  uniqueAddresses: number;
  instructions: number;
  saturated: boolean;
}

export interface CoverageEntry { address: number; count: number }

export interface CoverageReport {
  format: "emuc51-instruction-coverage";
  version: 1;
  scope: "successful-instruction-starts";
  firmware: { name: string; sha256: string; byteLength: number };
  capturedAt: string;
  pc: number;
  steps: number;
  summary: CoverageSummary;
  entries: CoverageEntry[];
}

export function coverageHotspots(report: CoverageReport, limit = 20): CoverageEntry[] {
  return [...report.entries].sort((a, b) => b.count - a.count || a.address - b.address).slice(0, limit);
}

/** Session-only instruction-start counters. Allocate storage only after opt-in. */
export class InstructionCoverage {
  enabled = false;
  private counts?: Uint32Array;
  private epoch = 0;
  private uniqueAddresses = 0;
  private instructions = 0;
  private saturated = false;

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.epoch += 1;
    if (enabled) this.counts ??= new Uint32Array(0x10000);
  }

  clear(disable = false): void {
    if (disable) this.enabled = false;
    this.epoch += 1;
    this.counts = this.enabled ? new Uint32Array(0x10000) : undefined;
    this.uniqueAddresses = 0;
    this.instructions = 0;
    this.saturated = false;
  }

  /** Caller invokes only for successfully completed instruction results. */
  record(address: number): void {
    const counts = this.counts!;
    const previous = counts[address]!;
    if (previous === 0) this.uniqueAddresses += 1;
    if (previous < 0xffffffff) counts[address] = previous + 1;
    else this.saturated = true;
    if (this.instructions < Number.MAX_SAFE_INTEGER) this.instructions += 1;
    else this.saturated = true;
  }

  summary(): CoverageSummary {
    return { enabled: this.enabled, epoch: this.epoch, uniqueAddresses: this.uniqueAddresses, instructions: this.instructions, saturated: this.saturated };
  }

  /** Explicit snapshot only; sorted by address, detached from the live counters. */
  entries(): CoverageEntry[] {
    const entries: CoverageEntry[] = [];
    if (this.counts) {
      for (let address = 0; address < this.counts.length; address += 1) {
        const count = this.counts[address]!;
        if (count > 0) entries.push({ address, count });
      }
    }
    return entries;
  }

  read(addresses: number[]): number[] {
    return addresses.map(address => this.counts?.[address] ?? 0);
  }
}
