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

test("经典 UART TI 在停止位开始唤醒 idle，确认后刷新不重复触发 ISR", async ({ page }) => {
  const source=await readFile("tests/fixtures/peripherals/uart-ti-idle.asm","utf8");
  await start(page); await page.getByLabel("ASM 源码",{exact:true}).fill(source);
  await build(page); await load(page);
  await page.getByLabel("断点地址").fill("0023");
  await page.getByRole("button",{name:"添加断点",exact:true}).click();
  await page.getByLabel("最大执行单元").fill("450");
  await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();
  await expect(page.locator(".footer-status")).toHaveText("断点暂停 · PC=0023");
  const snapshot=async () => {
    const download=page.waitForEvent("download");
    await page.getByRole("button",{name:"导出工作区"}).click();
    return JSON.parse(await readFile((await (await download).path())!,"utf8"));
  };
  const atEntry=await snapshot();
  expect(atEntry.cpu.peripherals.serial.txFrame).toMatchObject({mode:1,progress:290,tiRaised:true});
  expect(atEntry.cpu.peripherals.serial.txOutput).toEqual([]);
  expect(atEntry.cpu.sfr[0x98-0x80]&2).toBe(2);
  expect(atEntry.cpu.sfr[0x87-0x80]&1).toBe(0);
  await page.getByRole("button",{name:"单步"}).click(); // MOV 30h,TL0
  await expect(page.getByTestId("register-PC")).toContainText("0026");
  await page.getByRole("button",{name:"单步"}).click(); // CLR TI
  await expect(page.getByTestId("register-PC")).toContainText("0028");
  const acknowledged=await snapshot(); // wait for the latest Worker snapshot, not an earlier saved indicator
  expect(acknowledged.cpu.pc).toBe(0x28);
  expect(acknowledged.cpu.sfr[0x98-0x80]&2).toBe(0);
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state","saved");
  await page.reload();
  await expect(page.getByTestId("register-PC")).toContainText("0028");
  const resumed=await snapshot();
  expect(resumed.cpu.peripherals.serial.txFrame.tiRaised).toBe(true);
  expect(resumed.cpu.sfr[0x98-0x80]&2).toBe(0);
  await build(page); // re-validate the restored ASM binding without reloading/resetting the CPU
  await expect(page.getByTestId("register-PC")).toContainText("0028");
  await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();
  await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  const final=await snapshot();
  expect(final.cpu.iram.slice(0x30,0x33)).toEqual([0x23,1,0x55]);
  expect(final.cpu.peripherals.serial.txOutput).toEqual([0x41]);
  expect(final.cpu.peripherals.interruptStack).toEqual([]);
  expect(final.cpu.sfr[0x98-0x80]&3).toBe(0);
});

test("ASM 精确源码行断点、PC、反汇编导航及运行至行", async ({page}) => {
  await start(page);
  await page.getByLabel("ASM 源码",{exact:true}).fill("; source map\nORG 0\nMOV A,#1\nLOOP: INC A\nSJMP LOOP\nORG 10h\nDB 0,0\nEND");
  await build(page); await expect(page.getByTestId("asm-location")).toHaveCount(0);
  await load(page);
  await expect(page.getByTestId("asm-location")).toContainText("第 3 行");
  await expect(page.getByRole("button",{name:"切换 ASM 第 1 行断点",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"运行至 ASM 第 7 行",exact:true})).toBeDisabled();
  const breakpoint=page.getByRole("button",{name:"切换 ASM 第 4 行断点",exact:true});
  await breakpoint.click(); await expect(page.getByRole("button",{name:"删除断点 0002",exact:true})).toBeVisible();
  await breakpoint.click(); await expect(breakpoint).toHaveAttribute("aria-pressed","false"); await breakpoint.click();
  await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();
  await expect(page.locator(".footer-status")).toHaveText("断点暂停 · PC=0002");
  await expect(page.locator('[data-asm-line="4"]')).toHaveClass(/source-current/);
  await page.getByRole("button",{name:"查看 ASM 第 5 行汇编",exact:true}).click();
  await expect(page.getByLabel("反汇编起始地址")).toHaveValue("0003");
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await page.getByRole("button",{name:"查看 ASM 第 5 行汇编",exact:true}).click();
  await page.getByRole("button",{name:"运行至 ASM 第 5 行",exact:true}).click();
  await expect(page.locator(".footer-status")).toHaveText("已运行至地址 0003");
  await expect(page.getByTestId("register-A")).toContainText("02");
  await expect(page.getByRole("button",{name:"删除断点 0003",exact:true})).toHaveCount(0);
  await expect(page.getByTestId("asm-location")).toContainText("第 5 行");
  for(const width of [375,820,1280]) {
    await page.setViewportSize({width,height:900});
    await page.getByTestId("asm-location").scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await page.locator(".asm-source-list").evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.screenshot({path:`/tmp/emuc51-asm-map-${width}.png`,fullPage:true});
  }
  await page.getByLabel("编辑寄存器").selectOption("PC");
  await page.getByLabel("寄存器新值").fill("0001"); await page.getByRole("button",{name:"写入寄存器"}).click();
  await expect(page.getByTestId("asm-location")).toContainText("无精确指令行映射");
});

