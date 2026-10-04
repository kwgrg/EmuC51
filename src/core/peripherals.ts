import { type Memory8051, SFR } from "./memory";
import { EmulatorFault, type InterruptSource, type PeripheralSnapshot, type PeripheralViewState, type SerialFrame } from "./types";

const PORTS = [SFR.P0, SFR.P1, SFR.P2, SFR.P3] as const;
const SOURCES: InterruptSource[] = ["external0", "timer0", "external1", "timer1", "serial"];
const VECTORS = [0x03, 0x0b, 0x13, 0x1b, 0x23];
const MAX_QUEUE = 4096;
const byte = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xff;
const bytes = (value: unknown, length?: number): value is number[] => Array.isArray(value) && value.length <= MAX_QUEUE && (length === undefined || value.length === length) && Array.from(value).every(byte);
const frame = (value: unknown): value is SerialFrame | null => {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SerialFrame>;
  return byte(item.value) && Number.isInteger(item.mode) && (item.mode ?? -1) >= 0 && (item.mode ?? 4) <= 3 && Number.isInteger(item.progress) && (item.progress ?? -1) >= 0 && (item.progress ?? 705) < ([8, 320, 704, 352][item.mode!] ?? 0) && (item.ninthBit === undefined || typeof item.ninthBit === "boolean");
};

export const validatePeripheralSnapshot = (value: unknown): value is PeripheralSnapshot => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PeripheralSnapshot>;
  const serial = item.serial;
  if (!serial || !bytes(item.portInputs, 4) || !bytes(item.lastPins, 4) || !Array.isArray(item.counterEdges) || item.counterEdges.length !== 2 || !Array.from(item.counterEdges).every((n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_QUEUE) || !Array.isArray(item.interruptStack) || item.interruptStack.length > 2 || !Number.isInteger(item.interruptDelay) || (item.interruptDelay ?? -1) < 0 || (item.interruptDelay ?? 2) > 1) return false;
  if (!Array.from(item.interruptStack).every((entry, index) => entry && SOURCES.includes(entry.source) && (entry.priority === 0 || entry.priority === 1) && (index === 0 || entry.priority > item.interruptStack![index - 1]!.priority))) return false;
  return byte(serial.rxBuffer) && Array.isArray(serial.rxQueue) && serial.rxQueue.length <= MAX_QUEUE && Array.from(serial.rxQueue).every((n) => Number.isInteger(n) && n >= 0 && n <= 0x1ff) && bytes(serial.txQueue) && bytes(serial.txOutput) && frame(serial.txFrame) && frame(serial.rxFrame);
};

const clone = (snapshot: PeripheralSnapshot): PeripheralSnapshot => ({
  portInputs: [...snapshot.portInputs],
  lastPins: [...snapshot.lastPins],
  counterEdges: [...snapshot.counterEdges],
  interruptStack: snapshot.interruptStack.map((entry) => ({ ...entry })),
  interruptDelay: snapshot.interruptDelay,
  serial: {
    ...snapshot.serial,
    rxQueue: [...snapshot.serial.rxQueue],
    txQueue: [...snapshot.serial.txQueue],
    txOutput: [...snapshot.serial.txOutput],
    txFrame: snapshot.serial.txFrame && { ...snapshot.serial.txFrame },
    rxFrame: snapshot.serial.rxFrame && { ...snapshot.serial.rxFrame },
  },
});

export class Peripherals8051 {
  private data!: PeripheralSnapshot;
  private pendingOutput: number[] = [];

  constructor(private readonly memory: Memory8051) {
    this.reset();
    memory.peripheralHooks = {
      readSfr: (address) => {
        if (address === SFR.IE || address === SFR.IP) this.data.interruptDelay = 1;
        const port = PORTS.indexOf(address as typeof PORTS[number]);
        if (port >= 0) return this.pins(port);
        if (address === SFR.SBUF) return this.data.serial.rxBuffer;
        return undefined;
      },
      beforeWriteSfr: (address) => {
        if (address === SFR.SBUF && this.data.serial.txQueue.length >= MAX_QUEUE) {
          throw new EmulatorFault({ code: "INVALID_INPUT", message: "串口发送队列已满（4096 字节）" });
        }
      },
      afterWriteSfr: (address, _previous, value) => {
        if (address === SFR.SBUF) {
          this.data.serial.txQueue.push(value);
          this.startSerialFrames();
        }
        if (address === SFR.IE || address === SFR.IP) this.data.interruptDelay = 1;
        if (address === SFR.P3 || address === SFR.TCON) this.samplePins();
      },
    };
  }

