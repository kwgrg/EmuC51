import type { Cpu8051 } from "./cpu";

export const MAX_SCENARIO_BYTES = 128 * 1024;
export const MAX_SCENARIO_EVENTS = 1024;
export const MAX_SCENARIO_CYCLE = 1_000_000_000;
export type InputEvent = { cycle: number; type: "gpio"; port: number; value: number } |
  { cycle: number; type: "uart"; value: number; ninthBit: boolean };
export interface InputScenario {
  format: "emuc51-input-scenario"; version: 1; name: string; firmwareSha256: string; events: InputEvent[];
}
export interface ReplayView { active: boolean; delivered: number[] }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
const keys = (value: Record<string, unknown>, allowed: string[]): boolean => Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const invalid = (): never => { throw new Error("输入场景无效：请检查字段、固件摘要、周期顺序及 1024 个事件上限"); };

export function normalizeInputScenario(value: unknown): InputScenario {
  if (!object(value) || !keys(value,["format","version","name","firmwareSha256","events"]) ||
      value.format !== "emuc51-input-scenario" || value.version !== 1 || typeof value.name !== "string" ||
      !value.name.trim() || value.name.length > 80 || typeof value.firmwareSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.firmwareSha256) || !Array.isArray(value.events) ||
      value.events.length < 1 || value.events.length > MAX_SCENARIO_EVENTS) return invalid();
  let previous = 0;
  const events = Array.from(value.events, (event): InputEvent => {
    if (!object(event) || !integer(event.cycle, MAX_SCENARIO_CYCLE) || event.cycle < previous || !integer(event.value,255)) return invalid();
    previous = event.cycle;
    if (event.type === "gpio" && keys(event,["cycle","type","port","value"]) && integer(event.port,3))
      return { cycle:event.cycle, type:"gpio", port:event.port, value:event.value };
    if (event.type === "uart" && keys(event,["cycle","type","value","ninthBit"]) && typeof event.ninthBit === "boolean")
      return { cycle:event.cycle, type:"uart", value:event.value, ninthBit:event.ninthBit };
    return invalid();
  });
  return { format:"emuc51-input-scenario",version:1,name:value.name,firmwareSha256:value.firmwareSha256,events };
}
export function parseInputScenario(text: string): InputScenario {
  if (typeof text !== "string" || text.length > MAX_SCENARIO_BYTES || new TextEncoder().encode(text).byteLength > MAX_SCENARIO_BYTES)
    throw new Error("输入场景超过 128 KiB 上限");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("输入场景不是有效 JSON"); }
  return normalizeInputScenario(value);
}
/** Instruction-boundary input scheduler; definitions are validated before installation. */
export class InputReplay {
  active = false;
  readonly delivered: number[] = [];
  constructor(readonly scenario: InputScenario) {}
  reset(): void { this.active = false; this.delivered.length = 0; }
  start(): void { this.reset(); this.active = true; }
  view(): ReplayView { return {active:this.active,delivered:[...this.delivered]}; }
  advance(machine: Cpu8051): void {
    if (!this.active) return;
    const cycle = machine.machineCycles;
    while (this.delivered.length < this.scenario.events.length) {
      const event = this.scenario.events[this.delivered.length]!;
      if (event.cycle > cycle) break;
      if (event.type === "gpio") machine.setPortInput(event.port,event.value);
      else machine.receiveSerial(event.value,event.ninthBit);
      // Commit the cursor only after successful injection.
      this.delivered.push(cycle);
    }
  }
}
