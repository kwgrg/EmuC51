import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DebuggerPanel } from "../../src/components/DebuggerPanel";

afterEach(cleanup);
const config = { breakpoints: [2], watchpoints: [], breakpointOptions: [{ address: 2, enabled: true, hitCount: 3 }] };

describe("breakpoint controls", () => {
  it("validates decimal counts and cancels draft changes without editing settings", () => {
    const onChange = vi.fn();
    render(<DebuggerPanel config={config} disabled={false} onChange={onChange} onRunTo={vi.fn()} />);
    const input = screen.getByLabelText("断点 0002 命中次数");
    for (const value of ["", "0", "-1", "1.5", "2x", "100000001"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(input.closest("form")!);
      expect(screen.getByRole("button", { name: "应用断点 0002" })).toBeDisabled();
    }
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("3");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.submit(input.closest("form")!);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...config, breakpointOptions: [{ address: 2, enabled: true, hitCount: 5 }] });
  });

  it("disables without losing the threshold and removes associated options on deletion", () => {
    const onChange = vi.fn();
    render(<DebuggerPanel config={config} disabled={false} onChange={onChange} onRunTo={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("启用断点 0002"));
    expect(onChange).toHaveBeenLastCalledWith({ ...config, breakpointOptions: [{ address: 2, enabled: false, hitCount: 3 }] });
    fireEvent.click(screen.getByRole("button", { name: "删除断点 0002" }));
    expect(onChange).toHaveBeenLastCalledWith({ breakpoints: [], watchpoints: [], breakpointOptions: [] });
  });

  it("does not mutate configuration via a disabled form submission", () => {
    const onChange = vi.fn();
    render(<DebuggerPanel config={config} disabled onChange={onChange} onRunTo={vi.fn()} />);
    fireEvent.submit(screen.getByLabelText("断点 0002 命中次数").closest("form")!);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("启用断点 0002")).toBeDisabled();
  });
});
