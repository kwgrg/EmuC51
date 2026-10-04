import { useState } from "react";
import { hex16, hex8 } from "../core/numbers";
import { SFR } from "../core/memory";

const definedSfr = new Set<number>(Object.values(SFR));

export type WritableSpace = "iram" | "sfr" | "xram";
export interface DebugSettings {
  breakpoints: number[];
  watchpoints: Array<{ space: WritableSpace; address: number }>;
}

export function parseHex(value: string, maximum: number): number | undefined {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(normalized)) return undefined;
  const parsed = Number.parseInt(normalized, 16);
  return parsed <= maximum ? parsed : undefined;
}

export function DebuggerPanel({ config, disabled, onChange, onRunTo }: {
  config: DebugSettings;
  disabled: boolean;
  onChange: (config: DebugSettings) => void;
  onRunTo: (address: number) => void;
}) {
  const [address, setAddress] = useState("0000");
  const [watchAddress, setWatchAddress] = useState("20");
  const [space, setSpace] = useState<WritableSpace>("iram");
  const parsedAddress = parseHex(address, 0xffff);
  const parsedWatchAddress = parseHex(watchAddress, space === "iram" ? 0x7f : space === "sfr" ? 0xff : 0xffff);
  const validWatchAddress = parsedWatchAddress !== undefined && (space !== "sfr" || definedSfr.has(parsedWatchAddress));
  return (
    <div className="debugger-panel">
      <form className="debug-field" onSubmit={(event) => {
        event.preventDefault();
        if (parsedAddress !== undefined) onChange({ ...config, breakpoints: [...new Set([...config.breakpoints, parsedAddress])].sort((a, b) => a - b) });
      }}>
        <label htmlFor="breakpoint-address">PC 地址 (HEX)</label>
        <input id="breakpoint-address" aria-label="断点地址" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={6} />
        <button disabled={disabled || parsedAddress === undefined}>添加断点</button>
        <button type="button" disabled={disabled || parsedAddress === undefined} onClick={() => parsedAddress !== undefined && onRunTo(parsedAddress)}>运行至地址</button>
      </form>
      <div className="debug-tags" aria-label="地址断点">
        {config.breakpoints.length === 0 && <span className="muted">暂无断点</span>}
        {config.breakpoints.map((item) => <button disabled={disabled} aria-label={`删除断点 ${hex16(item)}`} onClick={() => onChange({ ...config, breakpoints: config.breakpoints.filter((value) => value !== item) })} key={item}>PC {hex16(item)} ×</button>)}
      </div>
      <form className="debug-field" onSubmit={(event) => {
        event.preventDefault();
        if (validWatchAddress && parsedWatchAddress !== undefined && !config.watchpoints.some((watch) => watch.space === space && watch.address === parsedWatchAddress)) onChange({ ...config, watchpoints: [...config.watchpoints, { space, address: parsedWatchAddress }] });
      }}>
        <label htmlFor="watch-address">写入监视点</label>
        <select aria-label="监视内存空间" value={space} onChange={(event) => { const next = event.target.value as WritableSpace; setSpace(next); setWatchAddress(next === "sfr" ? "80" : "20"); }}>
          <option value="iram">IRAM</option><option value="sfr">SFR</option><option value="xram">XRAM</option>
        </select>
        <input id="watch-address" aria-label="监视地址" value={watchAddress} onChange={(event) => setWatchAddress(event.target.value)} maxLength={6} />
        <button disabled={disabled || !validWatchAddress}>添加监视点</button>
      </form>
      <div className="debug-tags" aria-label="内存监视点">
        {config.watchpoints.length === 0 && <span className="muted">写入后字节改变时暂停</span>}
        {config.watchpoints.map((watch) => <button disabled={disabled} aria-label={`删除监视点 ${watch.space.toUpperCase()} ${hex16(watch.address)}`} key={`${watch.space}-${watch.address}`} onClick={() => onChange({ ...config, watchpoints: config.watchpoints.filter((value) => value !== watch) })}>{watch.space.toUpperCase()} {hex16(watch.address)} ×</button>)}
      </div>
    </div>
  );
}

export function ByteEditor({ space, disabled, onWrite }: { space: "code" | WritableSpace; disabled: boolean; onWrite: (space: WritableSpace, address: number, value: number) => void }) {
  const [address, setAddress] = useState(space === "sfr" ? "80" : "20");
  const [value, setValue] = useState("00");
  const parsedAddress = parseHex(address, space === "iram" ? 0x7f : space === "sfr" ? 0xff : 0xffff);
  const parsedValue = parseHex(value, 0xff);
  const valid = parsedAddress !== undefined && parsedValue !== undefined && (space !== "sfr" || definedSfr.has(parsedAddress));
  return <form className="memory-editor" onSubmit={(event) => { event.preventDefault(); if (space !== "code" && valid && parsedAddress !== undefined && parsedValue !== undefined) onWrite(space, parsedAddress, parsedValue); }}>
    <span>{space === "code" ? "CODE 固件只读" : "暂停时写入字节 (HEX)"}</span>
    <input aria-label="写入内存地址" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={6} />
    <input aria-label="写入内存值" value={value} onChange={(event) => setValue(event.target.value)} maxLength={4} />
    <button disabled={disabled || space === "code" || !valid}>写入字节</button>
  </form>;
}

export function RegisterEditor({ disabled, onWrite }: { disabled: boolean; onWrite: (name: string, value: number) => void }) {
  const [name, setName] = useState("ACC");
  const [value, setValue] = useState("00");
  const parsed = parseHex(value, name === "PC" || name === "DPTR" ? 0xffff : 0xff);
  return <form className="register-editor" onSubmit={(event) => { event.preventDefault(); if (parsed !== undefined) onWrite(name, parsed); }}>
    <select aria-label="编辑寄存器" value={name} onChange={(event) => setName(event.target.value)}>
      {["PC", "DPTR", "ACC", "B", "SP", "PSW", ...Array.from({ length: 8 }, (_, i) => `R${i}`)].map((item) => <option key={item}>{item}</option>)}
    </select>
    <input aria-label="寄存器新值" value={value} onChange={(event) => setValue(event.target.value)} maxLength={6} placeholder={hex8(0)} />
    <button disabled={disabled || parsed === undefined}>写入寄存器</button>
  </form>;
}
