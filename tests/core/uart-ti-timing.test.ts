import { expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { SFR } from "../../src/core/memory";
const cases = [
  { mode:0, smod:0, interruptAt:8, completeAt:8 },
  { mode:1, smod:0, interruptAt:288, completeAt:320 },
  { mode:1, smod:128, interruptAt:144, completeAt:160 },
  { mode:2, smod:0, interruptAt:54, completeAt:59 },
  { mode:2, smod:128, interruptAt:27, completeAt:30 },
  { mode:3, smod:0, interruptAt:320, completeAt:352 },
  { mode:3, smod:128, interruptAt:160, completeAt:176 },
];
const configured = (mode:number,smod:number) => {
  const cpu=new Cpu8051(new Uint8Array());
  for (const [address,value] of [[SFR.PCON,smod],[SFR.TMOD,0x20],[SFR.TH1,255],[SFR.TL1,255],[SFR.TCON,0x40],[SFR.SCON,mode<<6],[SFR.SBUF,0x41]]) cpu.writeMemory("sfr",address!,value!);
  return cpu;
};
const step = (cpu:Cpu8051,count:number) => { for(let i=0;i<count;i++) cpu.step(); };
it.each(cases)("mode $mode SMOD $smod raises TI at cycle $interruptAt, completes output at $completeAt", ({mode,smod,interruptAt,completeAt}) => {
  const cpu=configured(mode,smod);
  step(cpu,interruptAt-1);
  expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(0);
  expect(cpu.drainSerialOutput()).toEqual([]);
  cpu.step();
  expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(2);
  if(mode!==0) {
    expect(cpu.state().peripherals.serial.txBusy).toBe(true);
    expect(cpu.drainSerialOutput()).toEqual([]);
    cpu.memory.writeBit(0x99,false); // software acknowledges TI during stop bit
    step(cpu,completeAt-interruptAt-1);
    expect(cpu.drainSerialOutput()).toEqual([]);
    cpu.step();
    expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(0); // completion must not re-raise TI
  }
  expect(cpu.drainSerialOutput()).toEqual([0x41]);
  expect(cpu.state().peripherals.serial.txBusy).toBe(false);
});

it("preserves acknowledged TI across a stop-bit snapshot and raises once for each queued frame", () => {
  const cpu=configured(1,0); step(cpu,288);
  cpu.memory.writeBit(0x99,false);
  cpu.writeMemory("sfr",SFR.SBUF,0x42);
  const snapshot=cpu.snapshot();
  expect(snapshot.peripherals.serial.txFrame?.tiRaised).toBe(true);
  const restored=new Cpu8051(new Uint8Array()); restored.restore(snapshot);
  step(cpu,32); step(restored,32);
  expect(restored.snapshot()).toEqual(cpu.snapshot());
  expect(restored.memory.readSfrLatch(SFR.SCON)&2).toBe(0);
  expect(restored.drainSerialOutput()).toEqual([0x41]);
  step(restored,287); expect(restored.memory.readSfrLatch(SFR.SCON)&2).toBe(0);
  restored.step(); expect(restored.memory.readSfrLatch(SFR.SCON)&2).toBe(2);
  restored.memory.writeBit(0x99,false); step(restored,32);
  expect(restored.memory.readSfrLatch(SFR.SCON)&2).toBe(0);
  expect(restored.drainSerialOutput()).toEqual([0x42]);
});
it("restores older in-flight frames without a marker and rejects malformed markers atomically", () => {
  const cpu=configured(1,0); step(cpu,287);
  const snapshot=cpu.snapshot(); delete snapshot.peripherals.serial.txFrame!.tiRaised;
  cpu.restore(snapshot); cpu.step(); expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(2);
  const before=cpu.snapshot(); const invalid=cpu.snapshot();
  Object.assign(invalid.peripherals.serial.txFrame!,{tiRaised:"yes"});
  expect(()=>cpu.restore(invalid)).toThrow();
  expect(cpu.snapshot()).toEqual(before);
  cpu.reset(); expect(cpu.snapshot().peripherals.serial.txFrame).toBeNull();
  expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(0);
});
it("an old snapshot already in the stop bit raises the previously deferred TI once on its next tick", () => {
  const cpu=configured(1,0); step(cpu,300);
  const legacy=cpu.snapshot(); delete legacy.peripherals.serial.txFrame!.tiRaised;
  legacy.sfr[SFR.SCON-0x80]! &= ~2;
  cpu.restore(legacy); expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(0);
  cpu.step(); expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(2);
  cpu.memory.writeBit(0x99,false); step(cpu,19);
  expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(0);
  expect(cpu.drainSerialOutput()).toEqual([0x41]);
});
it("TI remains sticky until software clears it, while RI is independent", () => {
  const cpu=configured(1,0); cpu.writeMemory("sfr",SFR.SCON,0x50); cpu.receiveSerial(0x42);
  step(cpu,288); expect(cpu.memory.readSfrLatch(SFR.SCON)&3).toBe(2);
  cpu.memory.writeBit(0x99,false);
  step(cpu,32); expect(cpu.memory.readSfrLatch(SFR.SCON)&3).toBe(1);
  expect(cpu.memory.readDirect(SFR.SBUF)).toBe(0x42);
  cpu.writeMemory("sfr",SFR.SBUF,0x43); step(cpu,288);
  expect(cpu.memory.readSfrLatch(SFR.SCON)&3).toBe(3);
  cpu.memory.writeBit(0x99,false); expect(cpu.memory.readSfrLatch(SFR.SCON)&3).toBe(1);
  cpu.memory.writeBit(0x98,false); expect(cpu.memory.readSfrLatch(SFR.SCON)&3).toBe(0);
});
it("continues to use timer 1 baud in timer 0 split mode without TF1 or TR1", () => {
  const cpu=configured(1,0); cpu.writeMemory("sfr",SFR.TMOD,0x23); cpu.writeMemory("sfr",SFR.TCON,0);
  step(cpu,287); expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(0);
  cpu.step(); expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(2);
  expect(cpu.memory.readSfrLatch(SFR.TCON)&0x80).toBe(0);
});
