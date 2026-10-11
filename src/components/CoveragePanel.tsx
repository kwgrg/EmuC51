import type { CoverageSummary } from "../core/coverage";

export function CoveragePanel({ summary, disabled, onEnable, onClear }: {
  summary?: CoverageSummary;
  disabled: boolean;
  onEnable: (enabled: boolean) => void;
  onClear: () => void;
}) {
  return <div className="coverage-panel">
    <label><input type="checkbox" aria-label="记录指令覆盖" checked={summary?.enabled ?? false} disabled={disabled}
      onChange={event => onEnable(event.target.checked)} />记录指令覆盖</label>
    <button disabled={disabled} onClick={onClear}>清除覆盖记录</button>
    <output data-testid="coverage-summary">{summary?.enabled ? "正在记录" : "记录已关闭"} · 成功指令 {summary?.instructions ?? 0} 次 · 起始地址 {summary?.uniqueAddresses ?? 0} 个{summary?.saturated ? " · 部分计数达到上限" : ""}</output>
    <p>默认关闭，仅统计成功执行的指令起始地址，不是字节、源码或分支覆盖率。停用保留记录；复位清零；加载/恢复清零并关闭。记录仅限本次会话。</p>
  </div>;
}
