import { useState } from "react";
import { hex16, hex8 } from "../core/numbers";
import { breakpointOptions, removeBreakpoint, MAX_BREAKPOINT_HIT_COUNT, type BreakpointOptions, type DebugConfig } from "../core/debugger";
import { SFR } from "../core/memory";

const definedSfr = new Set<number>(Object.values(SFR));

export type WritableSpace = "iram" | "sfr" | "xram";
export type DebugSettings = DebugConfig;

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
        if (!disabled && parsedAddress !== undefined) onChange({ ...config, breakpoints: [...new Set([...config.breakpoints, parsedAddress])].sort((a, b) => a - b) });
      }}>
        <label htmlFor="breakpoint-address">PC 地址 (HEX)</label>
        <input id="breakpoint-address" aria-label="断点地址" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={6} />
        <button disabled={disabled || parsedAddress === undefined}>添加断点</button>
        <button type="button" disabled={disabled || parsedAddress === undefined} onClick={() => parsedAddress !== undefined && onRunTo(parsedAddress)}>运行至地址</button>
      </form>
      <div className="debug-tags" aria-label="地址断点">
        {config.breakpoints.length === 0 && <span className="muted">暂无断点</span>}
        {config.breakpoints.map((item) => {
          const option = breakpointOptions(config, item);
          return <BreakpointRow key={`${item}:${option.hitCount}`} option={option} disabled={disabled}
            onRemove={() => onChange(removeBreakpoint(config, item))}
            onUpdate={(next) => onChange({ ...config, breakpointOptions: [
              ...(config.breakpointOptions ?? []).filter((value) => value.address !== item), next,
            ] })} />;
        })}
      </div>
      <p className="panel-help">每 N 次到达指令前暂停；继续保留计数，单步不计。复位、加载/恢复、编辑 PC 或该断点设置后重新计数。</p>
      <form className="debug-field" onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && validWatchAddress && parsedWatchAddress !== undefined && !config.watchpoints.some((watch) => watch.space === space && watch.address === parsedWatchAddress)) onChange({ ...config, watchpoints: [...config.watchpoints, { space, address: parsedWatchAddress }] });
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

function BreakpointRow({ option, disabled, onUpdate, onRemove }: {
  option: BreakpointOptions;
  disabled: boolean;
  onUpdate: (option: BreakpointOptions) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(String(option.hitCount));
  const count = Number(draft);
  const valid = /^\d+$/.test(draft) && Number.isSafeInteger(count) && count >= 1 && count <= MAX_BREAKPOINT_HIT_COUNT;
  const address = hex16(option.address);
  return <form className="breakpoint-row" onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && valid) { onUpdate({ ...option, hitCount: count }); setDraft(String(count)); }
  }}>
    <label><input type="checkbox" aria-label={`启用断点 ${address}`} checked={option.enabled} disabled={disabled}
      onChange={(event) => onUpdate({ ...option, enabled: event.target.checked })} />PC {address}</label>
    <label>每 N 次<input aria-label={`断点 ${address} 命中次数`} value={draft} disabled={disabled} aria-invalid={!valid}
      inputMode="numeric" onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setDraft(String(option.hitCount)); } }} /></label>
    <button disabled={disabled || !valid} aria-label={`应用断点 ${address}`}>应用</button>
    <button type="button" disabled={disabled} aria-label={`删除断点 ${address}`} onClick={onRemove}>×</button>
  </form>;
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