  reset(): void {
    this.pendingOutput = [];
    this.data = {
      portInputs: [0xff, 0xff, 0xff, 0xff],
      lastPins: PORTS.map((address) => this.memory.readSfrLatch(address)) as [number, number, number, number],
      counterEdges: [0, 0],
      interruptStack: [],
      interruptDelay: 0,
      serial: { rxBuffer: this.memory.readSfrLatch(SFR.SBUF), rxQueue: [], txQueue: [], txOutput: [], txFrame: null, rxFrame: null },
    };
  }

  snapshot(): PeripheralSnapshot { return clone(this.data); }
  restore(snapshot: PeripheralSnapshot): void { this.data = clone(snapshot); this.pendingOutput = []; }

  get powerMode(): PeripheralViewState["powerMode"] {
    const pcon = this.memory.readSfrLatch(SFR.PCON);
    return (pcon & 2) !== 0 ? "power-down" : (pcon & 1) !== 0 ? "idle" : "running";
  }

  pins(port: number): number { return this.memory.readSfrLatch(PORTS[port]!) & this.data.portInputs[port]!; }

  setPortInput(port: number, value: number): void {
    if (!Number.isInteger(port) || port < 0 || port > 3 || !byte(value)) {
      throw new EmulatorFault({ code: "INVALID_INPUT", message: "GPIO 端口须为 0..3，输入须为 0..255" });
    }
    this.data.portInputs[port] = value;
    this.samplePins();
  }

  receiveSerial(value: number, ninthBit = true): void {
    if (!byte(value) || typeof ninthBit !== "boolean") throw new EmulatorFault({ code: "INVALID_INPUT", message: "串口输入须为 0..255，第九位须为布尔值" });
    if ((this.memory.readSfrLatch(SFR.SCON) & 0x10) === 0) return;
    if (this.data.serial.rxQueue.length >= MAX_QUEUE) throw new EmulatorFault({ code: "INVALID_INPUT", message: "串口接收队列已满（4096 字节）" });
    this.data.serial.rxQueue.push(value | (ninthBit ? 0x100 : 0));
    this.startSerialFrames();
  }

  drainSerialOutput(): number[] {
    const output = this.pendingOutput;
    this.pendingOutput = [];
    return output;
  }

  private samplePins(): void {
    const current = this.pins(3);
    const falling = this.data.lastPins[3] & ~current;
    const tcon = this.memory.readSfrLatch(SFR.TCON);
    const tmod = this.memory.readSfrLatch(SFR.TMOD);
    for (let index = 0; index < 2; index += 1) {
      if ((falling & (0x10 << index)) !== 0 && (tmod & (4 << (index * 4))) !== 0 && this.timerAllowed(index, (tmod & 3) === 3) && !(index === 1 && ((tmod >> 4) & 3) === 3)) this.data.counterEdges[index] = Math.min(MAX_QUEUE, this.data.counterEdges[index]! + 1);
    }
    let next = tcon;
    if ((tcon & 1) !== 0 && (falling & 4) !== 0) next |= 2;
    if ((tcon & 4) !== 0 && (falling & 8) !== 0) next |= 8;
    if ((tcon & 1) === 0) next = (current & 4) === 0 ? next | 2 : next & ~2;
    if ((tcon & 4) === 0) next = (current & 8) === 0 ? next | 8 : next & ~8;
    this.memory.writeSfrHardware(SFR.TCON, next);
    for (let port = 0; port < 4; port += 1) this.data.lastPins[port] = this.pins(port);
  }

  private pending(): InterruptSource[] {
    const tcon = this.memory.readSfrLatch(SFR.TCON);
    const scon = this.memory.readSfrLatch(SFR.SCON);
    return SOURCES.filter((_source, index) => (([tcon & 2, tcon & 0x20, tcon & 8, tcon & 0x80, scon & 3][index] ?? 0) !== 0));
  }

  nextInterrupt(): { source: InterruptSource; priority: 0 | 1; vector: number } | undefined {
    if (this.powerMode === "power-down") return undefined;
    this.samplePins();
    if (this.data.interruptDelay > 0) {
      return undefined;
    }
    const ie = this.memory.readSfrLatch(SFR.IE);
    if ((ie & 0x80) === 0) return undefined;
    const ip = this.memory.readSfrLatch(SFR.IP);
    const inService = this.data.interruptStack.at(-1)?.priority ?? -1;
    const pending = this.pending();
    for (const priority of [1, 0] as const) {
      if (priority <= inService) continue;
      for (let index = 0; index < 5; index += 1) {
        if ((ie & (1 << index)) !== 0 && (((ip >> index) & 1) === priority) && pending.includes(SOURCES[index]!)) {
          return { source: SOURCES[index]!, priority, vector: VECTORS[index]! };
        }
      }
    }
    return undefined;
  }

