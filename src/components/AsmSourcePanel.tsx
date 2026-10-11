import { useMemo, useState } from "react";
import type { AsmArtifact } from "../core/assembler";
import type { DebugConfig } from "../core/debugger";
import { hex16 } from "../core/numbers";

const PAGE_SIZE = 100;
/** Only mounted for a freshly built artifact verified against the loaded firmware. */
export function AsmSourcePanel({ artifact, pc, disabled, config, onToggle, onBrowse, onRunTo, onBrowseMemory }: {
  artifact: AsmArtifact; pc?: number; disabled: boolean; config: DebugConfig;
  onBrowseMemory:(address:number)=>void;
  onToggle: (address: number) => void; onBrowse: (address: number) => void; onRunTo: (address: number) => void;
}) {
  const [page, setPage] = useState(0);
  const [labelPage,setLabelPage]=useState(0), [query,setQuery]=useState("");
  const labels=useMemo(()=>artifact.labels.filter(label=>label.name.includes(query.trim().toUpperCase())),[artifact,query]);
  const lines = useMemo(() => artifact.project.source.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/), [artifact]);
  const byLine = useMemo(() => new Map(artifact.sourceMap.map(item => [item.line, item])), [artifact]);
  const current = artifact.sourceMap.find(item => item.kind === "instruction" && item.address === pc);
  const pages = Math.ceil(lines.length / PAGE_SIZE);
  return <section className="asm-source-debug" aria-label="ASM 源码调试">
    <h3>ASM 源码调试</h3>
    <section aria-label="ASM CODE 标签" className="symbol-panel">
      <h4>ASM CODE 标签</h4>
      <p>仅当前成功构建的冒号标签；EQU 和内置寄存器不是 CODE 标签。标签只表示地址，不推断函数长度。别名共享地址断点。</p>
      <label>筛选 ASM 标签<input aria-label="筛选 ASM 标签" maxLength={128} value={query} onChange={event=>{setQuery(event.target.value);setLabelPage(0);}} /></label>
      <div className="asm-actions"><button disabled={labelPage===0} onClick={()=>setLabelPage(labelPage-1)}>标签上一页</button><span>{labelPage+1} / {Math.max(1,Math.ceil(labels.length/50))} · {labels.length} 个标签</span><button disabled={(labelPage+1)*50>=labels.length} onClick={()=>setLabelPage(labelPage+1)}>标签下一页</button></div>
      <div className="symbol-list">{labels.slice(labelPage*50,(labelPage+1)*50).map(label=><div className="symbol-row" data-testid="asm-symbol" key={label.name}>
        <code>ASM::{artifact.project.name}::{label.name}</code>
        <span>CODE {hex16(label.address)} · 大小未知 · 第 {label.line} 行:{label.column} · {({instruction:"指令起始",data:"DB/DW 数据",operand:"操作数字节，不可设断点",unmapped:"未生成字节"})[label.kind]}</span>
        <div className="asm-actions">
          <button aria-label={`定位 ASM 标签 ${label.name}`} onClick={()=>setPage(Math.floor((label.line-1)/PAGE_SIZE))}>定位定义行</button>
          <button disabled={disabled||label.kind!=="instruction"} aria-label={`查看 ASM 标签 ${label.name} 汇编`} onClick={()=>onBrowse(label.address)}>查看汇编</button>
          <button disabled={disabled||label.kind==="unmapped"} aria-label={`查看 ASM 标签 ${label.name} CODE`} onClick={()=>onBrowseMemory(label.address)}>查看 CODE</button>
          <button disabled={disabled||label.kind!=="instruction"} aria-label={`切换 ASM 标签 ${label.name} 断点`} aria-pressed={config.breakpoints.includes(label.address)} onClick={()=>onToggle(label.address)}>断点</button>
        </div>
      </div>)}</div>
    </section>
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
