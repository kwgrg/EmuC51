import { expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { SFR } from "../../src/core/memory";
import { Debugger8051, normalizeDebugConfig } from "../../src/core/debugger";
import { operandBitLocation } from "../../src/core/operand-access";
const cpu = (...bytes: number[]) => { const result = new Cpu8051(Uint8Array.from(bytes)); result.captureOperandAccesses = true; return result; };
const operations = [0x10,0x20,0x30,0x72,0x82,0x92,0xa0,0xa2,0xb0,0xb2,0xc2,0xd2];
it.each(operations)("records opcode %x bit operand semantics without implicit carry events", opcode => {
  for (const address of [0x00,0x7f,0x90,0xd7]) for (const initial of [false,true]) {
    const machine = cpu(opcode,address,0);
    machine.memory.writeBit(address, initial);
    const beforeCarry = machine.memory.carry;
    machine.step();
    const expected = opcode === 0x92 ? [["write",Number(beforeCarry)]] : opcode === 0xc2 ? [["write",0]] : opcode === 0xd2 ? [["write",1]] : opcode === 0xb2 ? [["read",Number(initial)],["write",Number(!initial)]] : opcode === 0x10 && initial ? [["read",1],["write",0]] : [["read",Number(initial)]];
    expect(machine.operandAccesses.map(event=>[event.kind,event.value]), `${opcode.toString(16)}:${address.toString(16)}:${initial}`).toEqual(expected);
    for (const event of machine.operandAccesses) expect(event).toMatchObject({ space:"bit", address, pc:0, bit:operandBitLocation(address) });
  }
});
it("distinguishes low port pins from latch reads and preserves other latch bits", () => {
  const machine = cpu(0xa2,0x90,0xb2,0x90,0xd2,0x90,0x10,0x90,0,0x10,0x90,0,0xc2,0x91,0x92,0x92);
  machine.setPortInput(1,0);
  machine.step(); expect(machine.operandAccesses).toMatchObject([{kind:"read",value:0,bit:{readSource:"pins"}}]);
  machine.step(); expect(machine.operandAccesses).toMatchObject([{kind:"read",value:1,pc:2,bit:{readSource:"latch"}},{kind:"write",value:0,pc:2}]);
  machine.step(); expect(machine.operandAccesses).toMatchObject([{kind:"write",value:1,pc:4}]);
  machine.step(); expect(machine.operandAccesses).toMatchObject([{kind:"read",value:1,pc:6,bit:{readSource:"latch"}},{kind:"write",value:0,pc:6}]);
  machine.step(); expect(machine.operandAccesses).toHaveLength(1); expect(machine.operandAccesses[0]).toMatchObject({kind:"read",value:0,pc:9});
  machine.step(); expect(machine.memory.readSfrLatch(SFR.P1)).toBe(0xfc);
  machine.step(); expect(machine.memory.readSfrLatch(SFR.P1)).toBe(0xf8);
  expect(machine.operandAccesses).toMatchObject([{kind:"write",value:0,pc:14}]);
});
it("does not short-circuit explicit ANL/ORL reads or report complemented source values", () => {
  for (const opcode of [0x72,0x82,0xa0,0xb0]) for (const carry of [false,true]) {
    const machine = cpu(opcode,0x90); machine.setPortInput(1,0); machine.memory.carry=carry;
    machine.step(); expect(machine.operandAccesses).toMatchObject([{kind:"read",value:0,bit:{readSource:"pins"}}]);
    expect(machine.operandAccesses).toHaveLength(1);
  }
});
it("maps all valid classic bit addresses and rejects undefined SFR and out-of-range input", () => {
  for (let address=0;address<256;address++) {
    const valid = address<128 || [0x80,0x88,0x90,0x98,0xa0,0xa8,0xb0,0xb8,0xd0,0xe0,0xf0].includes(address & 0xf8);
    const normalize = () => normalizeDebugConfig({breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"bit",address,access:"readwrite"}]});
    if (!valid) { expect(normalize).toThrow(); continue; }
    expect(normalize().accessWatchpoints).toHaveLength(1);
    expect(operandBitLocation(address)).toEqual({byteSpace:address<128 ? "data" : "sfr",byteAddress:address<128 ? 0x20+(address>>3) : address&0xf8,index:address&7});
  }
  for(const address of [-1,256,0.5,NaN]) expect(()=>normalizeDebugConfig({breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"bit",address,access:"read"}]})).toThrow();
});
it("keeps byte observations separate and matches same-value bit writes exactly once", () => {
  const machine=cpu(0xc2,0); machine.step();
  const debug=new Debugger8051(); debug.setConfig({breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"data",address:0x20,access:"readwrite"}]});
  expect(debug.accessed(machine.operandAccesses)).toBeUndefined();
  debug.setConfig({breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"bit",address:0,access:"write"},{space:"bit",address:0,access:"readwrite"}]});
  expect(debug.accessed(machine.operandAccesses)?.accesses).toHaveLength(1);
  expect(debug.accessed(machine.operandAccesses)?.accesses?.[0]).toMatchObject({kind:"write",value:0});
});
it("ignores implicit flags, UI bit reads/writes and hardware changes, but observes explicit PSW bit operands", () => {
  const machine=cpu(0x74,1,0x24,255,0xd3,0xb3,0xc3,0xa2,0xd0);
  machine.memory.readBit(0x90); machine.memory.writeBit(0, true); machine.state();
  machine.setPortInput(1,0); expect(machine.operandAccesses).toEqual([]);
  for(let step=0;step<5;step++) { machine.step(); expect(machine.operandAccesses).toEqual([]); }
  machine.step(); expect(machine.operandAccesses).toMatchObject([{space:"bit",address:0xd0,pc:7,kind:"read",bit:{byteSpace:"sfr",byteAddress:0xd0,index:0}}]);
  expect(machine.operandAccesses).toHaveLength(1);
});
it("discards stale bit events on invalid bit faults, breakpoint refusal, reset and restore", () => {
  const machine=cpu(0xd2,0,0xa2,0xc0); machine.step(); expect(machine.operandAccesses).toHaveLength(1);
  expect(machine.step(()=>false)).toBeUndefined(); expect(machine.operandAccesses).toEqual([]);
  expect(()=>machine.step()).toThrow(); expect(machine.pc).toBe(2); expect(machine.operandAccesses).toEqual([]);
  machine.reset(); machine.step(); machine.restore(machine.snapshot()); expect(machine.operandAccesses).toEqual([]);
});
it("observing every bit instruction preserves CPU and peripheral state for all valid addresses", () => {
  for (const opcode of operations) for(let address=0;address<256;address++) {
    try { operandBitLocation(address); } catch { continue; }
    const plain=new Cpu8051(Uint8Array.from([opcode,address,0])), observed=cpu(opcode,address,0);
    for(const machine of [plain,observed]) { machine.memory.iram.fill(0xaa); machine.memory.acc=0x55; machine.setPortInput(1,0x55); }
    expect(observed.step()).toEqual(plain.step());
    expect(Buffer.from(observed.memory.iram).equals(Buffer.from(plain.memory.iram))).toBe(true);
    expect(Buffer.from(observed.memory.sfr).equals(Buffer.from(plain.memory.sfr))).toBe(true);
    expect(observed.peripherals.snapshot()).toEqual(plain.peripherals.snapshot());
  }
});
