import { useMemo, useState } from "react";
import type { AsmArtifact } from "../core/assembler";
import type { DebugConfig } from "../core/debugger";
import { hex16 } from "../core/numbers";

const PAGE_SIZE = 100;
/** Only mounted for a freshly built artifact verified against the loaded firmware. */
export function AsmSourcePanel({ artifact, pc, disabled, config, onToggle, onBrowse, onRunTo }: {
  artifact: AsmArtifact; pc?: number; disabled: boolean; config: DebugConfig;
  onToggle: (address: number) => void; onBrowse: (address: number) => void; onRunTo: (address: number) => void;
}) {
  const [page, setPage] = useState(0);
  const lines = useMemo(() => artifact.project.source.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/), [artifact]);
  const byLine = useMemo(() => new Map(artifact.sourceMap.map(item => [item.line, item])), [artifact]);
  const current = artifact.sourceMap.find(item => item.kind === "instruction" && item.address === pc);
  const pages = Math.ceil(lines.length / PAGE_SIZE);
  return <section className="asm-source-debug" aria-label="ASM 源码调试">
    <h3>ASM 源码调试</h3>
    <p data-testid="asm-location">PC {hex16(pc ?? 0)} · {current ? `${artifact.project.name} 第 ${current.line} 行` : "无精确指令行映射（数据、操作数字节和地址空隙不推断）"}</p>
    <div className="asm-actions">
      <button disabled={!current} onClick={() => current && setPage(Math.floor((current.line - 1) / PAGE_SIZE))}>定位当前 ASM 行</button>
      <button disabled={page === 0} onClick={() => setPage(value => value - 1)}>ASM 上一页</button>
      <span data-testid="asm-source-page">{page + 1} / {pages}</span>
      <button disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>ASM 下一页</button>
    </div>
    <p>仅指令起始地址可设行断点；沿用地址断点的启停、条件和次数。查看不修改 PC；运行至行在该指令执行前停止，仍受预算及其他断点/观察点约束。</p>
    <div className="asm-source-list">
      {lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((text, index) => {
        const line = page * PAGE_SIZE + index + 1, location = byLine.get(line);
        const executable = location?.kind === "instruction";
        const configured = executable && config.breakpoints.includes(location.address);
        const enabled = configured && config.breakpointOptions?.find(item => item.address === location.address)?.enabled !== false;
        return <div className={`asm-source-row ${current?.line === line ? "source-current" : ""}`} key={line} data-asm-line={line}>
          <button disabled={disabled || !executable} aria-label={`切换 ASM 第 ${line} 行断点`} aria-pressed={Boolean(configured)}
            title={configured ? enabled ? "地址断点已启用" : "地址断点已禁用" : "添加地址断点"} onClick={() => executable && onToggle(location.address)}>{configured ? enabled ? "●" : "◐" : "○"}</button>
          <code>{line}</code><pre>{text || " "}</pre>
          <span>{location ? `${hex16(location.address)}${executable ? "" : " 数据"}` : "—"}</span>
          <div className="asm-actions">
            <button disabled={disabled || !executable} aria-label={`查看 ASM 第 ${line} 行汇编`} onClick={() => executable && onBrowse(location.address)}>查看</button>
            <button disabled={disabled || !executable} aria-label={`运行至 ASM 第 ${line} 行`} onClick={() => executable && onRunTo(location.address)}>运行至</button>
          </div>
        </div>;
      })}
    </div>
  </section>;
}
