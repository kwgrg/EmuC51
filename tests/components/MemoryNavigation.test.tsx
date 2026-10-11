import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryNavigation } from "../../src/components/MemoryNavigation";

afterEach(cleanup);

describe("MemoryNavigation", () => {
  it("keeps edits local, cancels with Escape and accepts full hex on submit", () => {
    const navigate = vi.fn();
    render(<MemoryNavigation space="code" address={0} disabled={false} onNavigate={navigate} />);
    const input = screen.getByLabelText("内存起始地址");
    fireEvent.change(input, { target: { value: "0100" } });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("0000");
    fireEvent.change(input, { target: { value: " 0x100 " } });
    fireEvent.submit(input.closest("form")!);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(256);
    expect(input).toHaveValue("0100");
  });

  it.each(["", "12gg", "10000", "-1", "0x", "1.5"])("rejects invalid address %s without navigation", (value) => {
    const navigate = vi.fn();
    render(<MemoryNavigation space="code" address={0} disabled={false} onNavigate={navigate} />);
    const input = screen.getByLabelText("内存起始地址");
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form")!);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "REFRESH" })).toBeDisabled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["iram", 0, "80"], ["sfr", 0x80, "7F"], ["sfr", 0x80, "100"],
  ] as const)("validates the %s memory bounds", (space, address, value) => {
    const navigate = vi.fn();
    render(<MemoryNavigation space={space} address={address} disabled={false} onNavigate={navigate} />);
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    const input = screen.getByLabelText("内存起始地址");
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form")!);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("clamps backward paging at the start and disables forward paging at the end", () => {
    const navigate = vi.fn();
    const { rerender } = render(<MemoryNavigation space="xram" address={0x40} disabled={false} onNavigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(navigate).toHaveBeenLastCalledWith(0);
    rerender(<MemoryNavigation key="end" space="xram" address={0xffff} disabled={false} onNavigate={navigate} />);
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(navigate).toHaveBeenLastCalledWith(0xfeff);
  });

  it("blocks form submission while no firmware is ready", () => {
    const navigate = vi.fn();
    render(<MemoryNavigation space="code" address={0} disabled onNavigate={navigate} />);
    fireEvent.submit(screen.getByLabelText("内存起始地址").closest("form")!);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("内存起始地址")).toBeDisabled();
  });
});
