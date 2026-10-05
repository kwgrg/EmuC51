import { Memory8051, SFR } from "./memory";
import { opcodeMeta } from "./opcodes";
import { Peripherals8051, validatePeripheralSnapshot } from "./peripherals";
import { sign8, u8, u16 } from "./numbers";
import {
  EmulatorFault,
  type CpuSnapshot,
  type CpuSnapshotV2,
  type CpuViewState,
  type MemorySpace,
  type RunChunkResult,
  type StepResult,
} from "./types";

const now = (): number =>
  typeof performance === "undefined" ? Date.now() : performance.now();

export class Cpu8051 {
  readonly memory: Memory8051;
  readonly peripherals: Peripherals8051;
  private pcValue = 0;
  private stepCount = 0;
  private cycleCount = 0;

  constructor(program: Uint8Array) {
    this.memory = new Memory8051(program);
    this.peripherals = new Peripherals8051(this.memory);
  }

  get pc(): number {
    return this.pcValue;
  }

  reset(): void {
    this.pcValue = 0;
    this.stepCount = 0;
    this.cycleCount = 0;
    this.memory.resetSfr();
    this.peripherals.reset();
  }

  state(includeSerialOutput = true): CpuViewState {
    return {
      pc: this.pcValue,
      acc: this.memory.acc,
      b: this.memory.b,
      psw: this.memory.psw,
      sp: this.memory.sp,
      dptr: this.memory.dptr,
      registers: Array.from({ length: 8 }, (_, index) =>
        this.memory.readRegister(index),
      ),
      steps: this.stepCount,
      machineCycles: this.cycleCount,
      peripherals: this.peripherals.state(includeSerialOutput),
    };
  }

  snapshot(): CpuSnapshotV2 {
    return { ...this.memory.snapshot(this.pcValue, this.stepCount, this.cycleCount), coreStateVersion: 2, peripherals: this.peripherals.snapshot() };
  }

  restore(snapshot: CpuSnapshot): void {
    if (
      !snapshot || !Number.isInteger(snapshot.pc) || snapshot.pc < 0 || snapshot.pc > 0xffff ||
      !Number.isSafeInteger(snapshot.steps) ||
      snapshot.steps < 0 ||
      !Number.isSafeInteger(snapshot.machineCycles) ||
      snapshot.machineCycles < 0 ||
      (snapshot.coreStateVersion === 2 && !validatePeripheralSnapshot(snapshot.peripherals))
    ) {
      throw new EmulatorFault({
        code: "INVALID_SNAPSHOT",
        message: "CPU 快照计数器无效",
      });
    }
    this.memory.validateSnapshot(snapshot);
    if (snapshot.coreStateVersion === 2 && [SFR.P0, SFR.P1, SFR.P2, SFR.P3].some((address, port) => snapshot.peripherals.lastPins[port] !== ((snapshot.sfr[address - 0x80] ?? 0) & snapshot.peripherals.portInputs[port]!))) {
      throw new EmulatorFault({ code: "INVALID_SNAPSHOT", message: "CPU 快照 GPIO 引脚状态不一致" });
    }
    this.memory.restore(snapshot);
    if (snapshot.coreStateVersion === 2) this.peripherals.restore(snapshot.peripherals);
    else this.peripherals.reset();
    this.pcValue = u16(snapshot.pc);
    this.stepCount = snapshot.steps;
    this.cycleCount = snapshot.machineCycles;
  }

  readMemory(space: MemorySpace, address: number, length: number): Uint8Array {
    return this.memory.readMemory(space, address, length);
  }

  writeMemory(space: MemorySpace, address: number, value: number): void {
    const maximum = space === "iram" ? 0x7f : space === "sfr" ? 0xff : 0xffff;
    const minimum = space === "sfr" ? 0x80 : 0;
    if (space === "code" || !["iram", "sfr", "xram"].includes(space) || !Number.isInteger(address) || address < minimum || address > maximum || !Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new EmulatorFault({ code: "INVALID_INPUT", address, message: "内存编辑地址或字节无效（CODE 只读）" });
    }
    if (space === "xram") this.memory.writeXram(address, value);
    else if (space === "iram") this.memory.writeIndirect(address, value);
    else this.memory.writeDirect(address, value);
    if (space === "sfr" && (address === SFR.ACC || address === SFR.PSW)) this.memory.updateParity();
  }

