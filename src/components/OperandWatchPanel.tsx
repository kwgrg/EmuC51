import { useState } from "react";
import { assertOperandAddress, type DebugConfig } from "../core/debugger";
import { operandBitLocation, type OperandSpace, type OperandWatchpoint } from "../core/operand-access";
import { hex16 } from "../core/numbers";

const names = { read: "读", write: "写", readwrite: "读写" };
export function OperandWatchPanel({ config, disabled, onChange }: { config: DebugConfig; disabled: boolean; onChange: (config: DebugConfig) => void }) {
  const [space, setSpace] = useState<OperandSpace>("data");
  const [access, setAccess] = useState<OperandWatchpoint["access"]>("readwrite");
  const [draft, setDraft] = useState("20");
  const watches = config.accessWatchpoints ?? [];
  const address = Number.parseInt(draft.replace(/^0x/i, ""), 16);
  let valid = /^(?:0x)?[\da-f]+$/i.test(draft);
  try { assertOperandAddress(space, address); } catch { valid = false; }
  const duplicate = watches.some(point => point.space === space && point.address === address && point.access === access);
  return <section className="operand-watch-panel" aria-label="CPU 操作数访问观察点">
    <h3>CPU 操作数访问</h3>
    <p className="panel-help">指令完成后暂停，保留指令 PC 和该指令所有匹配访问的顺序；同值写入也触发。DATA / IDATA 共享底层 RAM，但按寻址方式分别匹配。</p>
    <form className="debug-field" onSubmit={event => {
      event.preventDefault();
      if (!disabled && valid && !duplicate && watches.length < 128) onChange({ ...config, accessWatchpoints: [...watches, { space, address, access }] });
    }}>
      <select aria-label="CPU 访问空间" disabled={disabled} value={space} onChange={event => { const next = event.target.value as OperandSpace; setSpace(next); setDraft(next === "sfr" ? "90" : "20"); }}>
        <option value="data">DATA</option><option value="idata">IDATA</option><option value="xdata">XDATA</option><option value="sfr">SFR</option><option value="bit">BIT 位地址</option>
      </select>
      <select aria-label="CPU 访问类型" disabled={disabled} value={access} onChange={event => setAccess(event.target.value as OperandWatchpoint["access"])}>
        <option value="read">读</option><option value="write">写</option><option value="readwrite">读写</option>
      </select>
      <input aria-label="CPU 访问地址" disabled={disabled} value={draft} aria-invalid={!valid} maxLength={6} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") setDraft(space === "sfr" ? "90" : "20"); }} />
      <button disabled={disabled || !valid || duplicate || watches.length >= 128}>添加 CPU 访问观察点</button>
    </form>
    {space === "bit" && valid && <p className="panel-help" data-testid="operand-bit-location">位地址 {hex16(address)} → {operandBitLocation(address).byteSpace.toUpperCase()} {hex16(operandBitLocation(address).byteAddress)}.{operandBitLocation(address).index}</p>}
    <div className="debug-tags">
      {watches.map(point => { const label = `${point.space.toUpperCase()} ${hex16(point.address)} ${names[point.access]}`;
        return <button key={label} disabled={disabled} aria-label={`删除 CPU 访问观察点 ${label}`}
          onClick={() => onChange({ ...config, accessWatchpoints: watches.filter(item => item !== point) })}>{label} ×</button>;
      })}
    </div>
    <p className="panel-help">显式字节及位操作数（含 PUSH/POP 的直接操作数）；BIT 独立匹配位地址，字节观察点不匹配位指令。不含隐式 A/Rn/标志/栈访问、CODE 取指或 MOVC。UI、表达式、外设内部更新不触发。本功能不是总线周期探针；每次最多配置 128 个单地址观察点。</p>
  </section>;
}
