import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SdccSourcePanel } from "../../src/components/SdccSourcePanel";
import { sdccFixture } from "../fixtures/sdcc-fixture";
const verified = { data: sdccFixture("flow", "sdcc-flow"), firmware: new ArrayBuffer(1), firmwareSha256: "a".repeat(64), locations: [{ line: 3, address: 0xa8 }, { line: 3, address: 0xaa }, { line: 3, address: 0xb2 }] };
afterEach(cleanup);
it("shows partial disabled state, expands all addresses, and blocks changes while running", () => {
  const toggle = vi.fn();
  const props = { verified, pc: 0xa8, checking: false, disabled: false, config: { breakpoints: [0xa8], breakpointOptions: [{ address: 0xa8, enabled: false, hitCount: 2 }], watchpoints: [] }, onFiles: vi.fn(), onToggleLine: toggle };
  const { rerender } = render(<SdccSourcePanel {...props} />);
  expect(screen.getByLabelText("源码第 3 行地址")).toHaveTextContent("启用 0/3");
  fireEvent.click(screen.getByRole("button", { name: "切换源码第 3 行断点" }));
  expect(toggle).toHaveBeenCalledWith([0xa8, 0xaa, 0xb2]);
  expect(screen.getByRole("button", { name: "切换源码第 2 行断点" })).toBeDisabled();
  rerender(<SdccSourcePanel {...props} disabled />);
  expect(screen.getByRole("button", { name: "切换源码第 3 行断点" })).toBeDisabled();
  expect(screen.getByLabelText("导入 SDCC 构建文件")).toBeDisabled();
});