  setRegister(name: string, value: number): void {
    const register = typeof name === "string" ? name.toUpperCase() : "";
    const maximum = register === "PC" || register === "DPTR" ? 0xffff : 0xff;
    if (!Number.isInteger(value) || value < 0 || value > maximum) throw new EmulatorFault({ code: "INVALID_REGISTER", message: `寄存器 ${register} 的值无效` });
    if (register === "PC") this.pcValue = value;
    else if (register === "DPTR") this.memory.dptr = value;
    else if (/^R[0-7]$/.test(register)) this.memory.writeRegister(Number(register[1]), value);
    else {
      const address = ({ A: SFR.ACC, ACC: SFR.ACC, B: SFR.B, PSW: SFR.PSW, SP: SFR.SP } as Record<string, number>)[register];
      if (address === undefined) throw new EmulatorFault({ code: "INVALID_REGISTER", message: `寄存器名称无效：${register}` });
      this.writeMemory("sfr", address, value);
    }
  }

  setPortInput(port: number, value: number): void { this.peripherals.setPortInput(port, value); }
  receiveSerial(value: number, ninthBit = true): void { this.peripherals.receiveSerial(value, ninthBit); }
  drainSerialOutput(): number[] { return this.peripherals.drainSerialOutput(); }

  step(): StepResult {
    const pcBefore = this.pcValue;
    const interrupt = this.peripherals.nextInterrupt();
    if (interrupt) {
      this.pushReturnAddress(pcBefore);
      this.pcValue = interrupt.vector;
      this.peripherals.enterInterrupt(interrupt.source, interrupt.priority);
      this.peripherals.advance(2);
      this.cycleCount += 2;
      return { kind: "interrupt", pcBefore, pcAfter: this.pcValue, bytes: [0, 0, 0], length: 1, mnemonic: `INT ${interrupt.source}`, machineCycles: 2, state: this.state(false) };
    }
    const powerMode = this.peripherals.powerMode;
    if (powerMode !== "running") {
      const cycles = powerMode === "idle" ? 1 : 0;
      if (cycles > 0) this.peripherals.beginInstruction();
      this.peripherals.advance(cycles);
      this.cycleCount += cycles;
      return { kind: powerMode, pcBefore, pcAfter: pcBefore, bytes: [0, 0, 0], length: 1, mnemonic: powerMode === "idle" ? "IDLE" : "POWER DOWN", machineCycles: cycles, state: this.state(false) };
    }
    const opcode = this.memory.readCode(pcBefore);
    const meta = opcodeMeta(opcode);
    if (!meta.legal) {
      throw new EmulatorFault({
        code: "ILLEGAL_OPCODE",
        pc: pcBefore,
        opcode,
        message: `PC=0x${pcBefore.toString(16).padStart(4, "0")} 遇到保留操作码 0x${opcode.toString(16).padStart(2, "0")}`,
      });
    }

    const bytes: [number, number, number] = [
      opcode,
      meta.length >= 2 ? this.memory.readCode(pcBefore + 1) : 0,
      meta.length >= 3 ? this.memory.readCode(pcBefore + 2) : 0,
    ];
    const postPc = u16(pcBefore + meta.length);

    try {
      this.validateOperands(opcode, bytes[1], bytes[2]);
      this.peripherals.beginInstruction();
      this.pcValue = postPc;
      this.execute(opcode, bytes[1], bytes[2], postPc);
      this.memory.updateParity();
    } catch (error) {
      this.pcValue = pcBefore;
      if (error instanceof EmulatorFault) {
        throw new EmulatorFault({
          ...error.data,
          pc: pcBefore,
          opcode,
        });
      }
      throw error;
    }

    this.stepCount += 1;
    this.cycleCount += meta.machineCycles;
    this.peripherals.advance(meta.machineCycles);
    return {
      kind: "instruction",
      pcBefore,
      pcAfter: this.pcValue,
      bytes,
      length: meta.length,
      mnemonic: meta.mnemonic,
      machineCycles: meta.machineCycles,
      state: this.state(false),
    };
  }

