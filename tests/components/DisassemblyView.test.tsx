import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DisassemblyView } from "../../src/components/DisassemblyView";

afterEach(cleanup);
const props = () => ({
  program: Uint8Array.from([0x74, 0x42, 0x80, 0xfe]).buffer,
  pc: 0, breakpoints: [] as number[], disabled: false, running: false,
  onToggleBreakpoint: vi.fn(), onRunTo: vi.fn(),
});
const go = (value: string) => {
  const input = screen.getByLabelText("反汇编起始地址");
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form")!);
};
const firstRow = () => screen.getByTestId("disassembly-list").firstElementChild;

describe("DisassemblyView", () => {
  it("follows PC until an explicit address is submitted, then returns to following", () => {
    const p = props();
    const { rerender } = render(<DisassemblyView {...p} />);
    expect(firstRow()).toHaveTextContent("MOV A,#0x42");
    rerender(<DisassemblyView {...p} pc={2} />);
    expect(firstRow()).toHaveAttribute("data-address", "0002");
    go("0100");
    rerender(<DisassemblyView {...p} pc={3} />);
    expect(firstRow()).toHaveAttribute("data-address", "0100");
    expect(screen.queryByTestId("current-instruction")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "跟随 PC" }));
    expect(firstRow()).toHaveAttribute("data-address", "0003");
    expect(screen.getByRole("button", { name: "跟随 PC" })).toHaveAttribute("aria-pressed", "true");
  });

  it("supports cancellable drafts and rejects malformed or out-of-range addresses", () => {
    render(<DisassemblyView {...props()} />);
    const input = screen.getByLabelText("反汇编起始地址");
    for (const value of ["", "12gg", "10000", "-1"]) {
      go(value);
      expect(firstRow()).toHaveAttribute("data-address", "0000");
      expect(screen.getByRole("button", { name: "查看地址" })).toBeDisabled();
    }
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("0000");
    go(" 0x100 ");
    expect(firstRow()).toHaveAttribute("data-address", "0100");
    expect(input).toHaveValue("0100");
  });

  it("advances by decoded instruction boundaries and navigates back without guessing", () => {
    render(<DisassemblyView {...props()} />);
    expect(screen.getByRole("button", { name: "返回上个地址" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "后续指令" }));
    // Two 2-byte instructions and 78 NOPs, not 80 bytes.
    expect(firstRow()).toHaveAttribute("data-address", "0052");
    fireEvent.click(screen.getByRole("button", { name: "返回上个地址" }));
    expect(firstRow()).toHaveAttribute("data-address", "0000");
    expect(screen.getByRole("button", { name: "返回上个地址" })).toBeDisabled();
  });

  it("decodes wrapped operands and zero-filled CODE beyond the firmware", () => {
    const program = new Uint8Array(65536);
    program[65535] = 0x02;
    program.set([0x12, 0x34], 0);
    render(<DisassemblyView {...props()} program={program.buffer} />);
    go("FFFF");
    expect(firstRow()).toHaveTextContent("LJMP 0x1234");
    expect(firstRow()?.nextElementSibling).toHaveAttribute("data-address", "0002");
    go("F000");
    expect(firstRow()).toHaveTextContent("NOP");
  });

  it("uses exact instruction addresses for breakpoints and run-to without editing PC", () => {
    const p = props();
    const { rerender } = render(<DisassemblyView {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "切换断点 0002" }));
    expect(p.onToggleBreakpoint).toHaveBeenCalledExactlyOnceWith(2);
    rerender(<DisassemblyView {...p} breakpoints={[2]} />);
    expect(screen.getByRole("button", { name: "切换断点 0002" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "运行至指令 0002" }));
    expect(p.onRunTo).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("keeps browsing available while running but blocks debugger mutations", () => {
    const p = props();
    render(<DisassemblyView {...p} running />);
    go("0100");
    expect(firstRow()).toHaveAttribute("data-address", "0100");
    const toggle = screen.getByRole("button", { name: "切换断点 0100" });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "运行至指令 0100" })).toBeDisabled();
    expect(p.onToggleBreakpoint).not.toHaveBeenCalled();
  });

  it("allows removing existing breakpoints at the configuration limit", () => {
    const breakpoints = Array.from({ length: 1024 }, (_, i) => i);
    render(<DisassemblyView {...props()} breakpoints={breakpoints} />);
    expect(screen.getByRole("button", { name: "切换断点 0000" })).toBeEnabled();
    go("1000");
    expect(screen.getByRole("button", { name: "切换断点 1000" })).toBeDisabled();
  });

  it("blocks navigation while a replacement firmware is restoring", () => {
    render(<DisassemblyView {...props()} disabled />);
    go("0100");
    expect(firstRow()).toHaveAttribute("data-address", "0000");
    expect(screen.getByRole("button", { name: "运行至指令 0002" })).toBeDisabled();
  });
});

