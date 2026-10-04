import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const load = async (page: Page, bytes: number[], name = "feature.bin") => {
  await page.goto("/");
  await page.getByTestId("firmware-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await expect(page.locator(".control-strip").getByRole("button", { name: "运行" })).toBeEnabled();
};

const navigate = (page: Page, name: string) => page.locator(".desktop-nav").getByRole("button", { name }).click();

test("HEX 解码、真实反汇编与无效 HEX 保留当前工作区", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("firmware-input").setInputFiles({ name: "program.hex", mimeType: "text/plain", buffer: Buffer.from(":04000000741280FEF8\n:00000001FF\n") });
  await expect(page.getByTestId("current-instruction")).toContainText("MOV A,#0x12");
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-A")).toContainText("12");
  await expect(page.getByTestId("current-instruction")).toContainText("0002");
  await page.getByTestId("workbench-firmware-input").setInputFiles({ name: "broken.hex", mimeType: "text/plain", buffer: Buffer.from(":04000000741280FEF9\n:00000001FF\n") });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("firmware-name")).toContainText("program.hex");
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await page.reload();
  await expect(page.getByTestId("firmware-name")).toContainText("program.hex");
  await expect(page.getByTestId("register-PC")).toContainText("0002");
});

test("断点暂停后恢复执行，并保存调试配置", async ({ page }) => {
  await load(page, [0x74, 0, 0x04, 0x80, 0xfd]);
  await page.getByRole("textbox", { name: "断点地址" }).fill("0002");
  await page.getByRole("button", { name: "添加断点" }).click();
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await expect(page.locator(".footer-status")).toHaveText("断点暂停 · PC=0002");
  await expect(page.getByTestId("register-A")).toContainText("00");
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await expect(page.getByTestId("register-A")).toContainText("01");
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await page.reload();
  await expect(page.getByRole("button", { name: "删除断点 0002" })).toBeVisible();
  await expect(page.getByTestId("register-A")).toContainText("01");
});