test("ASM 映射只信任当前匹配构建，编辑失败、刷新、替换固件不保留旧行入口", async ({page}) => {
  await start(page); const editor=page.getByLabel("ASM 源码",{exact:true});
  const source="MOV A,#42h\nSJMP $";
  await editor.fill(source); await build(page); await load(page);
  await page.getByRole("button",{name:"单步"}).click(); await expect(page.getByTestId("register-PC")).toContainText("0002");
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"导出工作区"}).click();
  expect(JSON.parse(await readFile((await (await download).path())!,"utf8")).cpu.pc).toBe(2);
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state","saved"); await page.reload();
  await expect(page.getByTestId("asm-location")).toHaveCount(0); await build(page);
  await expect(page.getByTestId("asm-location")).toContainText("第 2 行");
  await expect(page.getByTestId("register-PC")).toContainText("0002");
  await editor.fill("MOV A,#missing"); await expect(page.getByTestId("asm-location")).toHaveCount(0);
  await page.getByRole("button",{name:"构建 ASM",exact:true}).click();
  await expect(page.getByTestId("asm-status")).toContainText("构建失败");
  await expect(page.getByRole("button",{name:/切换 ASM 第/})).toHaveCount(0);
  await editor.fill(source+"\n; changed source, same bytes"); await build(page);
  await expect(page.getByTestId("asm-location")).toHaveCount(0); await load(page);
  await expect(page.getByTestId("asm-location")).toContainText("第 1 行");
  await page.getByTestId("workbench-firmware-input").setInputFiles({name:"other.bin",mimeType:"application/octet-stream",buffer:Buffer.from([0x80,0xfe])});
  await expect(page.getByTestId("asm-location")).toHaveCount(0);
});

test("ASM 分页定位、运行预算、暂停锁定与离页行为", async ({page}) => {
  await start(page);
  await page.getByLabel("ASM 源码",{exact:true}).fill("SJMP $\n"+Array(104).fill("NOP").join("\n"));
  await build(page); await load(page);
  await page.getByRole("button",{name:"ASM 下一页",exact:true}).click();
  await expect(page.getByTestId("asm-source-page")).toHaveText("2 / 2");
  await page.getByLabel("最大执行单元").fill("5");
  await page.getByRole("button",{name:"运行至 ASM 第 105 行",exact:true}).click();
  await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.getByLabel("最大执行单元").fill("100000000");
  await page.getByRole("button",{name:"运行至 ASM 第 105 行",exact:true}).click();
  await expect(page.getByRole("button",{name:"运行至 ASM 第 105 行",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"切换 ASM 第 105 行断点",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"暂停"}).click();
  await expect(page.getByRole("button",{name:"运行至 ASM 第 105 行",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"定位当前 ASM 行",exact:true}).click();
  await expect(page.getByTestId("asm-source-page")).toHaveText("1 / 2");
  await page.getByRole("button",{name:"ASM 下一页",exact:true}).click();
  await page.goto("/#memory"); await page.goto("/#editor");
  await expect(page.getByTestId("asm-source-page")).toHaveText("1 / 2");
});
