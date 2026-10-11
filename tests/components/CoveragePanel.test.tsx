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