test("写入监视点、暂停编辑和内存边界读取", async ({ page }) => {
  await load(page, [0x75, 0x20, 1, 0x75, 0x20, 2, 0x80, 0xfe]);
  await page.getByRole("button", { name: "添加监视点" }).click();
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await expect(page.locator(".footer-status")).toHaveText("监视点暂停 · IRAM 0020");
  await expect(page.getByTestId("register-PC")).toContainText("0003");
  await page.getByLabel("编辑寄存器").selectOption("ACC");
  await page.getByLabel("寄存器新值").fill("42");
  await page.getByRole("button", { name: "写入寄存器" }).click();
  await expect(page.getByTestId("register-A")).toContainText("42");
  await navigate(page, "SYS_MEM");
  await page.getByRole("button", { name: "IRAM", exact: true }).click();
  await page.getByLabel("写入内存值").fill("AA");
  await page.getByRole("button", { name: "写入字节" }).click();
  await expect(page.locator(".memory-row").filter({ hasText: "0020" })).toContainText("AA");
  await page.getByRole("button", { name: "SFR", exact: true }).click();
  await page.getByLabel("写入内存地址").fill("84");
  await expect(page.getByRole("button", { name: "写入字节" })).toBeDisabled();
  await page.getByRole("button", { name: "XRAM", exact: true }).click();
  await page.getByLabel("内存起始地址").fill("FFFF");
  await page.getByRole("button", { name: "REFRESH" }).click();
  await expect(page.locator(".memory-row")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("步过子程序调用与运行至指定地址", async ({ page }) => {
  await load(page, [0x12, 0, 6, 0x80, 0xfe, 0, 0x04, 0x22]);
  await page.getByRole("button", { name: "步过" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0003");
  await expect(page.getByTestId("register-A")).toContainText("01");
  await page.getByRole("button", { name: "复位" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.getByLabel("断点地址").fill("0006");
  await page.getByRole("button", { name: "运行至地址" }).click();
  await expect(page.locator(".footer-status")).toHaveText("已运行至地址 0006");
  await expect(page.getByTestId("register-PC")).toContainText("0006");
});

test("连续运行时注入 GPIO 与 UART RX 并显示 TX", async ({ page }) => {
  // UART mode 0 echo: wait RI, copy SBUF to TX, clear RI, repeat.
  await load(page, [0x75, 0x98, 0x10, 0x30, 0x98, 0xfd, 0xe5, 0x99, 0xf5, 0x99, 0xc2, 0x98, 0x80, 0xf5]);
  await page.getByLabel("最大执行单元").fill("100000000");
  await page.getByRole("checkbox", { name: "CAPTURE_TRACE" }).uncheck();
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await navigate(page, "I/O_PORTS");
  await page.getByRole("button", { name: "P1.0 外部输入", exact: true }).click();
  await expect(page.getByTestId("port-1-pins")).toHaveText("FE");
  await page.getByLabel("串口接收字节").fill("41");
  await page.getByRole("button", { name: "接收字节" }).click();
  await expect(page.getByTestId("serial-output")).toContainText("41");
  await expect(page.getByTestId("serial-output")).toContainText("A");
  await navigate(page, "BIN_INSPECTOR");
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByRole("button", { name: "单步" })).toBeEnabled();
  await page.reload();
  await navigate(page, "I/O_PORTS");
  await expect(page.getByTestId("serial-output")).toContainText("41");
  await expect(page.getByTestId("port-1-pins")).toHaveText("FE");
});

test("工作区导出与校验后导入恢复 CPU 和断点", async ({ page }) => {
  await load(page, [0x74, 0x2a, 0x80, 0xfe], "portable.bin");
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await page.getByLabel("断点地址").fill("0002");
  await page.getByRole("button", { name: "添加断点" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工作区" }).click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(file).toBeTruthy();
  const text = await readFile(file!, "utf8");
  expect(JSON.parse(text).schemaVersion).toBe(2);
  await page.getByRole("button", { name: "复位" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  const corrupted = JSON.parse(text);
  corrupted.firmware.bytes[0] = 0;
  await page.getByTestId("workspace-input").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(corrupted)) });
  await expect(page.getByRole("alert")).toContainText("SHA-256");
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.getByTestId("workspace-input").setInputFiles({ name: "portable.emuc51.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await expect(page.getByTestId("register-A")).toContainText("2A");
  await expect(page.getByRole("button", { name: "删除断点 0002" })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("register-PC")).toContainText("0002");
});

test("UART 模式 2 使用 RX 第 9 位过滤 SM2 接收", async ({ page }) => {
  await load(page, [0x75, 0x98, 0xb0, 0x30, 0x98, 0xfd, 0xe5, 0x99, 0xf5, 0x99, 0xc2, 0x98, 0x80, 0xf5]);
  await page.getByLabel("最大执行单元").fill("100000000");
  await page.getByRole("checkbox", { name: "CAPTURE_TRACE" }).uncheck();
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await navigate(page, "I/O_PORTS");
  const ninth = page.getByRole("checkbox", { name: /RX 第 9 位/ });
  await ninth.uncheck();
  await page.getByLabel("串口接收字节").fill("41");
  await page.getByRole("button", { name: "接收字节" }).click();
  await ninth.check();
  await page.getByLabel("串口接收字节").fill("42");
  await page.getByRole("button", { name: "接收字节" }).click();
  await expect(page.getByTestId("serial-output")).toContainText("42");
  await expect(page.getByTestId("serial-output")).not.toContainText("41");
  await navigate(page, "BIN_INSPECTOR");
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByRole("button", { name: "单步" })).toBeEnabled();
});

test("清除本地工作区后刷新不重新保存旧快照", async ({ page }) => {
  await load(page, [0, 0x80, 0xfd]);
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0001");
  await page.getByRole("button", { name: "CLEAR_LOCAL" }).click();
  await expect(page.getByTestId("firmware-name")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("firmware-name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "单步" })).toBeDisabled();
});

test("移动端调试、GPIO 和内存视图不产生页面横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page, [0, 0x80, 0xfd]);
  for (const name of ["CODE", "MEM", "I/O"]) {
    await page.locator(".mobile-nav").getByRole("button", { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.locator(".mobile-nav").getByRole("button", { name: "CODE", exact: true }).click();
  await expect(page.getByTestId("workbench-firmware-input")).toBeAttached();
  await expect(page.getByRole("button", { name: "导出工作区" })).toBeVisible();
  await expect(page.getByRole("button", { name: "CLEAR_LOCAL" })).toBeVisible();
});