  private validateOperands(opcode: number, operand1: number, operand2: number): void {
    if (opcode === 0x12 || (opcode & 0x1f) === 0x11) {
      this.memory.assertIndirect(u8(this.memory.sp + 1));
      this.memory.assertIndirect(u8(this.memory.sp + 2));
    }
    if (opcode === 0xc0) this.memory.assertIndirect(u8(this.memory.sp + 1));
    if (opcode === 0xd0 || opcode === 0x22 || opcode === 0x32) this.memory.assertIndirect(this.memory.sp);
    if (opcode === 0x22 || opcode === 0x32) this.memory.assertIndirect(u8(this.memory.sp - 1));
    if ([0x05, 0x15, 0x25, 0x35, 0x42, 0x43, 0x45, 0x52, 0x53, 0x55, 0x62, 0x63, 0x65, 0x75, 0x85, 0x86, 0x87, 0x95, 0xa6, 0xa7, 0xb5, 0xc0, 0xc5, 0xd0, 0xd5, 0xe5, 0xf5].includes(opcode) || (opcode >= 0x88 && opcode <= 0x8f) || (opcode >= 0xa8 && opcode <= 0xaf)) this.memory.assertDirect(operand1);
    if (opcode === 0x85) this.memory.assertDirect(operand2);
    if ([0x05, 0x15, 0x42, 0x43, 0x52, 0x53, 0x62, 0x63, 0x75, 0x86, 0x87, 0xc5, 0xd0, 0xd5, 0xf5].includes(opcode) || (opcode >= 0x88 && opcode <= 0x8f)) this.memory.assertWriteDirect(operand1);
    if (opcode === 0x85) this.memory.assertWriteDirect(operand2);
    if ([0x10, 0x20, 0x30, 0x72, 0x82, 0x92, 0xa0, 0xa2, 0xb0, 0xb2, 0xc2, 0xd2].includes(opcode)) this.memory.resolveBit(operand1);
    if ([0x06, 0x07, 0x16, 0x17, 0x26, 0x27, 0x36, 0x37, 0x46, 0x47, 0x56, 0x57, 0x66, 0x67, 0x76, 0x77, 0x86, 0x87, 0x96, 0x97, 0xa6, 0xa7, 0xb6, 0xb7, 0xc6, 0xc7, 0xd6, 0xd7, 0xe6, 0xe7, 0xf6, 0xf7].includes(opcode)) this.memory.assertIndirect(this.memory.readRegister(opcode & 1));
  }

  runChunk(
    maxSteps: number,
    timeBudgetMs: number,
    traceEnabled = false,
  ): RunChunkResult {
    const limit = Math.max(0, Math.trunc(maxSteps));
    const startedAt = now();
    const trace: StepResult[] = [];
    let executed = 0;
    let timeBudgetReached = false;

    while (executed < limit) {
      const result = this.step();
      executed += 1;
      if (traceEnabled) {
        trace.push(result);
        if (trace.length > 1000) trace.shift();
      }
      if (now() - startedAt >= timeBudgetMs) {
        timeBudgetReached = true;
        break;
      }
    }

    return { stepsExecuted: executed, timeBudgetReached, trace };
  }

