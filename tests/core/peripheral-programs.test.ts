import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { assemble } from "../../src/core/assembler";
import { Cpu8051 } from "../../src/core/cpu";
import { SFR } from "../../src/core/memory";
const source=readFileSync("tests/fixtures/peripherals/uart-ti-idle.asm","utf8");
it("runs a standalone timer/UART program through idle wake, ISR acknowledgement and RETI", () => {
  const result=assemble(source); expect(result.diagnostics).toEqual([]);
  const cpu=new Cpu8051(result.bytes!);
  let idle=0,serialEntries=0;
  for(let units=0;units<450;units++) {
    const event=cpu.step();
    if(event.kind==="idle") idle++;
    if(event.kind==="interrupt") {
      expect(event.pcAfter).toBe(0x23); serialEntries++;
      expect(cpu.state().peripherals.powerMode).toBe("running");
      expect(cpu.memory.readSfrLatch(SFR.SCON)&2).toBe(2);
      expect(cpu.state().peripherals.serial.txBusy).toBe(true);
      expect(cpu.drainSerialOutput()).toEqual([]);
    }
  }
  expect(idle).toBeGreaterThan(250);
  expect(serialEntries).toBe(1);
  expect(cpu.memory.iram.slice(0x30,0x33)).toEqual(Uint8Array.from([0x23,1,0x55]));
  expect(cpu.state().peripherals.interrupt.activePriorities).toEqual([]);
  expect(cpu.memory.readSfrLatch(SFR.SCON)&3).toBe(0);
  expect(cpu.drainSerialOutput()).toEqual([0x41]);
});

it.each([0,1])("timer %i retains gate and falling-edge overflow semantics in modes 0/1/2", index => {
  for(const mode of [0,1,2]) {
    const cpu=new Cpu8051(new Uint8Array());
    const low=index===0 ? SFR.TL0 : SFR.TL1, high=index===0 ? SFR.TH0 : SFR.TH1;
    cpu.writeMemory("sfr",SFR.TMOD,(mode|12)<<(4*index));
    cpu.writeMemory("sfr",low,255); cpu.writeMemory("sfr",high,mode===2 ? 0xfc : 255);
    cpu.writeMemory("sfr",SFR.TCON,0x10<<(2*index));
    const gate=4<<index, pin=0x10<<index;
    cpu.setPortInput(3,255&~gate); cpu.step();
    cpu.setPortInput(3,255&~gate&~pin); cpu.step(); // falling while gated off is ignored
    expect(cpu.memory.readSfrLatch(low)).toBe(255);
    cpu.setPortInput(3,255); cpu.step();
    cpu.setPortInput(3,255&~pin); cpu.step();
    expect(cpu.memory.readSfrLatch(low)).toBe(mode===0 ? 0xe0 : mode===1 ? 0 : 0xfc);
    expect(cpu.memory.readSfrLatch(high)).toBe(mode===2 ? 0xfc : 0);
    expect(cpu.memory.readSfrLatch(SFR.TCON)&(0x20<<(2*index))).not.toBe(0);
    cpu.step(); // low level alone never counts again
    expect(cpu.memory.readSfrLatch(low)).toBe(mode===0 ? 0xe0 : mode===1 ? 0 : 0xfc);
  }
});
