import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SdccSourcePanel } from "../../src/components/SdccSourcePanel";
import { sdccFixture } from "../fixtures/sdcc-fixture";
const verified = { data: sdccFixture("flow", "sdcc-flow"), firmware: new ArrayBuffer(1), firmwareSha256: "a".repeat(64), symbols: [], functions: [], locations: [{ line: 3, address: 0xa8 }, { line: 3, address: 0xaa }, { line: 3, address: 0xb2 }] };
afterEach(cleanup);
it("shows partial disabled state, expands all addresses, and blocks changes while running", () => {
  const toggle = vi.fn();
  const props = { verified, pc: 0xa8, checking: false, disabled: false, config: { breakpoints: [0xa8], breakpointOptions: [{ address: 0xa8, enabled: false, hitCount: 2 }], watchpoints: [] }, onFiles: vi.fn(), onToggleLine: toggle, onBrowseAddress: vi.fn(), onRunToAddress: vi.fn() };
  const { rerender } = render(<SdccSourcePanel {...props} />);
  expect(screen.getByLabelText("源码第 3 行地址")).toHaveTextContent("启用 0/3");
  fireEvent.click(screen.getByRole("button", { name: "切换源码第 3 行断点" }));
  expect(toggle).toHaveBeenCalledWith([0xa8, 0xaa, 0xb2]);
  expect(screen.getByRole("button", { name: "切换源码第 2 行断点" })).toBeDisabled();
  rerender(<SdccSourcePanel {...props} disabled />);
  expect(screen.getByRole("button", { name: "切换源码第 3 行断点" })).toBeDisabled();
  expect(screen.getByLabelText("导入 SDCC 构建文件")).toBeDisabled();
});

it("keeps source selection distinct from PC and invalidates it when verified input changes", () => {
  const browse = vi.fn(), run = vi.fn();
  const props = { verified, pc: 0xa8, checking: false, disabled: false, config: { breakpoints: [], watchpoints: [] }, onFiles: vi.fn(), onToggleLine: vi.fn(), onBrowseAddress: browse, onRunToAddress: run };
  const { rerender } = render(<SdccSourcePanel {...props} />);
  expect(screen.getByRole("button", { name: "运行至源码地址" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "选择源码第 3 行地址 00B2" }));
  expect(screen.getByTestId("sdcc-location")).toHaveTextContent("PC 00A8");
  fireEvent.click(screen.getByRole("button", { name: "查看目标汇编" })); expect(browse).toHaveBeenCalledWith(0xb2);
  fireEvent.click(screen.getByRole("button", { name: "运行至源码地址" })); expect(run).toHaveBeenCalledWith(0xb2);
  rerender(<SdccSourcePanel {...props} disabled />);
  expect(screen.getByRole("button", { name: "运行至源码地址" })).toBeDisabled();
  rerender(<SdccSourcePanel {...props} checking />);
  expect(screen.getByRole("button", { name: "查看目标汇编" })).toBeDisabled();
  rerender(<SdccSourcePanel {...props} verified={{ ...verified, data: sdccFixture("flow", "sdcc-flow") }} />);
  expect(screen.getByTestId("sdcc-target")).not.toHaveTextContent("已选");
  expect(screen.getByRole("button", { name: "运行至源码地址" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "选择源码第 3 行地址 00AA" }));
  fireEvent.click(screen.getByRole("button", { name: "取消源码选择" }));
  expect(screen.getByRole("button", { name: "运行至源码地址" })).toBeDisabled();
});