  private execute(opcode: number, operand1: number, operand2: number, postPc: number): void {
    if ((opcode & 0x1f) === 0x01) {
      this.pcValue =
        (postPc & 0xf800) | ((opcode & 0xe0) << 3) | operand1;
      return;
    }
    if ((opcode & 0x1f) === 0x11) {
      this.pushReturnAddress(postPc);
      this.pcValue =
        (postPc & 0xf800) | ((opcode & 0xe0) << 3) | operand1;
      return;
    }

    if (opcode >= 0x08 && opcode <= 0x0f) {
      const register = opcode & 7;
      this.memory.writeRegister(register, this.memory.readRegister(register) + 1);
      return;
    }
    if (opcode >= 0x18 && opcode <= 0x1f) {
      const register = opcode & 7;
      this.memory.writeRegister(register, this.memory.readRegister(register) - 1);
      return;
    }
    if (opcode >= 0x28 && opcode <= 0x2f) {
      this.add(this.memory.readRegister(opcode & 7), false);
      return;
    }
    if (opcode >= 0x38 && opcode <= 0x3f) {
      this.add(this.memory.readRegister(opcode & 7), true);
      return;
    }
    if (opcode >= 0x48 && opcode <= 0x4f) {
      this.memory.acc |= this.memory.readRegister(opcode & 7);
      return;
    }
    if (opcode >= 0x58 && opcode <= 0x5f) {
      this.memory.acc &= this.memory.readRegister(opcode & 7);
      return;
    }
    if (opcode >= 0x68 && opcode <= 0x6f) {
      this.memory.acc ^= this.memory.readRegister(opcode & 7);
      return;
    }
    if (opcode >= 0x78 && opcode <= 0x7f) {
      this.memory.writeRegister(opcode & 7, operand1);
      return;
    }
    if (opcode >= 0x88 && opcode <= 0x8f) {
      this.memory.writeDirect(operand1, this.memory.readRegister(opcode & 7));
      return;
    }
    if (opcode >= 0x98 && opcode <= 0x9f) {
      this.subtract(this.memory.readRegister(opcode & 7));
      return;
    }
    if (opcode >= 0xa8 && opcode <= 0xaf) {
      this.memory.writeRegister(opcode & 7, this.memory.readDirect(operand1));
      return;
    }
    if (opcode >= 0xb8 && opcode <= 0xbf) {
      this.compareAndJump(this.memory.readRegister(opcode & 7), operand1, operand2, postPc);
      return;
    }
    if (opcode >= 0xc8 && opcode <= 0xcf) {
      const register = opcode & 7;
      const value = this.memory.readRegister(register);
      this.memory.writeRegister(register, this.memory.acc);
      this.memory.acc = value;
      return;
    }
    if (opcode >= 0xd8 && opcode <= 0xdf) {
      const register = opcode & 7;
      const value = u8(this.memory.readRegister(register) - 1);
      this.memory.writeRegister(register, value);
      if (value !== 0) this.branch(postPc, operand1);
      return;
    }
    if (opcode >= 0xe8 && opcode <= 0xef) {
      this.memory.acc = this.memory.readRegister(opcode & 7);
      return;
    }
    if (opcode >= 0xf8 && opcode <= 0xff) {
      this.memory.writeRegister(opcode & 7, this.memory.acc);
      return;
    }

    switch (opcode) {
      case 0x00:
        return;
      case 0x02:
        this.pcValue = (operand1 << 8) | operand2;
        return;
      case 0x03:
        this.memory.acc = (this.memory.acc >>> 1) | ((this.memory.acc & 1) << 7);
        return;
      case 0x04:
        this.memory.acc += 1;
        return;
      case 0x05:
        this.memory.writeDirect(operand1, this.memory.readRmwDirect(operand1) + 1);
        return;
      case 0x06:
      case 0x07: {
        const address = this.memory.readRegister(opcode & 1);
        this.memory.writeIndirect(address, this.memory.readIndirect(address) + 1);
        return;
      }
      case 0x10:
        if (this.memory.readBit(operand1, true)) {
          this.memory.writeBit(operand1, false);
          this.branch(postPc, operand2);
        }
        return;
      case 0x12:
        this.pushReturnAddress(postPc);
        this.pcValue = (operand1 << 8) | operand2;
        return;
      case 0x13: {
        const carry = this.memory.carry;
        const nextCarry = (this.memory.acc & 1) !== 0;
        this.memory.acc = (this.memory.acc >>> 1) | (carry ? 0x80 : 0);
        this.memory.carry = nextCarry;
        return;
      }
      case 0x14:
        this.memory.acc -= 1;
        return;
      case 0x15:
        this.memory.writeDirect(operand1, this.memory.readRmwDirect(operand1) - 1);
        return;
      case 0x16:
      case 0x17: {
        const address = this.memory.readRegister(opcode & 1);
        this.memory.writeIndirect(address, this.memory.readIndirect(address) - 1);
        return;
      }
      case 0x20:
        if (this.memory.readBit(operand1)) this.branch(postPc, operand2);
        return;
      case 0x22:
        this.returnFromCall();
        return;
      case 0x32:
        this.returnFromCall();
        this.peripherals.returnFromInterrupt();
        return;
      case 0x23:
        this.memory.acc = (this.memory.acc << 1) | (this.memory.acc >>> 7);
        return;
      case 0x24:
        this.add(operand1, false);
        return;
      case 0x25:
        this.add(this.memory.readDirect(operand1), false);
        return;
      case 0x26:
      case 0x27:
        this.add(this.readAtRegister(opcode & 1), false);
        return;
      case 0x30:
        if (!this.memory.readBit(operand1)) this.branch(postPc, operand2);
        return;
      case 0x33: {
        const carry = this.memory.carry;
        const nextCarry = (this.memory.acc & 0x80) !== 0;
        this.memory.acc = (this.memory.acc << 1) | (carry ? 1 : 0);
        this.memory.carry = nextCarry;
        return;
      }
      case 0x34:
        this.add(operand1, true);
        return;
      case 0x35:
        this.add(this.memory.readDirect(operand1), true);
        return;
      case 0x36:
      case 0x37:
        this.add(this.readAtRegister(opcode & 1), true);
        return;
      case 0x40:
        if (this.memory.carry) this.branch(postPc, operand1);
        return;
      case 0x42:
        this.memory.writeDirect(operand1, this.memory.readRmwDirect(operand1) | this.memory.acc);
        return;
      case 0x43:
        this.memory.writeDirect(operand1, this.memory.readRmwDirect(operand1) | operand2);
        return;
      case 0x44:
        this.memory.acc |= operand1;
        return;
      case 0x45:
        this.memory.acc |= this.memory.readDirect(operand1);
        return;
      case 0x46:
      case 0x47:
        this.memory.acc |= this.readAtRegister(opcode & 1);
        return;
      case 0x50:
        if (!this.memory.carry) this.branch(postPc, operand1);
        return;
      case 0x52:
        this.memory.writeDirect(operand1, this.memory.readRmwDirect(operand1) & this.memory.acc);
        return;
      case 0x53:
        this.memory.writeDirect(operand1, this.memory.readRmwDirect(operand1) & operand2);
        return;
      case 0x54:
        this.memory.acc &= operand1;
        return;
      case 0x55:
        this.memory.acc &= this.memory.readDirect(operand1);
        return;
      case 0x56:
      case 0x57:
        this.memory.acc &= this.readAtRegister(opcode & 1);
        return;
      case 0x60:
        if (this.memory.acc === 0) this.branch(postPc, operand1);
        return;
      case 0x62:
        this.memory.writeDirect(operand1, this.memory.readRmwDirect(operand1) ^ this.memory.acc);
        return;
      case 0x63:
        this.memory.writeDirect(operand1, this.memory.readRmwDirect(operand1) ^ operand2);
        return;
      case 0x64:
        this.memory.acc ^= operand1;
        return;
      case 0x65:
        this.memory.acc ^= this.memory.readDirect(operand1);
        return;
      case 0x66:
      case 0x67:
        this.memory.acc ^= this.readAtRegister(opcode & 1);
        return;
      case 0x70:
        if (this.memory.acc !== 0) this.branch(postPc, operand1);
        return;
      case 0x72: {
        const bit = this.memory.readBit(operand1);
        this.memory.carry = this.memory.carry || bit;
        return;
      }
      case 0x73:
        this.pcValue = u16(this.memory.dptr + this.memory.acc);
        return;
      case 0x74:
        this.memory.acc = operand1;
        return;
      case 0x75:
        this.memory.writeDirect(operand1, operand2);
        return;
      case 0x76:
      case 0x77:
        this.memory.writeIndirect(this.memory.readRegister(opcode & 1), operand1);
        return;
      case 0x80:
        this.branch(postPc, operand1);
        return;
      case 0x82: {
        const bit = this.memory.readBit(operand1);
        this.memory.carry = this.memory.carry && bit;
        return;
      }
      case 0x83:
        this.memory.acc = this.memory.readCode(postPc + this.memory.acc);
        return;
      case 0x84:
        this.divide();
        return;
      case 0x85: {
        const value = this.memory.readDirect(operand1);
        this.memory.writeDirect(operand2, value);
        return;
      }
      case 0x86:
      case 0x87:
        this.memory.writeDirect(operand1, this.readAtRegister(opcode & 1));
        return;
      case 0x90:
        this.memory.dptr = (operand1 << 8) | operand2;
        return;
      case 0x92:
        this.memory.writeBit(operand1, this.memory.carry);
        return;
      case 0x93:
        this.memory.acc = this.memory.readCode(this.memory.dptr + this.memory.acc);
        return;
      case 0x94:
        this.subtract(operand1);
        return;
      case 0x95:
        this.subtract(this.memory.readDirect(operand1));
        return;
      case 0x96:
      case 0x97:
        this.subtract(this.readAtRegister(opcode & 1));
        return;
      case 0xa0: {
        const bit = this.memory.readBit(operand1);
        this.memory.carry = this.memory.carry || !bit;
        return;
      }
      case 0xa2:
        this.memory.carry = this.memory.readBit(operand1);
        return;
      case 0xa3:
        this.memory.dptr += 1;
        return;
      case 0xa4:
        this.multiply();
        return;
      case 0xa6:
      case 0xa7:
        this.memory.writeIndirect(
          this.memory.readRegister(opcode & 1),
          this.memory.readDirect(operand1),
        );
        return;
      case 0xb0: {
        const bit = this.memory.readBit(operand1);
        this.memory.carry = this.memory.carry && !bit;
        return;
      }
      case 0xb2:
        this.memory.writeBit(operand1, !this.memory.readBit(operand1, true));
        return;
      case 0xb3:
        this.memory.carry = !this.memory.carry;
        return;
      case 0xb4:
        this.compareAndJump(this.memory.acc, operand1, operand2, postPc);
        return;
      case 0xb5:
        this.compareAndJump(this.memory.acc, this.memory.readDirect(operand1), operand2, postPc);
        return;
      case 0xb6:
      case 0xb7:
        this.compareAndJump(this.readAtRegister(opcode & 1), operand1, operand2, postPc);
        return;
      case 0xc0:
        this.pushDirect(operand1);
        return;
      case 0xc2:
        this.memory.writeBit(operand1, false);
        return;
      case 0xc3:
        this.memory.carry = false;
        return;
      case 0xc4:
        this.memory.acc = (this.memory.acc << 4) | (this.memory.acc >>> 4);
        return;
      case 0xc5: {
        const value = this.memory.readDirect(operand1);
        this.memory.writeDirect(operand1, this.memory.acc);
        this.memory.acc = value;
        return;
      }
      case 0xc6:
      case 0xc7:
        this.exchangeIndirect(opcode & 1, false);
        return;
      case 0xd0:
        this.popDirect(operand1);
        return;
      case 0xd2:
        this.memory.writeBit(operand1, true);
        return;
      case 0xd3:
        this.memory.carry = true;
        return;
      case 0xd4:
        this.decimalAdjust();
        return;
      case 0xd5: {
        const value = u8(this.memory.readRmwDirect(operand1) - 1);
        this.memory.writeDirect(operand1, value);
        if (value !== 0) this.branch(postPc, operand2);
        return;
      }
      case 0xd6:
      case 0xd7:
        this.exchangeIndirect(opcode & 1, true);
        return;
      case 0xe0:
        this.memory.acc = this.memory.readXram(this.memory.dptr);
        return;
      case 0xe2:
      case 0xe3:
        this.memory.acc = this.memory.readXram(this.xramRegisterAddress(opcode & 1));
        return;
      case 0xe4:
        this.memory.acc = 0;
        return;
      case 0xe5:
        this.memory.acc = this.memory.readDirect(operand1);
        return;
      case 0xe6:
      case 0xe7:
        this.memory.acc = this.readAtRegister(opcode & 1);
        return;
      case 0xf0:
        this.memory.writeXram(this.memory.dptr, this.memory.acc);
        return;
      case 0xf2:
      case 0xf3:
        this.memory.writeXram(this.xramRegisterAddress(opcode & 1), this.memory.acc);
        return;
      case 0xf4:
        this.memory.acc = ~this.memory.acc;
        return;
      case 0xf5:
        this.memory.writeDirect(operand1, this.memory.acc);
        return;
      case 0xf6:
      case 0xf7:
        this.memory.writeIndirect(this.memory.readRegister(opcode & 1), this.memory.acc);
        return;
      default:
        throw new EmulatorFault({
          code: "UNSUPPORTED_OPCODE",
          opcode,
          message: `尚未实现操作码 0x${opcode.toString(16).padStart(2, "0")}`,
        });
    }
  }

