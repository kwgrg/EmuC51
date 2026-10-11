import type { CoverageReport } from "../../src/core/coverage";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CoveragePanel } from "../../src/components/CoveragePanel";
afterEach(cleanup);

it("starts off and explains the instruction-only scope, supports toggle and clear", () => {
  const onEnable = vi.fn();
  const onClear = vi.fn();
  render(<CoveragePanel disabled={false} onEnable={onEnable} onClear={onClear} />);
  expect(screen.getByLabelText("记录指令覆盖")).not.toBeChecked();
  expect(screen.getByTestId("coverage-summary")).toHaveTextContent("成功指令 0 次 · 起始地址 0 个");
  fireEvent.click(screen.getByLabelText("记录指令覆盖"));
  expect(onEnable).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByText("清除覆盖记录"));
  expect(onClear).toHaveBeenCalledOnce();
});
it("disables actions before firmware is ready and distinguishes frozen/saturated counts", () => {
  render(<CoveragePanel disabled summary={{ enabled: false, epoch: 3, instructions: 10, uniqueAddresses: 2, saturated: true }} onEnable={vi.fn()} onClear={vi.fn()} />);
  expect(screen.getByLabelText("记录指令覆盖")).toBeDisabled();
  expect(screen.getByText("清除覆盖记录")).toBeDisabled();
  expect(screen.getByTestId("coverage-summary")).toHaveTextContent("记录已关闭 · 成功指令 10 次 · 起始地址 2 个 · 部分计数达到上限");
});

it("shows at most 20 deterministic hotspots, keeps sampled totals distinct, hides stale epochs", () => {
  const summary = { enabled: true, epoch: 3, instructions: 24, uniqueAddresses: 23, saturated: false };
  const report: CoverageReport = { format: "emuc51-instruction-coverage", version: 1, scope: "successful-instruction-starts",
    firmware: { name: "test.bin", sha256: "a".repeat(64), byteLength: 32 }, capturedAt: "2026-10-11T00:00:00Z", pc: 0, steps: 24,
    summary, entries: Array.from({ length: 23 }, (_, address) => ({ address, count: address === 22 ? 2 : 1 })) };
  const onNavigate = vi.fn();
  const onSample = vi.fn();
  const props = { disabled: false, onEnable: vi.fn(), onClear: vi.fn(), report, onNavigate, onSample };
  const { rerender } = render(<CoveragePanel {...props} summary={{ ...summary, instructions: 100 }} />);
  const buttons = screen.getAllByRole("button", { name: /查看覆盖热点/ });
  expect(buttons).toHaveLength(20);
  expect(buttons[0]).toHaveTextContent("0016");
  expect(buttons[1]).toHaveTextContent("0000");
  expect(report.entries[0]?.address).toBe(0);
  expect(screen.getByLabelText("覆盖报告采样")).toHaveTextContent("成功指令 24 次");
  fireEvent.click(buttons[0]!);
  expect(onNavigate).toHaveBeenCalledWith(22);
  fireEvent.click(screen.getByText("导出覆盖报告"));
  expect(onSample).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByText("采样热点"));
  expect(onSample).toHaveBeenLastCalledWith(false);
  rerender(<CoveragePanel {...props} summary={summary} pending />);
  expect(screen.getByText("导出覆盖报告")).toBeDisabled();
  expect(screen.getByText("采样热点")).toBeDisabled();
  expect(screen.getByText("清除覆盖记录")).toBeEnabled();
  rerender(<CoveragePanel {...props} summary={{ ...summary, epoch: 4 }} />);
  expect(screen.queryByLabelText("覆盖报告采样")).not.toBeInTheDocument();
});
