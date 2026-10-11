import { expect, it } from "vitest";
import { Cpu8051 } from "../../src/core/cpu";
import { SFR } from "../../src/core/memory";
import { evaluateExpression } from "../../src/core/expressions";
import { Debugger8051, normalizeDebugConfig } from "../../src/core/debugger";
import type { OperandWatchpoint } from "../../src/core/operand-access";
const cpu = (...bytes: number[]) => { const machine = new Cpu8051(Uint8Array.from(bytes)); machine.captureOperandAccesses = true; return machine; };
it("separates DATA and IDATA access to the same physical byte, including identical writes", () => {
  const machine = cpu(0x75,0x20,0, 0x78,0x20, 0xe6, 0xf6);
  machine.step(); expect(machine.operandAccesses).toEqual([{ space: "data", address: 0x20, kind: "write", value: 0, pc: 0 }]);
  machine.step(); expect(machine.operandAccesses).toEqual([]); // R0 immediate is outside the explicit-memory subset.
  machine.step(); expect(machine.operandAccesses).toEqual([{ space: "idata", address: 0x20, kind: "read", value: 0, pc: 5 }]);
  machine.step(); expect(machine.operandAccesses).toEqual([{ space: "idata", address: 0x20, kind: "write", value: 0, pc: 6 }]);
});
it("preserves multiple accesses and RMW order, including aliased direct source/destination", () => {
  const machine = cpu(0x05,0x20, 0x85,0x20,0x20, 0xd5,0x20,0);
  machine.step(); expect(machine.operandAccesses.map(({ kind, value }) => [kind,value])).toEqual([["read",0],["write",1]]);
  machine.step(); expect(machine.operandAccesses).toEqual([{ space: "data", address: 0x20, kind: "read", value: 1, pc: 2 }, { space: "data", address: 0x20, kind: "write", value: 1, pc: 2 }]);
  machine.step(); expect(machine.operandAccesses.map(({ kind, value }) => [kind,value])).toEqual([["read",1],["write",0]]);
});
it("reports real pin reads versus latch RMW without observing internal peripheral reads", () => {
  const machine = cpu(0xe5,0x90, 0x43,0x90,0, 0x75,0x99,0x41);
  machine.setPortInput(1,0x0f);
  machine.step(); expect(machine.operandAccesses).toEqual([{ space: "sfr", address: 0x90, kind: "read", value: 0x0f, pc: 0 }]);
  machine.step(); expect(machine.operandAccesses.map(({ kind, value }) => [kind,value])).toEqual([["read",255],["write",255]]);
  machine.step(); expect(machine.operandAccesses).toEqual([{ space: "sfr", address: 0x99, kind: "write", value: 0x41, pc: 5 }]);
});
it("tracks MOVX through both DPTR and P2/Ri without conflating the pointer registers", () => {
  const machine = cpu(0xf0,0xe0,0xf2,0xe2);
  machine.memory.dptr=0xffff; machine.memory.acc=0x42;
  machine.memory.writeRegister(0,0x34); machine.memory.writeDirect(SFR.P2,0x12);
  for (const [address,kind] of [[0xffff,"write"],[0xffff,"read"],[0x1234,"write"],[0x1234,"read"]] as const) {
    machine.step(); expect(machine.operandAccesses).toEqual([{ space: "xdata", address, kind, value: 0x42, pc: machine.pc-1 }]);
  }
});
it("keeps byte exchange and PUSH/POP operands but excludes implicit stack traffic", () => {
  const machine = cpu(0xc0,0x20, 0xd0,0x21, 0xc6, 0xd6);
  machine.memory.writeDirect(0x20,0x23); machine.memory.writeRegister(0,0x20); machine.memory.acc=0x91;
  machine.step(); expect(machine.operandAccesses).toEqual([{ space:"data",address:0x20,kind:"read",value:0x23,pc:0 }]);
  machine.step(); expect(machine.operandAccesses).toEqual([{ space:"data",address:0x21,kind:"write",value:0x23,pc:2 }]);
  machine.step(); expect(machine.operandAccesses.map(item=>[item.space,item.kind,item.value])).toEqual([["idata","read",0x23],["idata","write",0x91]]);
  machine.step(); expect(machine.operandAccesses.map(item=>[item.kind,item.value])).toEqual([["read",0x91],["write",0x93]]);
});
it("excludes UI/editor, expression, validation, implicit carry, parity, timers and interrupt entry", () => {
  const machine = cpu(0x00,0xd3,0x74,1);
  machine.memory.writeDirect(SFR.TMOD,1); machine.memory.writeDirect(SFR.TCON,0x10);
  machine.readMemory("sfr",0x80,128); machine.writeMemory("iram",0x20,4); machine.state(); machine.snapshot();
  expect(evaluateExpression(machine,"IRAM[0x20] + ACC")).toBe(4);
  expect(machine.operandAccesses).toEqual([]);
  for (let i=0;i<3;i++) { machine.step(); expect(machine.operandAccesses).toEqual([]); }
  expect(machine.memory.readSfrLatch(SFR.TL0)).toBeGreaterThan(0);
  machine.memory.writeDirect(SFR.IE,0x82); machine.memory.writeDirect(SFR.TCON,0x20);
  machine.step(); expect(machine.step().kind).toBe("interrupt"); expect(machine.operandAccesses).toEqual([]);
});
it("clears observations on idle, breakpoint refusal, fault, reset and restore", () => {
  const machine = cpu(0xe5,0x20,0xa5);
  machine.step(); expect(machine.operandAccesses).toHaveLength(1);
  expect(machine.step(()=>false)).toBeUndefined(); expect(machine.operandAccesses).toEqual([]);
  expect(()=>machine.step()).toThrow(); expect(machine.operandAccesses).toEqual([]);
  machine.reset(); machine.step(); const snapshot=machine.snapshot(); machine.restore(snapshot); expect(machine.operandAccesses).toEqual([]);
  machine.memory.writeDirect(SFR.PCON,1); expect(machine.step().kind).toBe("idle"); expect(machine.operandAccesses).toEqual([]);
  machine.reset(); expect(machine.operandAccesses).toEqual([]);
});
it("instrumentation preserves all 255 legal instruction states and uses at most two explicit byte events", () => {
  for (let opcode=0;opcode<256;opcode++) {
    if(opcode===0xa5) continue;
    const plain=new Cpu8051(Uint8Array.from([opcode,0x20,0x20])), observed=cpu(opcode,0x20,0x20);
    for(const machine of [plain,observed]) { machine.memory.acc=0x31; machine.memory.writeRegister(0,0x20); machine.memory.writeRegister(1,0x21); machine.memory.writeDirect(0x20,0x12); }
    expect(observed.step(), `opcode ${opcode.toString(16)}`).toEqual(plain.step());
    for (const space of ["iram", "sfr", "xram"] as const) expect(Buffer.from(observed.memory[space]).equals(Buffer.from(plain.memory[space]))).toBe(true);
    expect(observed.peripherals.snapshot()).toEqual(plain.peripherals.snapshot()); expect(observed.operandAccesses.length).toBeLessThanOrEqual(2); expect(plain.operandAccesses).toEqual([]);
  }
});
it("matches types/spaces once per real event even when configurations overlap", () => {
  const debug=new Debugger8051();
  debug.setConfig({breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"data",address:0x20,access:"readwrite"},{space:"data",address:0x20,access:"read"},{space:"idata",address:0x21,access:"write"}]});
  const machine=cpu(0x05,0x20);machine.step();
  expect(debug.accessed(machine.operandAccesses)).toMatchObject({reason:"OperandWatchpoint",accesses:machine.operandAccesses});
  debug.setConfig({breakpoints:[],watchpoints:[],accessWatchpoints:[{space:"idata",address:0x20,access:"readwrite"}]});
  expect(debug.accessed(machine.operandAccesses)).toBeUndefined();
});
it.each([
  {space:"data",address:0x80,access:"read"},{space:"idata",address:0x80,access:"write"},{space:"sfr",address:0x84,access:"read"},
  {space:"xdata",address:0x10000,access:"write"},{space:"code",address:0,access:"read"},{space:"data",address:0,access:"execute"},
])("rejects unsupported operand watches %j", point=>expect(()=>normalizeDebugConfig({breakpoints:[],watchpoints:[],accessWatchpoints:[point as OperandWatchpoint]})).toThrow());
