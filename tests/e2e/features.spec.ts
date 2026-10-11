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
  expect(JSON.parse(text).schemaVersion).toBe(3);
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

test("内存地址草稿不重新标记旧数据，支持取消、翻页和边界校验", async ({ page }) => {
  const bytes = Array.from({ length: 513 }, (_, index) => index === 256 ? 0x42 : 0x11);
  await load(page, bytes);
  await navigate(page, "SYS_MEM");
  const address = page.getByLabel("内存起始地址");
  const firstRow = page.locator(".memory-row").first();
  await expect(firstRow).toContainText("11 11");
  await address.fill("0100");
  await expect(firstRow.locator(".memory-address")).toHaveText("0000");
  await address.press("Escape");
  await expect(address).toHaveValue("0000");
  await address.fill("0x100");
  await address.press("Enter");
  await expect(firstRow.locator(".memory-address")).toHaveText("0100");
  await expect(firstRow).toContainText("42 11");
  for (let repeat = 0; repeat < 2; repeat += 1) {
    await page.getByRole("button", { name: "REFRESH" }).click();
    await expect(firstRow).toContainText("42 11");
  }
  await address.fill("0200");
  await navigate(page, "BIN_INSPECTOR");
  await navigate(page, "SYS_MEM");
  await expect(address).toHaveValue("0100");
  await expect(firstRow).toContainText("42 11");
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(address).toHaveValue("0200");
  await page.getByRole("button", { name: "上一页" }).click();
  await expect(firstRow).toContainText("42 11");
  for (const invalid of ["", "12zz", "10000", "-1"]) {
    await address.fill(invalid);
    await expect(address).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "REFRESH" })).toBeDisabled();
    await address.press("Enter");
    await expect(firstRow.locator(".memory-address")).toHaveText("0100");
  }
  await page.getByRole("button", { name: "IRAM", exact: true }).click();
  await expect(address).toHaveValue("0000");
  await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
  await address.fill("80");
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "SFR", exact: true }).click();
  await expect(address).toHaveValue("0080");
  await address.fill("7F");
  await expect(page.getByRole("button", { name: "REFRESH" })).toBeDisabled();
  await page.getByRole("button", { name: "XRAM", exact: true }).click();
  await address.fill("FFFF");
  await address.press("Enter");
  await expect(page.locator(".memory-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
});

test("内存视图按 PSW 显示寄存器组，哈希导航刷新寄存器写入", async ({ page }) => {
  await load(page, [0]);
  await navigate(page, "SYS_MEM");
  await page.getByRole("button", { name: "IRAM", exact: true }).click();
  await navigate(page, "BIN_INSPECTOR");
  await page.getByLabel("编辑寄存器").selectOption("PSW");
  await page.getByLabel("寄存器新值").fill("18");
  await page.getByRole("button", { name: "写入寄存器" }).click();
  await expect(page.getByTestId("register-PSW")).toContainText("18");
  await page.getByLabel("编辑寄存器").selectOption("R0");
  await page.getByLabel("寄存器新值").fill("AB");
  await page.getByRole("button", { name: "写入寄存器" }).click();
  await expect(page.locator(".register-bank")).toContainText("AB");
  await page.evaluate(() => { window.location.hash = "memory"; });
  await expect(page.locator(".bank-card .panel-bar")).toContainText("BANK3");
  await expect(page.locator(".memory-row").filter({ has: page.locator(".memory-address", { hasText: "0010" }) })).toContainText("AB");
});

