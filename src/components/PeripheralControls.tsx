import { useState } from "react";
import type { CpuViewState } from "../core/types";
import { hex8, hex16 } from "../core/numbers";
import { parseHex } from "./DebuggerPanel";

export function GpioControls({ cpuState, disabled, onInput }: { cpuState?: CpuViewState; disabled: boolean; onInput: (port: number, value: number) => void }) {
  return <div className="gpio-controls">
    <p className="panel-help">点击输入引脚切换高低电平；读取值由输出锁存器与外部输入共同决定。</p>
    {Array.from({ length: 4 }, (_, port) => {
      const values = cpuState?.peripherals.ports[port] ?? { latch: 0xff, input: 0xff, pins: 0xff };
      return <fieldset className="gpio-port" key={port}>
        <legend>P{port} <span>LATCH {hex8(values.latch)} · INPUT {hex8(values.input)} · PINS <strong data-testid={`port-${port}-pins`}>{hex8(values.pins)}</strong></span></legend>
        <div className="gpio-bits">{Array.from({ length: 8 }, (_, bit) => <button key={bit} disabled={disabled} className={values.input & (1 << bit) ? "is-high" : ""} aria-label={`P${port}.${bit} 外部输入`} aria-pressed={Boolean(values.input & (1 << bit))} onClick={() => onInput(port, values.input ^ (1 << bit))}>P{port}.{bit}<strong>{values.input & (1 << bit) ? "1" : "0"}</strong></button>)}</div>
      </fieldset>;
    })}
    <p className="panel-help">P3.2 / P3.3: INT0 / INT1 · P3.4 / P3.5: T0 / T1</p>
  </div>;
}

export function SerialControls({ cpuState, disabled, output, onReceive }: { cpuState?: CpuViewState; disabled: boolean; output: number[]; onReceive: (bytes: number[], ninthBit: boolean) => void }) {
  const [byte, setByte] = useState("41");
  const [text, setText] = useState("");
  const [ninthBit, setNinthBit] = useState(true);
  const parsed = parseHex(byte, 0xff);
  const serial = cpuState?.peripherals.serial;
  return <div className="serial-controls">
    <div className="serial-status">MODE {serial?.mode ?? 0} · REN {serial?.receiving ? "ON" : "OFF"} · RX QUEUE {serial?.rxQueued ?? 0} · TX {serial?.txBusy ? "BUSY" : "IDLE"}</div>
    <form className="serial-form" onSubmit={(event) => { event.preventDefault(); if (parsed !== undefined) onReceive([parsed], ninthBit); }}>
      <label htmlFor="serial-byte">RX 字节 (HEX)</label><input id="serial-byte" aria-label="串口接收字节" value={byte} maxLength={4} onChange={(event) => setByte(event.target.value)} /><button disabled={disabled || parsed === undefined}>接收字节</button>
    </form>
    <form className="serial-form" onSubmit={(event) => { event.preventDefault(); if (text) { onReceive(Array.from(new TextEncoder().encode(text)), ninthBit); setText(""); } }}>
      <label htmlFor="serial-text">RX 文本 (UTF-8)</label><input id="serial-text" aria-label="串口接收文本" value={text} maxLength={128} onChange={(event) => setText(event.target.value)} /><button disabled={disabled || !text}>接收文本</button>
    </form>
    <label className="serial-ninthbit"><input type="checkbox" checked={ninthBit} onChange={(event) => setNinthBit(event.target.checked)} />RX 第 9 位 (模式 2 / 3)</label>
    <p className="panel-help">RX 按串口时钟推进；接收需开启 REN。TX 显示已完成发送的字节。</p>
    <div className="serial-console" aria-label="串口发送输出" data-testid="serial-output" role="log">
      <div>{output.length ? output.map(hex8).join(" ") : "等待 TX…"}</div>
      <pre>{output.map((value) => value >= 32 && value <= 126 || value === 10 || value === 13 ? String.fromCharCode(value) : ".").join("")}</pre>
    </div>
  </div>;
}

export function TimerStatus({ cpuState, sfr }: { cpuState?: CpuViewState; sfr: Uint8Array<ArrayBufferLike> }) {
  return <div className="timer-status">
    <div className="timer-cards">{[0, 1].map((timer) => {
      const state = cpuState?.peripherals.timers[timer];
      return <div key={timer}><strong>TIMER_{timer}</strong><code>{hex16(state?.value ?? 0)}</code><span>MODE {state?.mode ?? 0} · {state?.running ? "RUN" : "STOP"}</span><span>{state?.counter ? "COUNTER" : "TIMER"} · GATE {state?.gate ? "1" : "0"} · TF {state?.overflow ? "1" : "0"}</span></div>;
    })}</div>
    <div className="sfr-status">{[["TMOD", 0x89], ["TCON", 0x88], ["IE", 0xa8], ["IP", 0xb8], ["SCON", 0x98], ["PCON", 0x87]].map(([name, address]) => <span key={name}><b>{name}</b><code>{hex8(sfr[Number(address) - 0x80] ?? 0)}</code></span>)}</div>
    <p className="panel-help">CPU: {cpuState?.peripherals.powerMode ?? "running"} · 中断嵌套 {cpuState?.peripherals.interrupt.activePriorities.join(", ") || "—"} · 待处理中断 {cpuState?.peripherals.interrupt.pending.join(", ") || "—"}</p>
  </div>;
}
