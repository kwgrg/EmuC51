import { useState } from "react";
import type { MemorySpace } from "../core/types";
import { hex16 } from "../core/numbers";
import { parseHex } from "./DebuggerPanel";

export const memoryBounds = (space: MemorySpace): [number, number] =>
  space === "sfr" ? [0x80, 0xff] : [0, space === "iram" ? 0x7f : 0xffff];

/** The parent keys this form by space/address to reset drafts after navigation. */
export function MemoryNavigation({ space, address, disabled, onNavigate }: {
  space: MemorySpace;
  address: number;
  disabled: boolean;
  onNavigate: (address: number) => void;
}) {
  const [draft, setDraft] = useState(hex16(address));
  const [minimum, maximum] = memoryBounds(space);
  const parsed = parseHex(draft, maximum);
  const valid = parsed !== undefined && parsed >= minimum;
  const go = (next: number) => {
    setDraft(hex16(next));
    onNavigate(next);
  };
  return <form className="memory-navigation" onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && valid) go(parsed);
  }}>
    <button type="button" aria-label="上一页" disabled={disabled || address <= minimum} onClick={() => go(Math.max(minimum, address - 256))}>上一页</button>
    <button type="button" aria-label="下一页" disabled={disabled || address + 256 > maximum} onClick={() => go(address + 256)}>下一页</button>
    <label>
      GOTO:
      <input aria-label="内存起始地址" aria-invalid={!valid} disabled={disabled}
        title={`十六进制 ${hex16(minimum)}–${hex16(maximum)}；Enter 确认，Escape 取消`}
        value={draft} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(hex16(address));
          }
        }} />
    </label>
    <button disabled={disabled || !valid}>REFRESH</button>
  </form>;
}
