import { useMemo, useRef } from "react";
import type { VerifiedSdccDebug } from "../core/sdcc-debug";
import type { DebugConfig } from "../core/debugger";
import { hex16 } from "../core/numbers";

export function SdccSourcePanel({ verified, checking, error, disabled, pc, config, onFiles, onToggleLine, onCancelImport }: {
  verified?: VerifiedSdccDebug; checking: boolean; error?: string;
  disabled: boolean; pc?: number; config: DebugConfig;
  onFiles: (files: File[]) => void; onToggleLine: (addresses: number[]) => void; onCancelImport?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const locations = verified?.locations;
  const current = useMemo(() => locations?.filter(item => item.address === pc).map(item => item.line) ?? [], [locations, pc]);
  const byLine = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const item of locations ?? []) map.set(item.line, [...(map.get(item.line) ?? []), item.address]);
    return map;
  }, [locations]);
  return <section className="sdcc-panel" aria-label="外部 SDCC 源码调试">
    <div className="asm-actions">
      <label className="secondary-command"><input aria-label="导入 SDCC 构建文件" type="file" multiple accept=".json,.c,.ihx,.cdb" disabled={disabled || checking}
        onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) onFiles(files); }} />导入外部 SDCC 产物</label>
      {onCancelImport && <button onClick={onCancelImport}>取消 SDCC 导入</button>}
      <button disabled={!current.length} onClick={() => scroller.current?.querySelector(`[data-source-line="${current[0]}"]`)?.scrollIntoView({ block: "nearest" })}>定位当前源码行</button>
    </div>
    <p>选择同次本地 SDCC 构建的 .c、.ihx、.cdb 和 emuc51-sdcc.json 摘要清单。此处不编译 C；支持 classic 8051、small 模型、128 字节 IRAM。清单由仓库 scripts/build-sdcc-bundle.mjs 生成。</p>
    <p data-testid="sdcc-status">{checking ? "正在校验 SDCC 文件…" : error ? `源码映射不可用：${error}` : verified ? `已校验文件摘要 · ${verified.data.manifest.files.source.name} · ${locations!.length} 个精确行地址` : "尚未导入带构建清单的 SDCC 文件"}</p>
    {verified && <>
      <p data-testid="sdcc-location">PC {hex16(pc ?? 0)} · {current.length ? `${verified.data.manifest.files.source.name} 第 ${current.join("、")} 行` : "无精确源码行映射（启动/运行库/地址空隙不推断）"}</p>
      <p>行断点设置该行全部已记录地址；复用地址断点的启停、条件和次数。全部地址已有断点时再次点击会移除这些地址，也影响共享同地址的其他源码行。不是 C 语句级单步。</p>
      <div className="sdcc-source" ref={scroller}>
        {verified.data.source.split(/\r\n|\n|\r/).map((text, index) => {
          const line = index + 1;
          const addresses = byLine.get(line) ?? [];
          const configured = addresses.filter(address => config.breakpoints.includes(address));
          const enabled = configured.filter(address => config.breakpointOptions?.find(item => item.address === address)?.enabled !== false);
          return <div key={line} className={current.includes(line) ? "source-current" : ""} data-source-line={line}>
            <button disabled={disabled || checking || !addresses.length} aria-label={`切换源码第 ${line} 行断点`} aria-pressed={addresses.length > 0 && configured.length === addresses.length}
              onClick={() => onToggleLine(addresses)}>{configured.length ? "●" : "○"}</button>
            <code>{line}</code><pre>{text || " "}</pre>
            <span aria-label={`源码第 ${line} 行地址`}>{addresses.length ? addresses.map(hex16).join(", ") : "—"}{configured.length ? ` · 启用 ${enabled.length}/${addresses.length}` : ""}</span>
          </div>;
        })}
      </div>
      <p className="asm-hashes">固件 SHA-256 {verified.firmwareSha256}</p>
    </>}
  </section>;
}