it("labels only sampled counts from the current coverage epoch", () => {
  const summary = { enabled: true, epoch: 2, instructions: 3, uniqueAddresses: 1, saturated: false };
  const p = props();
  const { rerender } = render(<DisassemblyView {...p} coverage={summary}
    coverageSample={{ summary, addresses: [0], counts: [3] }} />);
  expect(screen.getByLabelText("地址 0000 执行次数")).toHaveTextContent("3");
  rerender(<DisassemblyView {...p} coverage={{ ...summary, epoch: 3, instructions: 0 }}
    coverageSample={{ summary, addresses: [0], counts: [3] }} />);
  expect(screen.getByLabelText("地址 0000 执行次数")).toHaveTextContent("…");
});

it("polls only visible instruction starts at 250ms while running and stops on unmount", () => {
  vi.useFakeTimers();
  try {
    const summary = { enabled: true, epoch: 1, instructions: 0, uniqueAddresses: 0, saturated: false };
    const onReadCoverage = vi.fn();
    const p = props();
    const { rerender, unmount } = render(<DisassemblyView {...p} running coverage={summary} onReadCoverage={onReadCoverage} />);
    expect(onReadCoverage).toHaveBeenCalledTimes(1);
    expect(onReadCoverage.mock.calls[0]?.[0]).toHaveLength(80);
    vi.advanceTimersByTime(1000);
    expect(onReadCoverage).toHaveBeenCalledTimes(5);
    rerender(<DisassemblyView {...p} pc={0x100} running coverage={summary} onReadCoverage={onReadCoverage} />);
    vi.advanceTimersByTime(250);
    expect(onReadCoverage.mock.calls.at(-1)?.[0][0]).toBe(0x100);
    unmount();
    vi.advanceTimersByTime(1000);
    expect(onReadCoverage).toHaveBeenCalledTimes(6);
  } finally { vi.useRealTimers(); }
});

it("browses repeated hotspot requests without changing execution, supports history and cancelling drafts", () => {
  const p = props();
  const { rerender } = render(<DisassemblyView {...p} running />);
  fireEvent.change(screen.getByLabelText("反汇编起始地址"), { target: { value: "ffff" } });
  const request = { address: 2 };
  rerender(<DisassemblyView {...p} running browseRequest={request} />);
  expect(screen.getByLabelText("反汇编起始地址")).toHaveValue("0002");
  expect(screen.getByLabelText("反汇编起始地址")).toHaveFocus();
  rerender(<DisassemblyView {...p} pc={3} running browseRequest={request} />);
  expect(firstRow()).toHaveAttribute("data-address", "0002");
  expect(p.onRunTo).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("返回上个地址"));
  expect(firstRow()).toHaveAttribute("data-address", "0000");
  rerender(<DisassemblyView {...p} pc={3} running browseRequest={{ address: 2 }} />);
  expect(firstRow()).toHaveAttribute("data-address", "0002");
  fireEvent.click(screen.getByText("跟随 PC"));
  expect(firstRow()).toHaveAttribute("data-address", "0003");
});
