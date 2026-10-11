import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const editor = (page: Page) => page.goto("/#editor");
const io = (page: Page) => page.goto("/#io");
async function build(page: Page) {
  await page.getByRole("button", { name: "构建 ASM", exact: true }).click();
  await expect(page.getByTestId("asm-status")).toContainText("构建成功");
}
async function prepareAsm(page: Page) {
  await editor(page); await page.getByRole("button", { name: "新建 ASM 示例" }).click();
  await page.getByLabel("ASM 源码", { exact: true }).fill(await readFile("src/examples/scenario-timer-uart.asm", "utf8"));
  await build(page); await page.getByRole("button", { name: "加载构建产物" }).click();
  await expect(page.getByTestId("asm-status")).toContainText("当前源码与已加载 ASM 固件匹配");
}
async function sdcc(page: Page) {
  await page.getByLabel("导入 SDCC 构建文件").setInputFiles(["emuc51-sdcc.json", "symbols.c", "symbols.ihx", "symbols.cdb"].map(name => `tests/fixtures/sdcc-symbols/${name}`));
  await expect(page.getByTestId("sdcc-status")).toContainText("已校验文件摘要 · symbols.c");
}
async function run(page: Page, budget = "1500") {
  await page.getByLabel("最大执行单元").fill(budget);
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
}
async function snapshot(page: Page) {
  const next = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工作区", exact: true }).click();
  return JSON.parse(await readFile((await (await next).path())!, "utf8"));
}
test("发布交叉回归：ASM 重放与断点/访问点/覆盖，经 SDCC 切换后恢复同一 CPU", async ({ page }) => {
  test.setTimeout(60000);
  await prepareAsm(page);
  await page.getByLabel("记录指令覆盖").check();
  await page.getByLabel("断点地址").fill("0040"); await page.getByRole("button", { name: "添加断点", exact: true }).click();
  await page.getByLabel("CPU 访问地址", { exact: true }).fill("30");
  await page.getByRole("button", { name: "添加 CPU 访问观察点", exact: true }).click();
  await io(page); await page.getByRole("button", { name: "准备示例场景", exact: true }).click();
  await expect(page.getByTestId("scenario-status")).toContainText("调度未启用");
  await page.getByRole("button", { name: "从干净复位重放" }).click();
  await expect(page.getByTestId("scenario-status")).toContainText("重放已启用");
  await editor(page); await run(page);
  await expect(page.locator(".footer-status")).toContainText("断点暂停 · PC=0040");
  await page.getByRole("button", { name: "删除断点 0040", exact: true }).click();
  await run(page); await expect(page.locator(".footer-status")).toContainText("DATA 0030");
  await page.getByRole("button", { name: "删除 CPU 访问观察点 DATA 0030 读写", exact: true }).click();
  await run(page); await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  const saved = await snapshot(page);
  expect(saved.cpu.iram.slice(0x30, 0x34)).toEqual([1, 31, 66, 2]);
  const next = page.waitForEvent("download"); await page.getByRole("button", { name: "导出覆盖报告" }).click();
  const report = JSON.parse(await readFile((await (await next).path())!, "utf8"));
  expect(report.firmware.sha256).toBe(saved.firmware.sha256); expect(report.summary.instructions).toBeGreaterThan(0);
  await page.getByRole("button", { name: "采样热点" }).click();
  await expect(page.getByLabel("覆盖报告采样")).toContainText(saved.firmware.sha256);
  const source = await page.getByLabel("ASM 源码", { exact: true }).inputValue();
  await page.getByLabel("ASM 源码", { exact: true }).fill(source + "\n; edited after replay");
  await expect(page.getByTestId("asm-symbol")).toHaveCount(0);
  await expect(page.locator(".control-strip").getByRole("button", { name: "运行" })).toBeDisabled();
  await sdcc(page); await expect(page.getByLabel("覆盖报告采样")).toHaveCount(0);
  await expect(page.getByTestId("coverage-summary")).toContainText("记录已关闭 · 成功指令 0 次");
  await io(page); await expect(page.getByTestId("scenario-status")).toHaveText("未准备场景");
  await editor(page); await run(page, "1000"); await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  await page.getByRole("button", { name: "观察 CDB::symbols::G$count16$0_0$0", exact: true }).click();
  await expect(page.getByTestId("symbol-integer")).toHaveText("4660");
  await page.getByTestId("workspace-input").setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)) });
  await expect(page.getByTestId("register-PC")).toContainText(saved.cpu.pc.toString(16).padStart(4, "0").toUpperCase());
  await expect(page.getByTestId("symbol-integer")).toHaveCount(0); await expect(page.getByTestId("asm-symbol")).toHaveCount(0);
  expect((await snapshot(page)).cpu).toEqual(saved.cpu);
  await io(page); await expect(page.getByTestId("scenario-status")).toContainText("调度未启用 · 已投递 0/4");
  await editor(page); await build(page); await expect(page.getByTestId("asm-symbol")).not.toHaveCount(0);
  await expect(page.getByTestId("coverage-summary")).toContainText("记录已关闭 · 成功指令 0 次");
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state", "saved"); await page.reload();
  await expect(page.getByTestId("register-PC")).toContainText(saved.cpu.pc.toString(16).padStart(4, "0").toUpperCase());
  await expect(page.getByTestId("asm-symbol")).toHaveCount(0);
  expect((await snapshot(page)).cpu).toEqual(saved.cpu);
});

