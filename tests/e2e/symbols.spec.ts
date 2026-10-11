import {expect,test,type Page} from "@playwright/test";
import {readFile} from "node:fs/promises";
const importSymbols=async(page:Page,stem="symbols",directory="sdcc-symbols")=>{
  await page.getByLabel("导入 SDCC 构建文件").setInputFiles(["emuc51-sdcc.json",`${stem}.c`,`${stem}.ihx`,`${stem}.cdb`].map(name=>`tests/fixtures/${directory}/${name}`));
  await expect(page.getByTestId("sdcc-status")).toContainText(`已校验文件摘要 · ${stem}.c`);
  await expect(page.getByRole("region",{name:"SDCC 静态符号"})).toBeVisible();
};
const build=async(page:Page)=>{await page.getByRole("button",{name:"构建 ASM",exact:true}).click();await expect(page.getByTestId("asm-status")).toContainText("构建成功");};
const globalId=(name:string)=>`CDB::symbols::G$${name}$0_0$0`;
const readSymbol=async(page:Page,name:string,value:string)=>{
  await page.getByRole("button",{name:`观察 ${globalId(name)}`,exact:true}).click();await expect(page.getByTestId("symbol-bytes")).toHaveText(value);
};
test("可信符号：ASM 别名断点、定义定位、CODE 导航及构建绑定",async({page})=>{
  await page.goto("/#editor");await page.getByRole("button",{name:"新建 ASM 示例"}).click();
  const source=await readFile("tests/fixtures/asm-labels.asm","utf8");await page.getByLabel("ASM 源码",{exact:true}).fill(source);await build(page);
  await expect(page.getByTestId("asm-symbol")).toHaveCount(0);await page.getByRole("button",{name:"加载构建产物"}).click();await expect(page.getByTestId("asm-symbol")).toHaveCount(6);
  const first=page.getByRole("button",{name:"切换 ASM 标签 ENTRY 断点",exact:true}),alias=page.getByRole("button",{name:"切换 ASM 标签 ALIAS 断点",exact:true});
  await first.click();await expect(alias).toHaveAttribute("aria-pressed","true");await alias.click();await expect(first).toHaveAttribute("aria-pressed","false");
  for(const name of ["TABLE","OPERAND","HOLE"])await expect(page.getByRole("button",{name:`切换 ASM 标签 ${name} 断点`,exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"查看 ASM 标签 HOLE CODE"})).toBeDisabled();
  await page.getByRole("button",{name:"查看 ASM 标签 LOOP 汇编"}).click();await expect(page.getByLabel("反汇编起始地址")).toHaveValue("0002");await expect(page.getByTestId("register-PC")).toContainText("0000");
  await page.getByRole("button",{name:"查看 ASM 标签 TABLE CODE"}).click();await expect(page.getByLabel("内存起始地址")).toHaveValue("0004");await expect(page.locator(".memory-row").first()).toContainText("01 02");
  await page.goto("/#editor");await page.getByRole("button",{name:"定位 ASM 标签 ENTRY"}).click();
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state","saved");await page.reload();await expect(page.getByTestId("asm-symbol")).toHaveCount(0);await build(page);await expect(page.getByTestId("asm-symbol")).toHaveCount(6);
  await page.getByLabel("ASM 源码",{exact:true}).fill(source+"\n; change");await expect(page.getByTestId("asm-symbol")).toHaveCount(0);await build(page);await expect(page.getByTestId("asm-symbol")).toHaveCount(0);
  await page.getByRole("button",{name:"加载构建产物"}).click();await expect(page.getByTestId("asm-symbol")).toHaveCount(6);
});
test("可信符号：真实 SDCC 静态对象只读观察、同名隔离及内存导航",async({page})=>{
  await page.goto("/#editor");await importSymbols(page);await page.getByLabel("最大执行单元").fill("1000");await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  const pc=await page.getByTestId("register-PC").textContent();
  await readSymbol(page,"ACC","31");await readSymbol(page,"count16","34 12");await readSymbol(page,"wide","78 56 34 12");await readSymbol(page,"rom_bytes","12 34 56");
  await page.getByRole("button",{name:"观察 CDB::symbols::Fsymbols$shadow$0_0$0",exact:true}).click();await expect(page.getByTestId("symbol-bytes")).toHaveText("22");
  await expect(page.getByRole("button",{name:"观察 CDB::symbols::Lsymbols.set_values$shadow$1_0$2",exact:true})).toBeDisabled();
  for(const name of ["outside_classic","missing_external","pointer_value","pair_value","flag"])await expect(page.getByRole("button",{name:`观察 ${globalId(name)}`,exact:true})).toBeDisabled();
  await page.goto("/#io");await page.getByRole("button",{name:"P1.0 外部输入",exact:true}).click();await expect(page.getByTestId("port-1-pins")).toHaveText("A4");await page.goto("/#editor");
  await readSymbol(page,"port_out","A5");await readSymbol(page,"serial_latch","41");await page.getByRole("button",{name:"刷新符号观察"}).click();await expect(page.getByTestId("symbol-bytes")).toHaveText("41");
  await expect(page.getByTestId("register-PC")).toHaveText(pc!);
  for(const width of [375,820,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/emuc51-symbols-${width}.png`,fullPage:true});}
  await page.getByRole("button",{name:"取消符号观察"}).click();await expect(page.getByTestId("symbol-bytes")).toHaveCount(0);
  await page.getByRole("button",{name:`导航 ${globalId("wide")}`,exact:true}).click();await expect(page.getByLabel("内存起始地址")).toHaveValue("1234");await expect(page.locator(".memory-row").first()).toContainText("78 56 34 12");
  await page.getByLabel("观察表达式",{exact:true}).fill("ACC");await page.getByRole("button",{name:"添加观察",exact:true}).click();await expect(page.getByTestId("watch-expression-row")).toHaveCount(1);
  await page.goto("/#editor");await expect(page.getByTestId("symbol-bytes")).toHaveCount(0);
  await page.reload();await expect(page.getByRole("region",{name:"SDCC 静态符号"})).toBeVisible();await readSymbol(page,"ACC","31");
});
test("可信符号：晚到观察结果不能覆盖新选择或替换后的固件",async({page})=>{
  await page.addInitScript(()=>{
    const NativeWorker=window.Worker;
    const descriptor=Object.getOwnPropertyDescriptor(NativeWorker.prototype,"onmessage")!;
    let hold=false;window.addEventListener("hold-symbol",()=>{hold=true;});
    window.Worker=class extends NativeWorker {
      constructor(url:string|URL,options?:WorkerOptions){super(url,options);
        if(options?.name!=="emuc51-core")return;
        Object.defineProperty(this,"onmessage",{set:(handler:(event:MessageEvent)=>void)=>{
          descriptor.set!.call(this,(event:MessageEvent)=>{
            if(hold&&event.data.type==="WatchResults"){hold=false;window.addEventListener("release-symbol",()=>handler(event),{once:true});}
            else handler(event);
          });
        }});
      }
    };
  });
  await page.goto("/#editor");await importSymbols(page);
  await page.evaluate(()=>window.dispatchEvent(new Event("hold-symbol")));await page.getByRole("button",{name:`观察 ${globalId("ACC")}`,exact:true}).click();await expect(page.getByTestId("symbol-bytes")).toHaveText("…");
  await readSymbol(page,"wide","00 00 00 00");await page.evaluate(()=>window.dispatchEvent(new Event("release-symbol")));await expect(page.getByTestId("symbol-bytes")).toHaveText("00 00 00 00");
  await page.evaluate(()=>window.dispatchEvent(new Event("hold-symbol")));await page.getByRole("button",{name:`观察 ${globalId("ACC")}`,exact:true}).click();await expect(page.getByTestId("symbol-bytes")).toHaveText("…");
  await page.getByTestId("workbench-firmware-input").setInputFiles({name:"new.bin",mimeType:"application/octet-stream",buffer:Buffer.from([0x80,0xfe])});
  await expect(page.getByRole("region",{name:"SDCC 静态符号"})).toHaveCount(0);await page.evaluate(()=>window.dispatchEvent(new Event("release-symbol")));await expect(page.getByTestId("symbol-bytes")).toHaveCount(0);
});