  beginInstruction(): void {
    if (this.data.interruptDelay > 0) this.data.interruptDelay -= 1;
  }

  enterInterrupt(source: InterruptSource, priority: 0 | 1): void {
    this.data.interruptStack.push({ source, priority });
    let tcon = this.memory.readSfrLatch(SFR.TCON);
    if (source === "timer0") tcon &= ~0x20;
    if (source === "timer1") tcon &= ~0x80;
    if (source === "external0" && (tcon & 1) !== 0) tcon &= ~2;
    if (source === "external1" && (tcon & 4) !== 0) tcon &= ~8;
    this.memory.writeSfrHardware(SFR.TCON, tcon);
    this.memory.writeSfrHardware(SFR.PCON, this.memory.readSfrLatch(SFR.PCON) & ~1);
  }

  returnFromInterrupt(): void {
    this.data.interruptStack.pop();
    this.data.interruptDelay = 1;
  }

  advance(machineCycles: number): void {
    if (this.powerMode === "power-down") return;
    this.samplePins();
    const edges = [...this.data.counterEdges];
    this.data.counterEdges = [0, 0];
    for (let cycle = 0; cycle < machineCycles; cycle += 1) {
      const overflow1 = this.advanceTimers(cycle === 0 ? edges : [0, 0]);
      this.advanceSerial(overflow1);
    }
  }

  private timerAllowed(index: number, split: boolean): boolean {
    const tmod = this.memory.readSfrLatch(SFR.TMOD);
    const tcon = this.memory.readSfrLatch(SFR.TCON);
    const gate = (tmod & (8 << (4 * index))) !== 0;
    const running = index === 1 && split ? true : (tcon & (0x10 << (2 * index))) !== 0;
    return running && (!gate || (this.pins(3) & (4 << index)) !== 0);
  }

  private incrementTimer(index: number, mode: number, pulses: number, setFlag: boolean): number {
    if (pulses === 0) return 0;
    const lowAddress = index === 0 ? SFR.TL0 : SFR.TL1;
    const highAddress = index === 0 ? SFR.TH0 : SFR.TH1;
    const low = this.memory.readSfrLatch(lowAddress);
    const high = this.memory.readSfrLatch(highAddress);
    let overflows = 0;
    if (mode === 2 || mode === 3) {
      let next = low;
      for (let pulse = 0; pulse < pulses; pulse += 1) {
        if (next === 0xff) { next = mode === 2 ? high : 0; overflows += 1; }
        else next += 1;
      }
      this.memory.writeSfrHardware(lowAddress, next);
    } else {
      const max = mode === 0 ? 0x2000 : 0x10000;
      const current = mode === 0 ? (high << 5) | (low & 0x1f) : (high << 8) | low;
      const total = current + pulses;
      overflows = Math.floor(total / max);
      const next = total % max;
      this.memory.writeSfrHardware(lowAddress, mode === 0 ? (low & 0xe0) | (next & 0x1f) : next & 0xff);
      this.memory.writeSfrHardware(highAddress, mode === 0 ? next >> 5 : next >> 8);
    }
    if (overflows > 0 && setFlag) this.memory.writeSfrHardware(SFR.TCON, this.memory.readSfrLatch(SFR.TCON) | (index === 0 ? 0x20 : 0x80));
    return overflows;
  }

  private advanceTimers(edges: number[]): number {
    const tmod = this.memory.readSfrLatch(SFR.TMOD);
    const split = (tmod & 3) === 3;
    if (this.timerAllowed(0, split)) this.incrementTimer(0, tmod & 3, (tmod & 4) !== 0 ? edges[0]! : 1, true);
    if (split && (this.memory.readSfrLatch(SFR.TCON) & 0x40) !== 0) {
      const high = this.memory.readSfrLatch(SFR.TH0);
      this.memory.writeSfrHardware(SFR.TH0, (high + 1) & 0xff);
      if (high === 0xff) this.memory.writeSfrHardware(SFR.TCON, this.memory.readSfrLatch(SFR.TCON) | 0x80);
    }
    const mode1 = (tmod >> 4) & 3;
    if (mode1 === 3 || !this.timerAllowed(1, split)) return 0;
    return this.incrementTimer(1, mode1, (tmod & 0x40) !== 0 ? edges[1]! : 1, !split);
  }

