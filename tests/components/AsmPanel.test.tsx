import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AsmPanel } from "../../src/components/AsmPanel";
afterEach(cleanup);
const props = () => ({ project: { name: "main.asm", source: "NOP\r\n  MOV A,#bad" }, diagnostics: [{ line: 2, column: 10, message: "未定义符号 BAD" }], building: false, disabled: false, status: "构建失败", onProject: vi.fn(), onBuild: vi.fn(), onCancel: vi.fn(), onLoad: vi.fn(), onNew: vi.fn() });
it("locates diagnostics at a real source character and blocks loading without successful bytes", () => {
  render(<AsmPanel {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: /第 2 行，第 10 列/ }));
  const source = screen.getByLabelText("ASM 源码") as HTMLTextAreaElement;
  expect(source).toHaveFocus();
  expect(source.value.slice(source.selectionStart, source.selectionEnd)).toBe("b");
  expect(screen.getByText("加载构建产物")).toBeDisabled();
  expect(screen.getByText("导出 BIN")).toBeDisabled();
});
it("disables repeated builds but keeps cancellation and editing available during compilation", () => {
  const p = props();
  render(<AsmPanel {...p} building />);
  expect(screen.getByText("构建 ASM")).toBeDisabled();
  expect(screen.getByLabelText("ASM 源码")).toBeEnabled();
  fireEvent.click(screen.getByText("取消构建"));
  expect(p.onCancel).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("ASM 源码"), { target: { value: "NOP" } });
  expect(p.onProject).toHaveBeenCalledWith({ name: "main.asm", source: "NOP" });
});

it("ignores an asynchronous source import if execution became active before the read finished", async () => {
  const { act } = await import("@testing-library/react");
  const p = props();
  let resolve!: (bytes: ArrayBuffer) => void;
  const file = new File(["NOP"], "new.asm");
  Object.defineProperty(file, "arrayBuffer", { value: () => new Promise<ArrayBuffer>(yes => { resolve = yes; }) });
  const { rerender } = render(<AsmPanel {...p} />);
  fireEvent.change(screen.getByLabelText("导入 ASM 源码"), { target: { files: [file] } });
  rerender(<AsmPanel {...p} disabled />);
  await act(async () => resolve(new TextEncoder().encode("NOP").buffer));
  expect(p.onProject).not.toHaveBeenCalled();
});
