import {expect,test,type Page} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
const example=JSON.parse(readFileSync("src/examples/scenario-timer-uart.json","utf8"));
const io=async(page:Page)=>{await page.goto("/#io");};
const prepare=async(page:Page)=>{
  await page.goto("/#editor");await page.getByRole("button",{name:"新建 ASM 示例"}).click();
  await page.getByLabel("ASM 源码",{exact:true}).fill(await readFile("src/examples/scenario-timer-uart.asm","utf8"));
  await page.getByRole("button",{name:"构建 ASM",exact:true}).click();await expect(page.getByTestId("asm-status")).toContainText("构建成功");
  await page.getByRole("button",{name:"加载构建产物"}).click();await expect(page.getByTestId("asm-status")).toContainText("当前源码与已加载 ASM 固件匹配");
  await io(page);await page.getByRole("button",{name:"准备示例场景",exact:true}).click();
  await expect(page.getByTestId("scenario-status")).toContainText("调度未启用");
};
const snapshot=async(page:Page)=>{
  await page.goto("/#editor");const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出工作区"}).click();
  return JSON.parse(await readFile((await(await download).path())!,"utf8"));
};
const run=async(page:Page,budget:string)=>{
  await page.goto("/#editor");await page.getByLabel("最大执行单元").fill(budget);await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();
  await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
};
test("输入场景：真实 Timer/INT0/UART 可重复重放、导出及响应式时间线",async({page})=>{
  await prepare(page);
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出场景",exact:true}).click();
  const exported=await readFile((await(await download).path())!,"utf8");
  expect(JSON.parse(exported)).toEqual(example);
  await page.getByLabel("导入场景 JSON",{exact:true}).setInputFiles({name:"roundtrip.json",mimeType:"application/json",buffer:Buffer.from(exported)});
  await expect(page.getByTestId("scenario-status")).toContainText("调度未启用");
  await page.getByRole("button",{name:"从干净复位重放"}).click();
  await expect(page.getByTestId("scenario-status")).toContainText("重放已启用");
  await expect(page.getByRole("button",{name:"从干净复位重放"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"P3.2 外部输入"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"接收字节",exact:true})).toBeDisabled();
  await run(page,"1500");const first=await snapshot(page);
  expect(first.cpu.iram.slice(0x30,0x34)).toEqual([1,31,66,2]);expect(first.cpu.peripherals.serial.txOutput).toEqual([65,66]);
  expect(first.settings.inputScenario).toEqual(example);
  await io(page);await expect(page.getByTestId("scenario-status")).toContainText("已投递 4/4");
  await expect(page.getByTestId("scenario-event").first()).toContainText("目标 40 → 实际 41");
  for(const width of [375,820,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/emuc51-scenario-${width}.png`,fullPage:true});}
  await page.getByRole("button",{name:"取消输入重放"}).click();await expect(page.getByTestId("scenario-status")).toContainText("调度未启用");
  await page.getByRole("button",{name:"从干净复位重放"}).click();await expect(page.getByTestId("scenario-status")).toContainText("重放已启用");
  await run(page,"1500");const second=await snapshot(page);expect(second.cpu).toEqual(first.cpu);
});
test("输入场景：暂停、取消、刷新和工作区恢复不重发输入",async({page})=>{
  await prepare(page);await page.getByRole("button",{name:"从干净复位重放"}).click();await expect(page.getByTestId("scenario-status")).toContainText("重放已启用");
  await run(page,"50");const saved=await snapshot(page);
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state","saved");await page.reload();
  await io(page);await expect(page.getByTestId("scenario-status")).toContainText("调度未启用");await expect(page.getByTestId("scenario-status")).toContainText("已投递 0/4");
  const restored=await snapshot(page);expect(restored.cpu).toEqual(saved.cpu);
  await page.getByRole("button",{name:"构建 ASM",exact:true}).click();await expect(page.getByTestId("asm-status")).toContainText("构建成功");
  await run(page,"1500");const continued=await snapshot(page);expect(continued.cpu.iram[0x33]).toBe(1);expect(continued.cpu.peripherals.serial.txOutput).toEqual([65]);
  await page.getByTestId("workspace-input").setInputFiles({name:"saved.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(saved))});
  await expect(page.getByTestId("register-PC")).toContainText(saved.cpu.pc.toString(16).padStart(4,"0").toUpperCase());
  await io(page);await expect(page.getByTestId("scenario-status")).toContainText("调度未启用");
  await page.goto("/#editor");await page.getByRole("button",{name:"构建 ASM",exact:true}).click();await expect(page.getByTestId("asm-status")).toContainText("构建成功");
  await io(page);await page.getByRole("button",{name:"从干净复位重放"}).click();await expect(page.getByTestId("scenario-status")).toContainText("重放已启用");
  await page.goto("/#editor");await page.getByLabel("最大执行单元").fill("100000000");await page.getByLabel("CAPTURE_TRACE").uncheck();await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();
  await io(page);await page.getByRole("button",{name:"暂停"}).click();await expect(page.locator(".control-strip").getByRole("button",{name:"运行"})).toBeEnabled();
  await expect(page.getByRole("button",{name:"验证并准备场景"})).toBeDisabled();
  await page.getByRole("button",{name:"取消输入重放"}).click();await expect(page.getByRole("button",{name:"P3.2 外部输入"})).toBeEnabled();
  await page.locator(".control-strip").getByRole("button",{name:"复位"}).click();await expect(page.getByTestId("scenario-status")).toContainText("已投递 0/4");
});
test("输入场景：恶意、超量、错配输入不替换工作区，换固件清除绑定",async({page})=>{
  await prepare(page);
  for(const input of ["while(true){}",JSON.stringify({...example,events:Array(1025).fill(example.events[0])}),JSON.stringify({...example,firmwareSha256:"0".repeat(64)}),JSON.stringify({...example,script:"alert(1)"})]) {
    await page.getByLabel("场景 JSON",{exact:true}).fill(input);await page.getByRole("button",{name:"验证并准备场景"}).click();await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByTestId("scenario-status")).toContainText("Timer 0 / INT0 / UART AB");
  }
  await page.getByLabel("导入场景 JSON",{exact:true}).setInputFiles({name:"huge.json",mimeType:"application/json",buffer:Buffer.alloc(131073,32)});
  await expect(page.getByRole("alert").filter({hasText:"128 KiB"})).toBeVisible();
  const state=await snapshot(page);expect(state.cpu.machineCycles).toBe(0);
  await page.getByTestId("workbench-firmware-input").setInputFiles({name:"loop.bin",mimeType:"application/octet-stream",buffer:Buffer.from([0x80,0xfe])});
  await io(page);await expect(page.getByTestId("scenario-status")).toHaveText("未准备场景");
  await page.getByRole("button",{name:"生成当前固件模板"}).click();const template=JSON.parse(await page.getByLabel("场景 JSON",{exact:true}).inputValue());
  expect(template.firmwareSha256).toBe(createHash("sha256").update(Buffer.from([0x80,0xfe])).digest("hex"));
  await page.getByRole("button",{name:"验证并准备场景"}).click();await expect(page.getByTestId("scenario-status")).toContainText("我的输入场景");
  template.events=Array.from({length:1024},(_,index)=>({cycle:0,type:"gpio",port:1,value:index%256}));
  await page.getByLabel("场景 JSON",{exact:true}).fill(JSON.stringify(template));await page.getByRole("button",{name:"验证并准备场景"}).click();
  await expect(page.getByTestId("scenario-status")).toContainText("已投递 0/1024");await expect(page.getByTestId("scenario-event")).toHaveCount(50);
  await page.getByRole("button",{name:"场景下一页"}).click();await expect(page.getByTestId("scenario-event").first()).toContainText("#51");
  await page.getByRole("button",{name:"从干净复位重放"}).click();await expect(page.getByTestId("scenario-status")).toContainText("重放已启用");
  await page.locator(".control-strip").getByRole("button",{name:"单步"}).click();await expect(page.getByTestId("scenario-status")).toContainText("已投递 1024/1024");
  await page.getByRole("button",{name:"取消输入重放"}).click();await expect(page.getByTestId("scenario-status")).toContainText("调度未启用");
  await page.getByRole("button",{name:"移除场景"}).click();await expect(page.getByTestId("scenario-status")).toHaveText("未准备场景");
});
