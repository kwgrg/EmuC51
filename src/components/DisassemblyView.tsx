import type { CoverageSummary } from "../core/coverage";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BreakpointOptions } from "../core/debugger";
import { disassemble } from "../core/disassembler";
import { hex16, hex8, u16 } from "../core/numbers";
import { parseHex } from "./DebuggerPanel";

export function DisassemblyView({ program, pc, breakpoints, breakpointOptions, disabled, running, onToggleBreakpoint, onRunTo, coverage, coverageSample, onReadCoverage }: {
  coverage?: CoverageSummary;
  coverageSample?: { summary: CoverageSummary; addresses: number[]; counts: number[] };
  onReadCoverage?: (addresses: number[]) => void;
  program: ArrayBuffer;
  pc: number;
  breakpoints: number[];
  breakpointOptions?: BreakpointOptions[];
  disabled: boolean;
  running: boolean;
  onToggleBreakpoint: (address: number) => void;
  onRunTo: (address: number) => void;
}) {
  const [pinnedAddress, setPinnedAddress] = useState<number>();
  const [draft, setDraft] = useState<string>();
  const [history, setHistory] = useState<number[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const address = pinnedAddress ?? pc;
  const input = draft ?? hex16(address);
  const parsed = parseHex(input, 0xffff);
  const rows = useMemo(() => disassemble(new Uint8Array(program), address, 80), [program, address]);
  const addressesRef = useRef<number[]>([]);
  useEffect(() => { addressesRef.current = rows.map(row => row.address); }, [rows]);
  const pausedInstructions = running ? undefined : coverage?.instructions;
  const visibleCoverage = coverage && (coverage.enabled || coverage.instructions > 0);
  const counts = useMemo(() => new Map(coverageSample?.summary.epoch === coverage?.epoch
    ? coverageSample?.addresses.map((address, index) => [address, coverageSample.counts[index]!]) : []), [coverageSample, coverage?.epoch]);
  useEffect(() => {
    if (disabled || !onReadCoverage || !visibleCoverage) return;
    const read = () => onReadCoverage(addressesRef.current);
    read();
    if (running && coverage.enabled) {
      const timer = setInterval(read, 250);
      return () => clearInterval(timer);
    }
  }, [disabled, onReadCoverage, running, coverage?.enabled, coverage?.epoch, pausedInstructions, visibleCoverage]);
  useEffect(() => {
    if (!disabled && !running && visibleCoverage) onReadCoverage?.(rows.map(row => row.address));
  }, [disabled, running, rows, visibleCoverage, onReadCoverage]);
  const last = rows[rows.length - 1]!;
  const navigate = (next: number) => {
    if (next !== address) setHistory((current) => [...current, address].slice(-64));
    setPinnedAddress(next);
    setDraft(undefined);
  };
  const followPc = () => {
    setPinnedAddress(undefined);
    setDraft(undefined);
    setHistory([]);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [address]);

  return <>
    <form className="disassembly-toolbar" onSubmit={(event) => {
      event.preventDefault();
      if (!disabled && parsed !== undefined) navigate(parsed);
    }}>
      <label>CODE (HEX)
        <input aria-label="反汇编起始地址" aria-invalid={parsed === undefined}
          disabled={disabled} value={input} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setDraft(undefined); }
          }} />
      </label>
      <button disabled={disabled || parsed === undefined}>查看地址</button>
      <button type="button" disabled={disabled} aria-pressed={pinnedAddress === undefined} onClick={followPc}>跟随 PC</button>
      <button type="button" disabled={disabled || history.length === 0} onClick={() => {
        const previous = history[history.length - 1];
        if (previous === undefined) return;
        setHistory((current) => current.slice(0, -1));
        setPinnedAddress(previous);
        setDraft(undefined);
      }}>返回上个地址</button>
      <button type="button" disabled={disabled} onClick={() => navigate(u16(last.address + last.length))}>后续指令</button>
      <small>{pinnedAddress === undefined ? "跟随执行位置" : "固定浏览位置"} · PC {hex16(pc)}</small>
    </form>
    <div className="source-scroll" ref={scrollRef}>
      <div className={`source-lines disassembly-lines${visibleCoverage ? " with-coverage" : ""}`} data-testid="disassembly-list">
        {rows.map((item) => {
          const breakpoint = breakpoints.includes(item.address);
          const enabled = breakpointOptions?.find((option) => option.address === item.address)?.enabled ?? true;
          return <div className={item.address === pc ? "current" : ""}
            data-testid={item.address === pc ? "current-instruction" : undefined}
            data-address={hex16(item.address)} key={item.address}>
            <button type="button" className="breakpoint-toggle" aria-label={`切换断点 ${hex16(item.address)}`}
              aria-pressed={breakpoint} data-enabled={breakpoint && enabled} title={breakpoint ? (enabled ? "移除断点" : "移除已禁用断点") : "添加断点"}
              disabled={disabled || running || (!breakpoint && breakpoints.length >= 1024)}
              onClick={() => onToggleBreakpoint(item.address)}>{breakpoint ? (enabled ? "●" : "◌") : "○"}</button>
            <code>{hex16(item.address)}</code>
            <code>{item.bytes.map(hex8).join(" ")}</code>
            <strong>{item.text}</strong>
            {visibleCoverage && <code className="instruction-hits" aria-label={`地址 ${hex16(item.address)} 执行次数`} title="最近采样的成功执行次数；仅指令起始地址">{counts.has(item.address) ? `${counts.get(item.address) === 0xffffffff ? "≥" : ""}${counts.get(item.address)}` : "…"}</code>}
            <button type="button" className="run-to-line" aria-label={`运行至指令 ${hex16(item.address)}`}
              disabled={disabled || running} onClick={() => onRunTo(item.address)}>运行至此</button>
          </div>;
        })}
      </div>
    </div>
  </>;
}
