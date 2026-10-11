import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const bundlePath = "tests/fixtures/sdcc-mixed/emuc51-project.build.json";
test("混合工程：跨文件 C/SDAS 精确行断点、ABI 执行、同名静态对象和恢复", async ({ page }) => {
  await page.goto("/#editor"); await page.getByLabel("导入 SDCC 构建文件").setInputFiles(bundlePath);
  await expect(page.getByTestId("sdcc-status")).toContainText("已校验文件摘要 · src/main.c");
  const file = page.getByLabel("工程源文件"); await expect(file).toHaveValue("src/main.c");
  const mainAddress = await page.getByLabel("源码第 5 行地址",{exact:true}).textContent();
  await file.selectOption("src/compute.c");
  await expect(page.getByLabel("源码第 5 行地址",{exact:true})).not.toHaveText(mainAddress!);
  await page.getByRole("button",{name:"切换源码第 5 行断点",exact:true}).click();
  await file.selectOption("asm/bridge.asm");
  const source = await readFile("tests/fixtures/sdcc-mixed/project/asm/bridge.asm","utf8");
  const line = source.split("\n").findIndex(text=>text.includes("mov a,dpl"))+1;
  await expect(page.getByRole("button",{name:"切换源码第 1 行断点",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:`切换源码第 ${line} 行断点`,exact:true}).click();
  await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();
  await expect(page.locator(".footer-status")).toContainText("断点暂停");
  await page.getByRole("button",{name:"定位当前源码行",exact:true}).click();await expect(file).toHaveValue("asm/bridge.asm");
  await expect(page.locator(`[data-source-file="asm/bridge.asm"] [data-source-line="${line}"]`)).toHaveClass(/source-current/);
  await page.getByRole("button",{name:`切换源码第 ${line} 行断点`,exact:true}).click();
  await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();
  await expect(page.locator(".footer-status")).toContainText("断点暂停");
  await page.getByRole("button",{name:"定位当前源码行",exact:true}).click();await expect(file).toHaveValue("src/compute.c");
  await page.getByRole("button",{name:"切换源码第 5 行断点",exact:true}).click();
  await page.getByLabel("最大执行单元").fill("1000");await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();
  await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  for(const [id,value] of [["main::G$word_result","4864"],["main::Fmain$shadow","10"],["compute::Fcompute$shadow","3"]]){
    await page.getByRole("button",{name:`观察 CDB::${id}$0_0$0`,exact:true}).click();await expect(page.getByTestId("symbol-integer")).toHaveText(value!);
  }
  await file.selectOption("include/shared.h");await expect(page.getByRole("button",{name:"切换源码第 1 行断点",exact:true})).toBeDisabled();
  await page.setViewportSize({width:375,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出工作区",exact:true}).click();
  const workspace=await readFile((await(await download).path())!,"utf8");
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state","saved");await page.reload();
  await expect(file).toHaveValue("src/main.c");await expect(page.getByTestId("symbol-integer")).toHaveCount(0);
  await page.getByTestId("workspace-input").setInputFiles({name:"mixed.json",mimeType:"application/json",buffer:Buffer.from(workspace)});
  await expect(file).toHaveValue("src/main.c");await file.selectOption("asm/bridge.asm");
  await expect(page.getByLabel(`源码第 ${line} 行地址`,{exact:true})).not.toHaveText("—");
});
test("混合工程：篡改、歧义模块和路径不能替换当前固件", async ({ page }) => {
  await page.goto("/#editor");await page.getByLabel("导入 SDCC 构建文件").setInputFiles(bundlePath);
  await expect(page.getByTestId("sdcc-status")).toContainText("已校验文件摘要");
  const initial=await page.getByTestId("register-PC").textContent();
  const original=JSON.parse(await readFile(bundlePath,"utf8"));
  const header=structuredClone(original);header.inputs.find((item:{path:string})=>item.path.endsWith(".h")).text+="\n";
  const path=structuredClone(original);path.project.entry="../main.c";
  const source=structuredClone(original);source.cdb=source.cdb.replace("L:C$main.c$","L:C$missing.c$");source.manifest.files.cdb.sha256=createHash("sha256").update(source.cdb).digest("hex");
  for(const value of [header,path,source]){
    await page.getByLabel("导入 SDCC 构建文件").setInputFiles({name:"emuc51-project.build.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(value))});
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByTestId("register-PC")).toHaveText(initial!);await expect(page.getByLabel("工程源文件")).toHaveValue("src/main.c");
  }
});
test("混合工程：取消的包读取及晚到校验不覆盖新固件",async({page})=>{
  await page.addInitScript(()=>{
    const original=File.prototype.arrayBuffer;let first=true;
    File.prototype.arrayBuffer=function(){
      if(this.name!=="emuc51-project.build.json"||!first)return original.call(this);
      first=false;
      return new Promise<ArrayBuffer>(resolve=>window.addEventListener("release-project",()=>{void original.call(this).then(resolve);},{once:true}));
    };
  });
  await page.goto("/#editor");await page.getByLabel("导入 SDCC 构建文件").setInputFiles(bundlePath);
  await page.getByRole("button",{name:"取消 SDCC 导入",exact:true}).click();
  await page.getByTestId("workbench-firmware-input").setInputFiles({name:"loop.bin",mimeType:"application/octet-stream",buffer:Buffer.from([0x80,0xfe])});
  await expect(page.getByTestId("firmware-name")).toContainText("loop.bin");
  await page.evaluate(()=>window.dispatchEvent(new Event("release-project")));
  await page.getByRole("button",{name:"单步"}).click();await expect(page.getByTestId("register-PC")).toContainText("0000");
  await expect(page.getByLabel("工程源文件")).toHaveCount(0);
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出工作区",exact:true}).click();
  const snapshot=JSON.parse(await readFile((await(await download).path())!,"utf8"));expect(snapshot.firmware.name).toBe("loop.bin");expect(snapshot.settings.sdccDebug).toBeUndefined();
  await page.getByLabel("导入 SDCC 构建文件").setInputFiles(bundlePath);await expect(page.getByLabel("工程源文件")).toHaveValue("src/main.c");
});
