import { Fragment, useMemo, useRef, useState } from "react";
import type { SdccDebugData, VerifiedSdccDebug } from "../core/sdcc-debug";
import type { DebugConfig } from "../core/debugger";
import { hex16 } from "../core/numbers";

export function SdccSourcePanel({ verified, checking, error, disabled, pc, config, onFiles, onToggleLine, onCancelImport, onBrowseAddress, onRunToAddress }: {
  verified?: VerifiedSdccDebug; checking: boolean; error?: string;
  disabled: boolean; pc?: number; config: DebugConfig;
  onFiles: (files: File[]) => void; onToggleLine: (addresses: number[]) => void; onCancelImport?: () => void;
  onBrowseAddress: (address: number) => void; onRunToAddress: (address: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<{ data: SdccDebugData; path: string }>();
  const file = verified?.files?.find(item => item.path === (selectedFile?.data === verified.data ? selectedFile.path : verified.data.project?.entry));
  const filename = file?.path ?? verified?.data.manifest.files.source.name;
  const source = file?.text ?? verified?.data.source ?? "";
  const locations = file?.locations ?? verified?.locations;
  const pcFile = file?.locations.some(item => item.address === pc) ? file : verified?.files?.find(item => item.locations.some(location => location.address === pc));
  const [selection, setSelection] = useState<{ data: SdccDebugData; file?: string; line: number; address: number }>();
  const target = !checking && selection?.data === verified?.data && selection?.file === filename && locations?.some(item => item.line === selection?.line && item.address === selection.address) ? selection : undefined;
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
      <button disabled={!verified?.locations.some(item => item.address === pc)} onClick={() => {
        if (pcFile && verified) { setSelectedFile({ data: verified.data, path: pcFile.path }); setSelection(undefined); }
        const line = pcFile?.locations.find(item => item.address === pc)?.line ?? current[0];
        requestAnimationFrame(() => scroller.current?.querySelector(`[data-source-line="${line}"]`)?.scrollIntoView({ block: "nearest" }));
      }}>定位当前源码行</button>
    </div>
    <p>选择同次本地 SDCC 构建的 .c、.ihx、.cdb 和 emuc51-sdcc.json 摘要清单。外部产物导入支持 classic 8051、small 模型、128 字节 IRAM。单文件清单由 scripts/build-sdcc-bundle.mjs 生成；混合工程选择一个 emuc51-project.build.json，使用 scripts/build-sdcc-project.mjs 外部构建。浏览器构建包也可在此重新导入。SDAS8051 与应用内简化 ASM 不兼容。</p>
    <p data-testid="sdcc-status">{checking ? "正在校验 SDCC 文件…" : error ? `源码映射不可用：${error}` : verified ? `已校验文件摘要 · ${verified.data.manifest.files.source.name} · ${locations!.length} 个精确行地址` : "尚未导入带构建清单的 SDCC 文件"}</p>
    {verified && <>
      {verified.files && <label>工程源文件<select aria-label="工程源文件" value={filename} onChange={event => {
        setSelectedFile({ data: verified.data, path: event.target.value }); setSelection(undefined);
      }}>{verified.files.map(item => <option key={item.path} value={item.path}>{item.path} ({item.language})</option>)}</select></label>}
      {file?.language === "sdas8051" && <p>SDAS8051 原始源码：仅完整匹配的真实指令行可定位/断点；数据、伪指令、标签和未验证宏行不推测。</p>}
      <p data-testid="sdcc-location">PC {hex16(pc ?? 0)} · {current.length ? `${filename} 第 ${current.join("、")} 行` : "无精确源码行映射（启动/运行库/地址空隙不推断）"}</p>
      <p>行断点设置该行全部已记录地址；复用地址断点的启停、条件和次数。全部地址已有断点时再次点击会移除这些地址，也影响共享同地址的其他源码行。不是 C 语句级单步。</p>
      <div className="sdcc-target" aria-label="源码地址导航">
        <p data-testid="sdcc-target">{target ? `已选 ${filename} 第 ${target.line} 行 · 地址 ${hex16(target.address)}` : "选择源码行旁的一个已验证地址，再查看汇编或运行至该地址。"}</p>
        <div className="asm-actions">
          <button disabled={disabled || !target} onClick={() => { if (target) onBrowseAddress(target.address); }}>查看目标汇编</button>
          <button disabled={disabled || !target} onClick={() => { if (target) onRunToAddress(target.address); }}>运行至源码地址</button>
          <button disabled={!selection} onClick={() => setSelection(undefined)}>取消源码选择</button>
        </div>
        <p>只运行到所选地址的指令执行前；不表示整条 C 语句完成。预算、暂停、已有断点和观察点仍有效，其他停止原因可能先发生。选择或查看地址不会修改 PC。</p>
      </div>
      <div className="sdcc-source" ref={scroller} data-source-file={filename}>
        {source.split(/\r\n|\n|\r/).map((text, index) => {
          const line = index + 1;
          const addresses = byLine.get(line) ?? [];
          const configured = addresses.filter(address => config.breakpoints.includes(address));
          const enabled = configured.filter(address => config.breakpointOptions?.find(item => item.address === address)?.enabled !== false);
          return <div key={line} className={[current.includes(line) ? "source-current" : "", target?.line === line ? "source-selected" : ""].join(" ")} data-source-line={line}>
            <button disabled={disabled || checking || !addresses.length} aria-label={`切换源码第 ${line} 行断点`} aria-pressed={addresses.length > 0 && configured.length === addresses.length}
              onClick={() => onToggleLine(addresses)}>{configured.length ? "●" : "○"}</button>
            <code>{line}</code><pre>{text || " "}</pre>
            <span aria-label={`源码第 ${line} 行地址`}>{addresses.length ? addresses.map((address, addressIndex) => <Fragment key={address}>{addressIndex > 0 && ", "}<button
              aria-label={`选择源码第 ${line} 行地址 ${hex16(address)}`} aria-pressed={target?.line === line && target.address === address}
              disabled={disabled || checking} onClick={() => setSelection({ data: verified.data, file: filename, line, address })}>{hex16(address)}</button></Fragment>) : "—"}{configured.length ? ` · 启用 ${enabled.length}/${addresses.length}` : ""}</span>
          </div>;
        })}
      </div>
      <p className="asm-hashes">固件 SHA-256 {verified.firmwareSha256}</p>
    </>}
  </section>;
}