  private startSerialFrames(): void {
    const serial = this.data.serial;
    const scon = this.memory.readSfrLatch(SFR.SCON);
    const mode = ((scon >> 6) & 3) as SerialFrame["mode"];
    if (!serial.txFrame && serial.txQueue.length > 0) serial.txFrame = { value: serial.txQueue.shift()!, mode, progress: 0, ninthBit: (scon & 8) !== 0 };
    if (!serial.rxFrame && serial.rxQueue.length > 0 && (scon & 0x11) === 0x10) {
      const incoming = serial.rxQueue.shift()!;
      serial.rxFrame = { value: incoming & 0xff, mode, progress: 0, ninthBit: (incoming & 0x100) !== 0 };
    }
  }

  private tickFrame(frame: SerialFrame, timer1Overflows: number): boolean {
    const smod = (this.memory.readSfrLatch(SFR.PCON) & 0x80) !== 0;
    const increment = frame.mode === 0 ? 1 : frame.mode === 2 ? 12 : timer1Overflows;
    const threshold = frame.mode === 0 ? 8 : frame.mode === 2 ? 11 * (smod ? 32 : 64) : (frame.mode === 1 ? 10 : 11) * (smod ? 16 : 32);
    frame.progress += increment;
    return frame.progress >= threshold;
  }

  private advanceSerial(timer1Overflows: number): void {
    const serial = this.data.serial;
    this.startSerialFrames();
    if (serial.txFrame && this.tickFrame(serial.txFrame, timer1Overflows)) {
      if (serial.txOutput.length >= MAX_QUEUE) serial.txOutput.shift();
      serial.txOutput.push(serial.txFrame.value);
      if (this.pendingOutput.length >= MAX_QUEUE) this.pendingOutput.shift();
      this.pendingOutput.push(serial.txFrame.value);
      serial.txFrame = null;
      this.memory.writeSfrHardware(SFR.SCON, this.memory.readSfrLatch(SFR.SCON) | 2);
    }
    if ((this.memory.readSfrLatch(SFR.SCON) & 0x10) === 0) {
      serial.rxFrame = null;
      serial.rxQueue = [];
    } else if (serial.rxFrame && this.tickFrame(serial.rxFrame, timer1Overflows)) {
      let scon = this.memory.readSfrLatch(SFR.SCON);
      const ninth = serial.rxFrame.ninthBit !== false;
      if (serial.rxFrame.mode !== 0) scon = ninth ? scon | 4 : scon & ~4;
      if ((scon & 1) === 0 && (serial.rxFrame.mode === 0 || (scon & 0x20) === 0 || ninth)) {
        serial.rxBuffer = serial.rxFrame.value;
        scon |= 1;
      }
      this.memory.writeSfrHardware(SFR.SCON, scon);
      serial.rxFrame = null;
    }
  }

  state(includeSerialOutput = true): PeripheralViewState {
    const tmod = this.memory.readSfrLatch(SFR.TMOD);
    const tcon = this.memory.readSfrLatch(SFR.TCON);
    const scon = this.memory.readSfrLatch(SFR.SCON);
    const serial = this.data.serial;
    return {
      ports: PORTS.map((address, port) => ({ latch: this.memory.readSfrLatch(address), input: this.data.portInputs[port]!, pins: this.pins(port) })),
      timers: [0, 1].map((index) => {
        const mode = (tmod >> (index * 4)) & 3;
        const low = this.memory.readSfrLatch(index === 0 ? SFR.TL0 : SFR.TL1);
        const high = this.memory.readSfrLatch(index === 0 ? SFR.TH0 : SFR.TH1);
        return { mode, value: mode === 0 ? (high << 5) | (low & 0x1f) : mode >= 2 ? low : (high << 8) | low, running: this.timerAllowed(index, (tmod & 3) === 3) && !(index === 1 && mode === 3), counter: (tmod & (4 << (index * 4))) !== 0, gate: (tmod & (8 << (index * 4))) !== 0, overflow: (tcon & (0x20 << (index * 2))) !== 0 };
      }),
      serial: { mode: scon >> 6, receiving: (scon & 0x10) !== 0, txBusy: serial.txFrame !== null || serial.txQueue.length > 0, rxQueued: serial.rxQueue.length + (serial.rxFrame ? 1 : 0), rxBuffer: serial.rxBuffer, txOutput: includeSerialOutput ? [...serial.txOutput] : [] },
      interrupt: { activePriorities: this.data.interruptStack.map((entry) => entry.priority), pending: this.pending() },
      powerMode: this.powerMode,
    };
  }
}
