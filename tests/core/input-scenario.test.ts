import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { assemble } from "../../src/core/assembler";
import { InputReplay, MAX_SCENARIO_BYTES, normalizeInputScenario, parseInputScenario } from "../../src/core/input-scenario";
import example from "../../src/examples/scenario-timer-uart.json";
const scenario=()=>normalizeInputScenario(example);

describe("bounded declarative input scenarios",()=>{
  it("accepts stable same-cycle order and clones every event",()=>{
    const input=scenario(); input.events[1]!.cycle=40;
    const parsed=normalizeInputScenario(input);expect(parsed).toEqual(input);expect(parsed.events[0]).not.toBe(input.events[0]);
  });
  it.each([
    null,[],{}, {...example,version:2},{...example,code:"while(true){}"},{...example,name:"x".repeat(81)},
    {...example,firmwareSha256:"0"}, {...example,events:[]}, {...example,events:Array(1025).fill(example.events[0])},
    {...example,events:[{cycle:-1,type:"gpio",port:0,value:0}]},
    {...example,events:[{cycle:1.5,type:"gpio",port:0,value:0}]},
    {...example,events:[{cycle:1e9+1,type:"gpio",port:0,value:0}]},
    {...example,events:[{cycle:"1",type:"gpio",port:0,value:0}]},
    {...example,events:[{cycle:0,type:"gpio",port:4,value:0}]},
    {...example,events:[{cycle:0,type:"gpio",port:0,value:256}]},
    {...example,events:[{cycle:0,type:"uart",value:0,ninthBit:1}]},
    {...example,events:[{cycle:0,type:"uart",value:0}]},
    {...example,events:[{cycle:0,type:"js",value:0}]},
    {...example,events:[{cycle:0,type:"gpio",port:0,value:0,__proto__:null,extra:{repeat:1e12}}]},
    {...example,events:[example.events[1],example.events[0]]},
    {...example,events:Array(1)},
  ])("rejects invalid shape without executing any payload %#",value=>expect(()=>normalizeInputScenario(value)).toThrow());
  it("rejects excessive text before parsing, including UTF-8 expansion",()=>{
    expect(()=>parseInputScenario(" ".repeat(MAX_SCENARIO_BYTES+1))).toThrow("128 KiB");
    expect(()=>parseInputScenario("中".repeat(MAX_SCENARIO_BYTES/2))).toThrow("128 KiB");
    expect(()=>parseInputScenario("while(true){}")).toThrow("JSON");
  });
  it("delivers on next attempted boundary, does not replay a stopped boundary, and cancels pending events",()=>{
    const input=scenario();input.events=[{cycle:1,type:"gpio",port:1,value:0},{cycle:2,type:"gpio",port:1,value:0x80},{cycle:9,type:"gpio",port:1,value:1}];
    const cpu=new Cpu8051(Uint8Array.of(0x80,0xfe)); const replay=new InputReplay(input);
    replay.advance(cpu);expect(replay.delivered).toEqual([]);replay.start();
    replay.advance(cpu);cpu.step();expect(replay.delivered).toEqual([]);
    replay.advance(cpu);expect(replay.delivered).toEqual([2,2]);expect(cpu.snapshot().peripherals.portInputs[1]).toBe(0x80);
    replay.advance(cpu);expect(replay.delivered).toEqual([2,2]);replay.active=false;
    for(let i=0;i<10;i++)cpu.step();replay.advance(cpu);expect(replay.delivered).toEqual([2,2]);
    replay.reset();expect(replay.view()).toEqual({active:false,delivered:[]});
  });
  it("handles maximum same-cycle events with a bounded cursor and keeps logical UART queued",()=>{
    const input=scenario();input.events=Array.from({length:1024},()=>({cycle:0,type:"uart",value:65,ninthBit:false}));
    const cpu=new Cpu8051(Uint8Array.of(0));const replay=new InputReplay(normalizeInputScenario(input));cpu.writeMemory("sfr",0x98,0x10);replay.start();replay.advance(cpu);
    expect(replay.delivered).toHaveLength(1024);expect(cpu.state().peripherals.serial.rxQueued).toBe(1024);
    replay.advance(cpu);expect(cpu.state().peripherals.serial.rxQueued).toBe(1024);
  });
  it("idle reaches digital interrupt input while power-down does not advance future events",()=>{
    const input=scenario();input.events=[{cycle:2,type:"gpio",port:3,value:251}];
    for(const power of [1,2]) {
      const cpu=new Cpu8051(Uint8Array.of(0));cpu.writeMemory("sfr",0xa8,0x81);cpu.writeMemory("sfr",0x88,1);cpu.writeMemory("sfr",0x87,power);
      const replay=new InputReplay(input);replay.start();let interrupt=false;
      for(let i=0;i<5;i++){replay.advance(cpu);if(cpu.step().kind==="interrupt")interrupt=true;}
      expect(interrupt).toBe(power===1);expect(replay.delivered).toEqual(power===1?[2]:[]);
    }
  });
  it("delivery with REN disabled is recorded but does not claim UART acceptance",()=>{
    const input=scenario();input.events=[{cycle:0,type:"uart",value:65,ninthBit:true}];const cpu=new Cpu8051(Uint8Array.of(0));
    const replay=new InputReplay(input);replay.start();replay.advance(cpu);expect(replay.delivered).toEqual([0]);expect(cpu.state().peripherals.serial.rxQueued).toBe(0);
  });
  it("reproduces the real Timer/INT0/UART program from clean memory",()=>{
    const result=assemble(readFileSync("src/examples/scenario-timer-uart.asm","utf8"));expect(result.diagnostics).toEqual([]);
    expect(createHash("sha256").update(result.bytes!).digest("hex")).toBe(example.firmwareSha256);
    const run=()=>{const cpu=new Cpu8051(result.bytes!);const replay=new InputReplay(scenario());replay.start();for(let i=0;i<1500;i++){replay.advance(cpu);cpu.step();}return {snapshot:cpu.snapshot(),log:replay.delivered};};
    const first=run();expect(run()).toEqual(first);
    expect(first.snapshot.iram.slice(0x30,0x34)).toEqual(Uint8Array.from([1,31,0x42,2]));
    expect(first.snapshot.peripherals.serial.txOutput).toEqual([65,66]);
    expect(first.log).toEqual([41,44,80,900]);
  });
});
