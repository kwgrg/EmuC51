import { expect, test } from "@playwright/test";
test("CDB 存储整数视图保留原始字节、类型歧义、绑定及选择生命周期",async({page})=>{
  await page.goto("/#editor");
  await page.getByLabel("导入 SDCC 构建文件").setInputFiles(["emuc51-sdcc.json","integers.c","integers.ihx","integers.cdb"].map(name=>`tests/fixtures/sdcc-integers/${name}`));
  await expect(page.getByTestId("sdcc-status")).toContainText("已校验文件摘要 · integers.c");
  await page.getByLabel("最大执行单元").fill("3000");
  await page.locator(".control-strip").getByRole("button",{name:"运行"}).click();
  await expect(page.locator(".footer-status")).toHaveText("已达到本次运行步数上限");
  const pc=await page.getByTestId("register-PC").textContent();
  const select=async(name:string)=>page.getByRole("button",{name:`观察 CDB::integers::G$${name}$0_0$0`,exact:true}).click();
  for(const [name,value,bytes] of [
    ["sc_min","-128","80"],["sc_max","127","7F"],["uc_max","255","FF"],
    ["si_min","-32768","00 80"],["ui_max","65535","FF FF"],
    ["sl_min","-2147483648","00 00 00 80"],["sl_max","2147483647","FF FF FF 7F"],
    ["ul_max","4294967295","FF FF FF FF"],["ul_zero","0","00 00 00 00"],["enum_value","-1","FF"],
  ]){
    await select(name!);await expect(page.getByTestId("symbol-integer")).toHaveText(value!);await expect(page.getByTestId("symbol-bytes")).toHaveText(bytes!);
  }
  await expect(page.getByLabel("CDB 存储整数视图")).toContainText("相同存储编码的枚举");
  await expect(page.getByTestId("register-PC")).toHaveText(pc!);
  await page.getByRole("button",{name:"刷新符号观察"}).click();await expect(page.getByTestId("symbol-integer")).toHaveText("-1");
  await select("array_value");await expect(page.getByTestId("symbol-bytes")).toHaveText("FF 00");await expect(page.getByTestId("symbol-integer")).toHaveCount(0);
  for(const name of ["boolean_value","bit_value","ll_value","float_value","pointer_value","pair_value"]){
    await expect(page.getByRole("button",{name:`观察 CDB::integers::G$${name}$0_0$0`,exact:true})).toBeDisabled();
  }
  await select("sl_min");await expect(page.getByTestId("symbol-integer")).toHaveText("-2147483648");
  await page.setViewportSize({width:375,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("button",{name:"取消符号观察"}).click();await expect(page.getByTestId("symbol-integer")).toHaveCount(0);
  await select("ul_max");await expect(page.getByTestId("symbol-integer")).toHaveText("4294967295");
  await page.goto("/#io");await page.goto("/#editor");await expect(page.getByTestId("symbol-integer")).toHaveCount(0);
  await select("ul_max");await expect(page.getByTestId("symbol-integer")).toHaveText("4294967295");
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出工作区",exact:true}).click();await download;
  await expect(page.getByRole("main")).toHaveAttribute("data-save-state","saved");await page.reload();
  await expect(page.getByTestId("sdcc-status")).toContainText("已校验文件摘要");await expect(page.getByTestId("symbol-integer")).toHaveCount(0);
  await select("ul_max");await expect(page.getByTestId("symbol-integer")).toHaveText("4294967295");
  await page.getByTestId("workbench-firmware-input").setInputFiles({name:"plain.bin",mimeType:"application/octet-stream",buffer:Buffer.from([0x80,0xfe])});
  await expect(page.getByTestId("firmware-name")).toContainText("plain.bin");await expect(page.getByTestId("symbol-integer")).toHaveCount(0);
});
