import { useState } from "react";
import { MAX_EXPRESSION_LENGTH, MAX_WATCH_EXPRESSIONS, type WatchResult } from "../core/expressions";
import { hex16 } from "../core/numbers";

export function WatchPanel({ expressions, sample, disabled, onChange, onRefresh }: {
  expressions: string[];
  sample?: { results: WatchResult[]; pc: number; steps: number };
  disabled: boolean;
  onChange: (expressions: string[]) => void;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState("");
  const normalized = draft.trim();
  const duplicate = expressions.includes(normalized);
  const addable = !disabled && normalized.length > 0 && normalized.length <= MAX_EXPRESSION_LENGTH && !duplicate && expressions.length < MAX_WATCH_EXPRESSIONS;
  return <div className="expression-watch">
    <form onSubmit={(event) => { event.preventDefault(); if (addable) { onChange([...expressions, normalized]); setDraft(""); } }}>
      <label>只读表达式<input aria-label="观察表达式" value={draft} maxLength={MAX_EXPRESSION_LENGTH} placeholder="XRAM[DPTR] + ACC"
        onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setDraft(""); } }} /></label>
      <button disabled={!addable}>添加观察</button>
      <button type="button" disabled={disabled || expressions.length === 0} onClick={onRefresh}>刷新观察</button>
    </form>
    {duplicate && <small>该表达式已在列表中</small>}
    <p>十进制 / 0x 十六进制；PC、DPTR、R0–R7、SFR 名称；IRAM[]、SFR[]、XRAM[]、CODE[]。</p>
    <p>支持 + − * / %、&amp; | ^ ~、&lt;&lt; &gt;&gt; 和括号。SFR 为锁存值；列表仅本次会话保留。</p>
    <small data-testid="watch-sample">{sample && !disabled ? `采样 PC ${hex16(sample.pc)} · ${sample.steps} 条指令` : "等待采样"}</small>
    {expressions.map((expression, index) => {
      const result = !disabled && sample?.results[index]?.expression === expression ? sample.results[index] : undefined;
      return <div className="expression-row" data-testid="watch-expression-row" key={expression}>
        <code>{expression}</code>
        <output>{result?.error ?? (result?.value !== undefined ? `${result.value} (${result.value < 0 ? "-" : ""}0x${Math.abs(result.value).toString(16).toUpperCase()})` : "…")}</output>
        <button aria-label={`删除观察 ${expression}`} onClick={() => onChange(expressions.filter((_, i) => i !== index))}>×</button>
      </div>;
    })}
  </div>;
}