test("发布交叉回归：晚到报告与符号样本、取消的场景读取不污染替换后的工作区", async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    const Native = window.Worker, descriptor = Object.getOwnPropertyDescriptor(Native.prototype, "onmessage")!;
    let heldType = "";
    window.addEventListener("hold-result", event => { heldType = (event as CustomEvent<string>).detail; delete document.documentElement.dataset.heldResult; });
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); if (options?.name !== "emuc51-core") return;
        Object.defineProperty(this, "onmessage", { set: (handler: (event: MessageEvent) => void) => {
          descriptor.set!.call(this, (event: MessageEvent) => {
            if (event.data.type === heldType) {
              heldType = ""; document.documentElement.dataset.heldResult = event.data.type;
              window.addEventListener("release-result", () => handler(event), { once: true });
            } else handler(event);
          });
        } });
      }
    };
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "delayed-scenario.json") return original.call(this);
      return new Promise(resolve => window.addEventListener("release-scenario-file", () => { void original.call(this).then(resolve); }, { once: true }));
    };
  });
  await prepareAsm(page); const asm = await snapshot(page);
  await page.getByLabel("记录指令覆盖").check(); await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0040");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("hold-result", { detail: "CoverageReportCreated" })));
  await page.getByRole("button", { name: "导出覆盖报告" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-held-result", "CoverageReportCreated");
  await expect(page.getByRole("button", { name: "导出覆盖报告" })).toBeDisabled();
  let unexpectedDownloads = 0; page.on("download", () => { unexpectedDownloads++; });
  await sdcc(page); await page.evaluate(() => window.dispatchEvent(new Event("release-result")));
  await expect(page.getByLabel("覆盖报告采样")).toHaveCount(0);
  await page.getByRole("button", { name: "采样热点" }).click();
  await expect(page.getByLabel("覆盖报告采样")).toContainText("symbols.ihx");
  expect(unexpectedDownloads).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("hold-result", { detail: "WatchResults" })));
  await page.getByRole("button", { name: "观察 CDB::symbols::G$count16$0_0$0", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-held-result", "WatchResults");
  await page.getByTestId("workspace-input").setInputFiles({ name: "asm.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(asm)) });
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.evaluate(() => window.dispatchEvent(new Event("release-result")));
  await expect(page.getByTestId("symbol-integer")).toHaveCount(0); await expect(page.getByLabel("覆盖报告采样")).toHaveCount(0);
  await build(page); await io(page);
  const definition = await readFile("src/examples/scenario-timer-uart.json", "utf8");
  await page.getByLabel("导入场景 JSON", { exact: true }).setInputFiles({ name: "delayed-scenario.json", mimeType: "application/json", buffer: Buffer.from(definition) });
  await page.getByRole("button", { name: "取消输入重放" }).click();
  await page.getByRole("button", { name: "准备示例场景", exact: true }).click();
  await expect(page.getByTestId("scenario-status")).toContainText("调度未启用");
  await editor(page); await sdcc(page);
  await page.evaluate(() => window.dispatchEvent(new Event("release-scenario-file")));
  await io(page); await expect(page.getByTestId("scenario-status")).toHaveText("未准备场景");
  await editor(page); const restored = await snapshot(page);
  expect(restored.settings.inputScenario).toBeUndefined(); expect(restored.settings.sdccDebug.manifest.files.source.name).toBe("symbols.c");
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state", "saved"); await page.reload();
  await expect(page.getByTestId("sdcc-status")).toContainText("已校验文件摘要 · symbols.c");
  await io(page); await expect(page.getByTestId("scenario-status")).toHaveText("未准备场景");
});
