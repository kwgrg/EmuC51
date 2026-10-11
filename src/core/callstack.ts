import { SFR, type Memory8051 } from "./memory";
import type { InterruptSource } from "./types";

export interface CallFrame {
  id: number;
  kind: "call" | "interrupt";
  callAddress: number;
  entryAddress: number;
  returnAddress: number;
  callerSp: number;
  stackSp: number;
  source?: InterruptSource;
}

export interface CallStackState {
  frames: CallFrame[];
  complete: boolean;
  reason?: string;
  generation: number;
}

/** Execution history, never an inferred unwind of arbitrary IRAM bytes. */
export class CallStackTracker {
  private frames: CallFrame[] = [];
  private complete = true;
  private reason: string | undefined;
  private generation = 0;
  private nextId = 1;
  stackOperation = false;

  reset(): void {
    this.frames = [];
    this.complete = true;
    this.reason = undefined;
    this.generation += 1;
  }

  invalidate(reason: string): void {
    this.frames = [];
    this.complete = false;
    this.reason = reason;
    this.generation += 1;
  }

  written(space: "iram" | "sfr", address: number): void {
    if (space === "sfr" && address === SFR.SP && !this.stackOperation) {
      this.invalidate("SP 被显式修改，早期调用历史未知");
    } else if (space === "iram" && this.frames.some((frame) => address === frame.stackSp || address === frame.stackSp - 1)) {
      // Even a same-value write means the return slot is no longer owned solely
      // by the recorded CALL/interrupt. Do not silently recover trust later.
      this.invalidate("返回地址槽被写入，早期调用历史未知");
    }
  }

  enter(frame: Omit<CallFrame, "id" | "stackSp">, stackSp: number): void {
    if (frame.callerSp > 0x7d || stackSp !== frame.callerSp + 2 || this.frames.length >= 64) {
      this.invalidate("栈回绕或超出可追踪范围");
      return;
    }
    this.frames.push({ ...frame, stackSp, id: this.nextId++ });
  }

  returned(kind: CallFrame["kind"], oldSp: number, pc: number, sp: number): void {
    const frame = this.frames.at(-1);
    if (!frame || frame.kind !== kind || frame.stackSp !== oldSp || frame.returnAddress !== pc || frame.callerSp !== sp) {
      this.invalidate("返回类型、SP 或地址与已追踪帧不匹配");
      return;
    }
    this.frames.pop();
  }

  validate(memory: Memory8051): void {
    const top = this.frames.at(-1);
    if (top && (memory.sp < top.stackSp || memory.sp > 0x7f)) {
      this.invalidate("栈指针越过已追踪返回地址");
      return;
    }
    if (this.frames.some((frame) => memory.iram[frame.stackSp - 1] !== (frame.returnAddress & 0xff) || memory.iram[frame.stackSp] !== (frame.returnAddress >> 8))) {
      this.invalidate("返回地址与已追踪帧不一致");
    }
  }

  state(memory: Memory8051): CallStackState {
    this.validate(memory);
    return { frames: this.frames.map((frame) => ({ ...frame })), complete: this.complete, reason: this.reason, generation: this.generation };
  }
}
