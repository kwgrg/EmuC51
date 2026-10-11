import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WatchPanel } from "../../src/components/WatchPanel";
afterEach(cleanup);

it("trims additions, blocks duplicates, cancels drafts and removes only the selected row", () => {
  const onChange = vi.fn();
  render(<WatchPanel expressions={["PC", "ACC"]} disabled={false} onChange={onChange} onRefresh={vi.fn()} />);
  const input = screen.getByLabelText("观察表达式");
  fireEvent.change(input, { target: { value: " PC " } });
  expect(screen.getByText("添加观察")).toBeDisabled();
  fireEvent.change(input, { target: { value: " IRAM[0] " } });
  fireEvent.submit(input.closest("form")!);
  expect(onChange).toHaveBeenLastCalledWith(["PC", "ACC", "IRAM[0]"]);
  fireEvent.change(input, { target: { value: "discard" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("");
  fireEvent.click(screen.getByLabelText("删除观察 PC"));
  expect(onChange).toHaveBeenLastCalledWith(["ACC"]);
});

it("renders full integers and errors without mislabeling stale results", () => {
  render(<WatchPanel expressions={["big", "negative", "bad", "new"]} disabled={false} onChange={vi.fn()} onRefresh={vi.fn()}
    sample={{ pc: 0, steps: 1, results: [{ expression: "big", value: 4294967296 }, { expression: "negative", value: -7 }, { expression: "bad", error: "不能除以零" }, { expression: "old", value: 99 }] }} />);
  expect(screen.getByText("4294967296 (0x100000000)")).toBeVisible();
  expect(screen.getByText("-7 (-0x7)")).toBeVisible();
  expect(screen.getByText("不能除以零")).toBeVisible();
  expect(screen.queryByText("99 (0x63)")).not.toBeInTheDocument();
});

it.each([true, false])("limits additions with disabled=%s", disabled => {
  render(<WatchPanel expressions={disabled ? [] : Array.from({ length: 32 }, (_, i) => String(i))} disabled={disabled} onChange={vi.fn()} onRefresh={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("观察表达式"), { target: { value: "PC" } });
  expect(screen.getByText("添加观察")).toBeDisabled();
});