  private branch(postPc: number, relative: number): void {
    this.pcValue = u16(postPc + sign8(relative));
  }

  private readAtRegister(index: number): number {
    return this.memory.readIndirect(this.memory.readRegister(index));
  }

  private add(value: number, includeCarry: boolean): void {
    const accumulator = this.memory.acc;
    const addend = u8(value);
    const carry = includeCarry && this.memory.carry ? 1 : 0;
    const sum = accumulator + addend + carry;
    const result = u8(sum);
    this.memory.carry = sum > 0xff;
    this.memory.setAuxCarry((accumulator & 0x0f) + (addend & 0x0f) + carry > 0x0f);
    this.memory.setOverflow(((~(accumulator ^ addend) & (accumulator ^ result)) & 0x80) !== 0);
    this.memory.acc = result;
  }

  private subtract(value: number): void {
    const accumulator = this.memory.acc;
    const subtrahend = u8(value);
    const borrow = this.memory.carry ? 1 : 0;
    const difference = accumulator - subtrahend - borrow;
    const signedDifference =
      (accumulator < 0x80 ? accumulator : accumulator - 0x100) -
      (subtrahend < 0x80 ? subtrahend : subtrahend - 0x100) -
      borrow;
    this.memory.carry = difference < 0;
    this.memory.setAuxCarry((accumulator & 0x0f) < (subtrahend & 0x0f) + borrow);
    this.memory.setOverflow(signedDifference < -128 || signedDifference > 127);
    this.memory.acc = difference;
  }

