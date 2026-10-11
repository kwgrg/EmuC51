import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const paths = (stem = "main", directory = "sdcc-counter") => ["emuc51-sdcc.json", `${stem}.c`, `${stem}.ihx`, `${stem}.cdb`].map(name => `tests/fixtures/${directory}/${name}`);
const importBundle = async (page: Page, stem = "main", directory = "sdcc-counter") => {
  await page.getByLabel("导入 SDCC 构建文件").setInputFiles(paths(stem, directory));
  await expect(page.getByTestId("sdcc-status")).toContainText(`已校验文件摘要 · ${stem}.c`);
  await expect(page.getByRole("button", { name: "单步" })).toBeEnabled();
};
test("真实 SDCC 源码定位、共享地址断点、运行暂停、导航及刷新恢复", async ({ page }) => {
  await page.goto("/#editor"); await importBundle(page);
  await expect(page.getByTestId("sdcc-location")).toContainText("无精确源码行映射");
  const line3 = page.getByRole("button", { name: "切换源码第 3 行断点" });
  const line4 = page.getByRole("button", { name: "切换源码第 4 行断点" });
  await line3.click(); await expect(line4).toHaveAttribute("aria-pressed", "true");
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("00A8");
  await expect(page.getByTestId("sdcc-location")).toContainText("第 3、4 行");
  await line4.click(); await expect(line3).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "切换源码第 6 行断点" }).click();
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("00AB");
  await expect(page.getByTestId("sdcc-location")).toContainText("第 6 行");
  await page.getByRole("button", { name: "定位当前源码行" }).click();
  for (const width of [375, 820, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/emuc51-sdcc-${width}.png`, fullPage: true });
  }
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state", "saved");
  await page.goto("/#memory"); await page.goto("/#editor");
  await expect(page.getByTestId("sdcc-location")).toContainText("第 6 行");
  await page.reload();
  await expect(page.getByTestId("sdcc-location")).toContainText("第 6 行");
  await expect(page.getByRole("button", { name: "切换源码第 6 行断点" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("sdcc-location")).toContainText("第 7 行");
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("00B0");
  await expect(page.getByTestId("sdcc-location")).toContainText("无精确源码行映射");
});
test("一行多个地址全部切换；工作区可携带源码，篡改和缺失文件不替换当前状态", async ({ page }) => {
  await page.goto("/#editor"); await importBundle(page, "flow", "sdcc-flow");
  await expect(page.getByLabel("源码第 3 行地址")).toContainText("00A8, 00AA, 00B2");
  const line = page.getByRole("button", { name: "切换源码第 3 行断点" });
  await line.click(); await expect(page.getByLabel("源码第 3 行地址")).toContainText("启用 3/3");
  await line.click(); await expect(line).toHaveAttribute("aria-pressed", "false");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工作区" }).click();
  const portable = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const tampered = structuredClone(portable); tampered.settings.sdccDebug.source += "\n";
  await page.getByTestId("workspace-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(tampered)) });
  await expect(page.getByRole("alert")).toContainText("SHA-256");
  await expect(page.getByTestId("sdcc-status")).toContainText("flow.c");
  await page.getByLabel("导入 SDCC 构建文件").setInputFiles(paths().slice(1));
  await expect(page.getByRole("alert")).toContainText("四个");
  await expect(page.getByTestId("sdcc-status")).toContainText("flow.c");
  await page.getByTestId("workbench-firmware-input").setInputFiles({ name: "external.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0]) });
  await expect(page.getByTestId("sdcc-location")).toHaveCount(0);
  await expect(page.getByTestId("sdcc-status")).toContainText("尚未导入");
  await page.getByTestId("workspace-input").setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(portable)) });
  await expect(page.getByTestId("sdcc-status")).toContainText("flow.c");
});
test("新固件加载使尚未完成的 SDCC 导入失效", async ({ page }) => {
  await page.goto("/#editor");
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === "main.c") await new Promise<void>(resolve => window.addEventListener("release-sdcc", () => resolve(), { once: true }));
      return read.call(this);
    };
  });
  await page.getByLabel("导入 SDCC 构建文件").setInputFiles(paths());
  await expect(page.getByTestId("sdcc-status")).toContainText("正在校验");
  await expect(page.getByLabel("导入 SDCC 构建文件")).toBeDisabled();
  await page.getByTestId("workbench-firmware-input").setInputFiles({ name: "new.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0]) });
  await expect(page.getByTestId("firmware-name")).toContainText("new.bin");
  await page.evaluate(() => window.dispatchEvent(new Event("release-sdcc")));
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0001");
  await expect(page.getByTestId("firmware-name")).toContainText("new.bin");
  await expect(page.getByTestId("sdcc-location")).toHaveCount(0);
});

test("取消导入后可以重新选择，已取消文件不能覆盖新构建", async ({ page }) => {
  await page.goto("/#editor");
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === "main.c") await new Promise<void>(resolve => window.addEventListener("release-cancelled-sdcc", () => resolve(), { once: true }));
      return read.call(this);
    };
  });
  await page.getByLabel("导入 SDCC 构建文件").setInputFiles(paths());
  await expect(page.getByLabel("导入 SDCC 构建文件")).toBeDisabled();
  await page.getByRole("button", { name: "取消 SDCC 导入" }).click();
  await expect(page.getByLabel("导入 SDCC 构建文件")).toBeEnabled();
  await importBundle(page, "flow", "sdcc-flow");
  await page.evaluate(() => window.dispatchEvent(new Event("release-cancelled-sdcc")));
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("sdcc-status")).toContainText("flow.c");
  await expect(page.getByTestId("firmware-name")).toContainText("flow.ihx");
});
