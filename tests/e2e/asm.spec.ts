import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const start = async (page: Page) => {
  await page.goto("/#editor");
  await page.getByRole("button", { name: "新建 ASM 示例" }).click();
};
const build = async (page: Page) => {
  await page.getByRole("button", { name: "构建 ASM", exact: true }).click();
  await expect(page.getByTestId("asm-status")).toContainText("构建成功");
};
const load = async (page: Page) => {
  await page.getByRole("button", { name: "加载构建产物" }).click();
  await expect(page.getByTestId("asm-status")).toContainText("当前源码与已加载 ASM 固件匹配");
  await expect(page.locator(".control-strip").getByRole("button", { name: "运行" })).toBeEnabled();
};

test("ASM 编辑、定位错误、修复构建、运行和源码/固件导出", async ({ page }) => {
  await start(page);
  const editor = page.getByLabel("ASM 源码", { exact: true });
  await editor.fill("NOP\n  MOV A,#missing\nSJMP $");
  await page.getByRole("button", { name: "构建 ASM", exact: true }).click();
  await expect(page.getByTestId("asm-status")).toContainText("构建失败");
  await expect(page.getByRole("button", { name: "加载构建产物" })).toBeDisabled();
  await page.getByRole("button", { name: /第 2 行，第 10 列/ }).click();
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe("m");
  const source = "MOV A,#42h\nMOV P1,A\nSJMP $\n";
  await editor.fill(source);
  await build(page);
  const binaryDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 BIN", exact: true }).click();
  const binary = await readFile((await (await binaryDownload).path())!);
  expect([...binary]).toEqual([0x74,0x42,0xf5,0x90,0x80,0xfe]);
  await load(page);
  await page.getByRole("button", { name: "单步", exact: false }).click();
  await expect(page.getByTestId("register-A")).toContainText("42");
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  const sourceDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 ASM", exact: true }).click();
  expect(await readFile((await (await sourceDownload).path())!, "utf8")).toBe(source);
  const workspaceDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工作区" }).click();
  const workspace = JSON.parse(await readFile((await (await workspaceDownload).path())!, "utf8"));
  expect(workspace.settings.asmProject).toEqual({ name: "main.asm", source });
  expect(workspace.settings.asmBinding).toEqual({ assembler: "emuc51-asm-1", sourceSha256: createHash("sha256").update(source).digest("hex"), firmwareSha256: createHash("sha256").update(binary).digest("hex") });
  for (const width of [375, 820, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await editor.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/emuc51-asm-${width}.png`, fullPage: true });
  }
});

test("变更源码锁定旧 ASM 固件，失败和刷新不绕过，匹配重建可继续原 CPU", async ({ page }) => {
  await start(page);
  const original = "MOV A,#12h\nSJMP $";
  await page.getByLabel("ASM 源码", { exact: true }).fill(original);
  await build(page); await load(page);
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await page.getByLabel("ASM 源码", { exact: true }).fill("MOV A,#unknown");
  await expect(page.locator(".control-strip").getByRole("button", { name: "运行" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "单步" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "运行至指令 0002" })).toBeDisabled();
  await page.getByRole("button", { name: "构建 ASM", exact: true }).click();
  await expect(page.getByTestId("asm-status")).toContainText("构建失败");
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(page.getByLabel("ASM 源码", { exact: true })).toHaveValue("MOV A,#unknown");
  await expect(page.getByRole("button", { name: "单步" })).toBeDisabled();
  await page.getByLabel("ASM 源码", { exact: true }).fill(original);
  await build(page);
  await expect(page.getByRole("button", { name: "单步" })).toBeEnabled();
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await page.getByLabel("ASM 源码", { exact: true }).fill("MOV A,#34h\nSJMP $");
  await build(page);
  await expect(page.getByRole("button", { name: "单步" })).toBeDisabled();
  await load(page);
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-A")).toContainText("34");
});

test("无固件草稿本地恢复，源文件导入、工作区切换和不匹配产物保护", async ({ page }) => {
  await start(page);
  await page.getByLabel("导入 ASM 源码").setInputFiles({ name: "test.asm", mimeType: "text/plain", buffer: Buffer.from("MOV A,#1\r\nSJMP $\r\n") });
  await expect(page.getByLabel("ASM 源码", { exact: true })).toHaveValue("MOV A,#1\nSJMP $\n");
  await page.reload();
  await expect(page.getByLabel("ASM 源码", { exact: true })).toHaveValue("MOV A,#1\nSJMP $\n");
  await build(page); await load(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工作区" }).click();
  const portable = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  await page.getByTestId("workbench-firmware-input").setInputFiles({ name: "external.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0]) });
  await expect(page.getByTestId("asm-status")).toContainText("当前固件独立于 ASM 草稿");
  await expect(page.getByRole("button", { name: "单步" })).toBeEnabled();
  await page.getByTestId("workspace-input").setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(portable)) });
  await expect(page.getByTestId("firmware-name")).toContainText("test.bin");
  await expect(page.getByRole("button", { name: "单步" })).toBeDisabled();
  await build(page);
  await expect(page.getByRole("button", { name: "单步" })).toBeEnabled();
  const mismatch = structuredClone(portable);
  mismatch.settings.asmBinding.firmwareSha256 = "f".repeat(64);
  await page.getByTestId("workspace-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(mismatch)) });
  await expect(page.getByRole("alert")).toContainText("工作区文件无效");
  await expect(page.getByTestId("firmware-name")).toContainText("test.bin");
  const stale = structuredClone(portable);
  stale.settings.asmProject.source = "MOV A,#2\nSJMP $";
  await page.getByTestId("workspace-input").setInputFiles({ name: "dirty.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(stale)) });
  await build(page);
  await expect(page.getByRole("button", { name: "单步" })).toBeDisabled();
  await page.getByRole("button", { name: "CLEAR_LOCAL" }).click();
  await expect(page.getByLabel("ASM 源码", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("firmware-name")).toHaveCount(0);
});

test("重复构建与取消，不接受已取消任务；运行期间源码只读", async ({ page }) => {
  await start(page);
  // Retain a real Worker, hold only the first submission until explicitly released.
  await page.evaluate(() => {
    const NativeWorker = window.Worker;
    let holdFirst = true;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === "emuc51-assembler" && holdFirst) {
          holdFirst = false;
          const send = this.postMessage.bind(this);
          this.postMessage = (message: unknown) => { window.addEventListener("release-cancelled-asm", () => send(message), { once: true }); };
        }
      }
    };
  });
  await page.getByRole("button", { name: "构建 ASM", exact: true }).click();
  await expect(page.getByRole("button", { name: "构建 ASM", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消构建" }).click();
  await expect(page.getByTestId("asm-status")).toContainText("构建已取消");
  await page.evaluate(() => window.dispatchEvent(new Event("release-cancelled-asm")));
  await page.getByLabel("ASM 源码", { exact: true }).fill("SJMP $");
  await build(page); await load(page);
  await page.getByLabel("最大执行单元").fill("100000000");
  await page.getByLabel("CAPTURE_TRACE").uncheck();
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await expect(page.getByLabel("ASM 源码", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "构建 ASM", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByLabel("ASM 源码", { exact: true })).toBeEnabled();
});

test("真实 SDCC 经典 8051 产物加载后运行计数器，不宣称浏览器 C 编译", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("firmware-input").setInputFiles("tests/fixtures/sdcc-counter/main.ihx");
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.getByLabel("最大执行单元").fill("1000");
  await page.locator(".control-strip").getByRole("button", { name: "运行" }).click();
  await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  await expect(page.getByTestId("register-PC")).toContainText(/00(AB|AD|B0)/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("草稿清除失败不终止当前 CPU，恢复存储后可完整清除", async ({ page }) => {
  await start(page); await build(page); await load(page);
  await page.evaluate(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key === "emuc51.asm-draft.v1") throw new DOMException("blocked", "SecurityError");
      return remove.call(this, key);
    };
    window.addEventListener("restore-storage", () => { Storage.prototype.removeItem = remove; }, { once: true });
  });
  await page.getByRole("button", { name: "CLEAR_LOCAL" }).click();
  await expect(page.getByRole("alert")).toContainText("当前工作区未清除");
  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await page.evaluate(() => window.dispatchEvent(new Event("restore-storage")));
  await page.getByRole("button", { name: "CLEAR_LOCAL" }).click();
  await expect(page.getByLabel("ASM 源码", { exact: true })).toHaveCount(0);
});