  private multiply(): void {
    const product = this.memory.acc * this.memory.b;
    this.memory.acc = product;
    this.memory.b = product >>> 8;
    this.memory.carry = false;
    this.memory.setOverflow(product > 0xff);
  }

  private divide(): void {
    const divisor = this.memory.b;
    this.memory.carry = false;
    if (divisor === 0) {
      this.memory.setOverflow(true);
      return;
    }
    const dividend = this.memory.acc;
    this.memory.acc = Math.floor(dividend / divisor);
    this.memory.b = dividend % divisor;
    this.memory.setOverflow(false);
  }

  private decimalAdjust(): void {
    const original = this.memory.acc;
    let correction = 0;
    let carry = this.memory.carry;
    if ((original & 0x0f) > 9 || this.memory.auxCarry) correction |= 0x06;
    if (original > 0x99 || carry) {
      correction |= 0x60;
      carry = true;
    }
    this.memory.acc = original + correction;
    this.memory.carry = carry;
  }

  private compareAndJump(left: number, right: number, relative: number, postPc: number): void {
    const a = u8(left);
    const b = u8(right);
    this.memory.carry = a < b;
    if (a !== b) this.branch(postPc, relative);
  }

  private pushDirect(address: number): void {
    const nextSp = u8(this.memory.sp + 1);
    this.memory.assertIndirect(nextSp);
    this.memory.sp = nextSp;
    this.memory.writeIndirect(nextSp, this.memory.readDirect(address));
  }