test("反汇编独立浏览、行断点持久化与运行至指令", async ({ page }) => {
  await load(page, [0x74, 0x42, 0x04, 0x80, 0xfe]);
  const address = page.getByLabel("反汇编起始地址");
  const firstRow = page.getByTestId("disassembly-list").locator(":scope > div").first();
  await address.fill("0100");
  await expect(firstRow).toHaveAttribute("data-address", "0000");
  await address.press("Escape");
  await expect(address).toHaveValue("0000");
  await address.fill("0x100");
  await address.press("Enter");
  await expect(firstRow).toHaveAttribute("data-address", "0100");
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await expect(firstRow).toHaveAttribute("data-address", "0100");
  await address.fill("12zz");
  await expect(page.getByRole("button", { name: "查看地址" })).toBeDisabled();
  await page.getByRole("button", { name: "跟随 PC", exact: true }).click();
  await expect(firstRow).toHaveAttribute("data-address", "0002");
  await page.getByRole("button", { name: "切换断点 0003" }).click();
  await expect(page.getByRole("button", { name: "删除断点 0003" })).toBeVisible();
  await page.getByRole("button", { name: "切换断点 0003" }).click();
  await expect(page.getByRole("button", { name: "删除断点 0003" })).toHaveCount(0);
  await page.getByRole("button", { name: "切换断点 0003" }).click();
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await expect(page.locator(".footer-status")).toHaveText("断点暂停 · PC=0003");
  await expect(page.getByTestId("register-A")).toContainText("43");
  await page.reload();
  await expect(page.getByRole("button", { name: "切换断点 0003" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "复位" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.getByRole("button", { name: "运行至指令 0002" }).click();
  await expect(page.locator(".footer-status")).toHaveText("已运行至地址 0002");
  await expect(page.getByTestId("register-A")).toContainText("42");
  await page.getByRole("button", { name: "运行至指令 0002" }).click();
  await expect(page.getByTestId("register-A")).toContainText("42");
  await page.getByRole("button", { name: "后续指令" }).click();
  await page.getByRole("button", { name: "返回上个地址" }).click();
  await expect(firstRow).toHaveAttribute("data-address", "0002");
  await address.fill("FFFF");
  await address.press("Enter");
  await expect(firstRow).toHaveAttribute("data-address", "FFFF");
  await expect(page.getByTestId("disassembly-list").locator('[data-address="0000"]')).toContainText("MOV A,#0x42");
  await navigate(page, "SYS_MEM");
  await navigate(page, "BIN_INSPECTOR");
  await expect(page.getByRole("button", { name: "跟随 PC", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("workbench-firmware-input").setInputFiles({ name: "replacement.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0x74, 0x99]) });
  await expect(page.getByTestId("current-instruction")).toContainText("MOV A,#0x99");
});

test("断点启停、每 N 次命中、计数重置及工作区往返", async ({ page }) => {
  await load(page, [0x04, 0x80, 0xfd]);
  await page.getByRole("button", { name: "切换断点 0000" }).click();
  const count = page.getByLabel("断点 0000 命中次数");
  await count.fill("0");
  await expect(page.getByRole("button", { name: "应用断点 0000" })).toBeDisabled();
  await count.press("Escape");
  await expect(count).toHaveValue("1");
  await count.fill("3");
  await count.press("Enter");
  const runButton = page.locator(".control-strip").getByRole("button", { name: "运行" });
  await runButton.click();
  await expect(page.locator(".footer-status")).toHaveText("断点暂停 · PC=0000");
  await expect(page.getByTestId("register-A")).toContainText("02");
  await runButton.click();
  await expect(page.getByTestId("register-A")).toContainText("05");
  await page.getByLabel("启用断点 0000").uncheck();
  await expect(page.getByRole("button", { name: "切换断点 0000" })).toHaveAttribute("data-enabled", "false");
  await page.getByLabel("最大执行单元").fill("2");
  await runButton.click();
  await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  await expect(page.getByTestId("register-A")).toContainText("06");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工作区" }).click();
  const download = await downloadPromise;
  const portable = await readFile((await download.path())!, "utf8");
  expect(JSON.parse(portable).schemaVersion).toBe(3);
  expect(JSON.parse(portable).coreStateVersion).toBe(2);
  await page.reload();
  await expect(page.getByLabel("启用断点 0000")).not.toBeChecked();
  await expect(count).toHaveValue("3");
  await page.getByLabel("启用断点 0000").check();
  await page.getByLabel("最大执行单元").fill("100");
  await runButton.click();
  await expect(page.getByTestId("register-A")).toContainText("08");
  await page.getByRole("button", { name: "复位" }).click();
  await expect(page.getByTestId("register-A")).toContainText("00");
  await runButton.click();
  await expect(page.getByTestId("register-A")).toContainText("02");
  await page.getByTestId("workspace-input").setInputFiles({ name: "counted.json", mimeType: "application/json", buffer: Buffer.from(portable) });
  await expect(page.getByTestId("register-A")).toContainText("06");
  await expect(page.getByLabel("启用断点 0000")).not.toBeChecked();
  await page.getByRole("button", { name: "切换断点 0000" }).click();
  await expect(page.getByLabel("启用断点 0000")).toHaveCount(0);
  await page.getByRole("button", { name: "切换断点 0000" }).click();
  await expect(page.getByLabel("启用断点 0000")).toBeChecked();
  await expect(count).toHaveValue("1");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("可信调用帧与跳出，刷新后不虚构历史", async ({ page }) => {
  await load(page, [0x12, 0, 4, 0, 0x12, 0, 8, 0x22, 0x04, 0x22]);
  const out = page.getByRole("button", { name: "跳出", exact: false });
  await expect(out).toBeDisabled();
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("call-frame")).toHaveCount(1);
  await expect(page.getByTestId("call-frame")).toContainText("返回 0003");
  await out.click();
  await expect(page.getByTestId("register-PC")).toContainText("0003");
  await expect(page.getByTestId("register-A")).toContainText("01");
  await expect(page.getByTestId("call-frame")).toHaveCount(0);
  await expect(out).toBeDisabled();
  await page.getByRole("button", { name: "复位" }).click();
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("call-frame")).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("register-PC")).toContainText("0004");
  await expect(page.getByTestId("call-stack")).toContainText("快照不含调用历史");
  await expect(page.getByTestId("call-frame")).toHaveCount(0);
  await expect(out).toBeDisabled();
  await page.getByRole("button", { name: "单步" }).click(); // New inner frame above unknown history.
  await expect(page.getByTestId("call-frame")).toHaveCount(1);
  await out.click();
  await expect(page.getByTestId("register-PC")).toContainText("0007");
  await expect(page.getByTestId("call-stack")).toContainText("快照不含调用历史");
  await expect(out).toBeDisabled();
});

test("跳出支持预算和暂停，手动改写返回槽后停止提供跳出", async ({ page }) => {
  await load(page, [0x12, 0, 4, 0, 0x80, 0xfe]);
  await page.getByRole("button", { name: "单步" }).click();
  const out = page.getByRole("button", { name: "跳出", exact: false });
  await page.getByLabel("最大执行单元").fill("5");
  await out.click();
  await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  await expect(page.getByTestId("call-frame")).toHaveCount(1);
  await page.getByLabel("最大执行单元").fill("100000000");
  await page.getByRole("checkbox", { name: "CAPTURE_TRACE" }).uncheck();
  await out.click();
  await expect(out).toBeDisabled();
  await navigate(page, "SYS_MEM");
  await navigate(page, "BIN_INSPECTOR");
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(out).toBeEnabled();
  await navigate(page, "SYS_MEM");
  await page.getByRole("button", { name: "IRAM", exact: true }).click();
  await page.getByLabel("写入内存地址").fill("08");
  await page.getByLabel("写入内存值").fill("03");
  await page.getByRole("button", { name: "写入字节" }).click();
  await navigate(page, "BIN_INSPECTOR");
  await expect(page.getByTestId("call-stack")).toContainText("返回地址槽被写入");
  await expect(out).toBeDisabled();
  await page.getByRole("button", { name: "复位" }).click();
  await expect(page.getByTestId("call-stack")).toContainText("从复位开始追踪");
});

test("Watch 表达式独立报错、刷新、取消、导航和重新载入", async ({ page }) => {
  await load(page, [0x74, 0x12, 0x80, 0xfe]);
  await navigate(page, "SYS_MEM");
  const input = page.getByLabel("观察表达式");
  const row = (expression: string) => page.getByTestId("watch-expression-row").filter({ has: page.locator("code", { hasText: new RegExp(`^${expression}$`) }) });
  for (const expression of ["ACC", "PC", "1/0", "CODE[0]"]) {
    await input.fill(expression);
    await input.press("Enter");
  }
  await expect(row("ACC")).toContainText("0 (0x0)");
  await expect(row("1/0")).toContainText("不能除以零");
  await expect(page.getByTestId("watch-expression-row").last()).toContainText("116 (0x74)");
  await input.fill("ACC");
  await expect(page.getByRole("button", { name: "添加观察" })).toBeDisabled();
  await input.press("Escape");
  await expect(input).toHaveValue("");
  await navigate(page, "BIN_INSPECTOR");
  await page.getByRole("button", { name: "单步" }).click();
  await navigate(page, "SYS_MEM");
  await expect(row("ACC")).toContainText("18 (0x12)");
  await expect(row("PC")).toContainText("2 (0x2)");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "刷新观察" }).click();
  await expect(row("ACC")).toContainText("18 (0x12)");
  await page.getByLabel("删除观察 1/0", { exact: true }).click();
  await expect(page.getByTestId("watch-expression-row")).toHaveCount(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const width of [375, 820, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/emuc51-watch-${width}.png`, fullPage: true });
  }
  // The fixed-height desktop panel must scroll its last row into view.
  await page.getByLabel("删除观察 CODE[0]", { exact: true }).click();
  const watchPanel = page.locator(".watch-card .panel-body");
  expect(await watchPanel.evaluate(node => getComputedStyle(node).overflowY)).toBe("auto");
  await expect(page.getByTestId("watch-expression-row")).toHaveCount(2);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByLabel("删除观察 ACC", { exact: true }).click();
  await input.fill("SP");
  await input.press("Enter");
  await expect(row("SP")).toContainText("7 (0x7)");
  await page.reload();
  await expect(page.getByLabel("观察表达式")).toBeVisible();
  await expect(page.getByTestId("watch-expression-row")).toHaveCount(2);
  await expect(row("SP")).toContainText("7 (0x7)");
});

test("调试会话恢复隔离草稿、旧结果和调用历史，导入同一固件恢复浏览上下文", async ({ page }) => {
  await load(page, [0x12, 0x00, 0x06, 0x80, 0xfb, 0x00, 0x04, 0x22]);
  await page.getByRole("button", { name: "切换断点 0000" }).click();
  await page.getByLabel("断点 0000 命中次数").fill("4");
  await page.getByLabel("断点 0000 命中次数").press("Enter");
  await page.getByLabel("启用断点 0000").uncheck();
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByRole("button", { name: "跳出" })).toBeEnabled();
  await navigate(page, "SYS_MEM");
  for (const expression of ["ACC", "1/0"]) {
    await page.getByLabel("观察表达式").fill(expression);
    await page.getByLabel("观察表达式").press("Enter");
  }
  await page.getByLabel("内存起始地址").fill("0010");
  await page.getByLabel("内存起始地址").press("Enter");
  await page.getByLabel("内存起始地址").fill("0030"); // unconfirmed draft
  await page.reload();
  await expect(page.getByLabel("内存起始地址")).toHaveValue("0010");
  await expect(page.getByTestId("watch-expression-row")).toHaveCount(2);
  await expect(page.getByTestId("watch-expression-row").last()).toContainText("不能除以零");
  await navigate(page, "BIN_INSPECTOR");
  await expect(page.getByRole("button", { name: "跳出" })).toBeDisabled();
  await expect(page.getByLabel("启用断点 0000")).not.toBeChecked();
  await expect(page.getByLabel("断点 0000 命中次数")).toHaveValue("4");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工作区" }).click();
  const portable = await readFile((await (await downloadPromise).path())!, "utf8");
  const saved = JSON.parse(portable);
  expect(saved.settings.watchExpressions).toEqual(["ACC", "1/0"]);
  expect(saved.settings.memoryAddress).toBe(16);
  expect(saved.cpu.callStack).toBeUndefined();
  await page.getByLabel("反汇编起始地址").fill("0040");
  await page.getByLabel("反汇编起始地址").press("Enter");
  await page.getByTestId("workspace-input").setInputFiles({ name: "same.json", mimeType: "application/json", buffer: Buffer.from(portable) });
  await expect(page.getByRole("button", { name: "跟随 PC" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("反汇编起始地址")).toHaveValue("0006");
  await navigate(page, "SYS_MEM");
  await page.getByLabel("内存起始地址").fill("0020");
  await page.getByLabel("内存起始地址").press("Enter");
  await page.getByLabel("删除观察 ACC", { exact: true }).click();
  await navigate(page, "BIN_INSPECTOR");
  const invalid = { ...saved, settings: { ...saved.settings, watchExpressions: Array(33).fill("PC") } };
  await page.getByTestId("workspace-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("register-PC")).toContainText("0006");
  await navigate(page, "SYS_MEM");
  await expect(page.getByLabel("内存起始地址")).toHaveValue("0020");
  await expect(page.getByTestId("watch-expression-row")).toHaveCount(1);
  await navigate(page, "BIN_INSPECTOR");
  await page.getByTestId("workspace-input").setInputFiles({ name: "same.json", mimeType: "application/json", buffer: Buffer.from(portable) });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "复位" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.getByTestId("workbench-firmware-input").setInputFiles({ name: "replacement.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0x74, 0x55, 0x80, 0xfe]) });
  await expect(page.getByTestId("firmware-name")).toContainText("replacement.bin");
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-A")).toContainText("55");
  await expect(page.getByLabel("启用断点 0000")).not.toBeChecked();
  await navigate(page, "SYS_MEM");
  await expect(page.getByLabel("内存起始地址")).toHaveValue("0010");
  await expect(page.getByTestId("watch-expression-row").first()).toContainText("85 (0x55)");
  // Legacy v2 import must replace the current list and use the space's default address.
  delete saved.settings.watchExpressions;
  delete saved.settings.memoryAddress;
  delete saved.settings.debugger.breakpointOptions;
  saved.schemaVersion = 2;
  saved.settings.selectedMemorySpace = "sfr";
  await navigate(page, "BIN_INSPECTOR");
  await page.getByTestId("workspace-input").setInputFiles({ name: "legacy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
  await expect(page.getByTestId("register-PC")).toContainText("0006");
  await navigate(page, "SYS_MEM");
  await expect(page.getByLabel("内存起始地址")).toHaveValue("0080");
  await expect(page.getByTestId("watch-expression-row")).toHaveCount(0);
});
