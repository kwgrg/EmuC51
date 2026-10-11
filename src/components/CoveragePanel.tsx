import { coverageHotspots, type CoverageReport, type CoverageSummary } from "../core/coverage";
import { useMemo } from "react";
import { hex16 } from "../core/numbers";

export function CoveragePanel({ summary, disabled, onEnable, onClear, report, pending, onSample, onNavigate }: {
  report?: CoverageReport;
  pending?: boolean;
  onSample?: (download: boolean) => void;
  onNavigate?: (address: number) => void;
  summary?: CoverageSummary;
  disabled: boolean;
  onEnable: (enabled: boolean) => void;
  onClear: () => void;
}) {
  const visibleReport = report?.summary.epoch === summary?.epoch ? report : undefined;
  const hotspots = useMemo(() => visibleReport ? coverageHotspots(visibleReport) : [], [visibleReport]);
  return <div className="coverage-panel">
    <label><input type="checkbox" aria-label="记录指令覆盖" checked={summary?.enabled ?? false} disabled={disabled}
      onChange={event => onEnable(event.target.checked)} />记录指令覆盖</label>
    <button disabled={disabled} onClick={onClear}>清除覆盖记录</button>
    <button disabled={disabled || pending || !onSample} onClick={() => onSample?.(false)}>采样热点</button>
    <button disabled={disabled || pending || !onSample} onClick={() => onSample?.(true)}>导出覆盖报告</button>
    {pending && <span role="status">正在采样…</span>}
    <output data-testid="coverage-summary">{summary?.enabled ? "正在记录" : "记录已关闭"} · 成功指令 {summary?.instructions ?? 0} 次 · 起始地址 {summary?.uniqueAddresses ?? 0} 个{summary?.saturated ? " · 部分计数达到上限" : ""}</output>
    {visibleReport && <section className="coverage-report" aria-label="覆盖报告采样">
      <p>固定采样 · 代次 {visibleReport.summary.epoch} · CPU 执行单元 {visibleReport.steps} · PC {hex16(visibleReport.pc)} · 成功指令 {visibleReport.summary.instructions} 次</p>
      <p className="coverage-identity">{visibleReport.firmware.name} · SHA-256 {visibleReport.firmware.sha256}</p>
      <p>热点前 20 项（次数降序，同次数按地址升序）。运行期间不自动刷新；点击地址仅浏览反汇编。</p>
      {hotspots.length ? <ol className="coverage-hotspots">{hotspots.map(entry => <li key={entry.address}>
        <button disabled={disabled} aria-label={`查看覆盖热点 ${hex16(entry.address)}`} onClick={() => onNavigate?.(entry.address)}>{hex16(entry.address)}</button>
        <span>{entry.count === 0xffffffff ? "≥" : ""}{entry.count} 次</span>
      </li>)}</ol> : <p>采样时尚无指令执行记录。</p>}
    </section>}
    <p>默认关闭，仅统计成功执行的指令起始地址，不是字节、源码或分支覆盖率。停用保留记录；复位清零；加载/恢复清零并关闭。记录仅限本次会话。</p>
  </div>;
}