  private pushReturnAddress(address: number): void {
    const lowAddress = u8(this.memory.sp + 1);
    const highAddress = u8(this.memory.sp + 2);
    this.memory.assertIndirect(lowAddress);
    this.memory.assertIndirect(highAddress);
    this.memory.writeIndirect(lowAddress, address);
    this.memory.writeIndirect(highAddress, address >>> 8);
    this.memory.sp = highAddress;
  }

  private returnFromCall(): void {
    const highAddress = this.memory.sp;
    const lowAddress = u8(highAddress - 1);
    this.memory.assertIndirect(highAddress);
    this.memory.assertIndirect(lowAddress);
    const high = this.memory.readIndirect(highAddress);
    const low = this.memory.readIndirect(lowAddress);
    this.memory.sp = u8(highAddress - 2);
    this.pcValue = (high << 8) | low;
  }

  private popDirect(address: number): void {
    this.memory.assertDirect(address);
    const stackAddress = this.memory.sp;
    this.memory.assertIndirect(stackAddress);
    const value = this.memory.readIndirect(stackAddress);
    this.memory.sp = u8(this.memory.sp - 1);
    this.memory.writeDirect(address, value);
  }

  private exchangeIndirect(register: number, lowNibbleOnly: boolean): void {
    const address = this.memory.readRegister(register);
    const indirect = this.memory.readIndirect(address);
    const accumulator = this.memory.acc;
    if (lowNibbleOnly) {
      this.memory.acc = (accumulator & 0xf0) | (indirect & 0x0f);
      this.memory.writeIndirect(address, (indirect & 0xf0) | (accumulator & 0x0f));
    } else {
      this.memory.acc = indirect;
      this.memory.writeIndirect(address, accumulator);
    }
  }

  private xramRegisterAddress(register: number): number {
    return (this.memory.readDirect(SFR.P2, true) << 8) | this.memory.readRegister(register);
  }
}
