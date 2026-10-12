import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { SdccDebugData } from "../../src/core/sdcc-debug";
for (const name of ['main','values','literals']) test(`真实字符串和初始化器 ${name} 与原生 IHX/CDB 一致`, async ({page}) => {
  const fixture=(extension:string)=>readFile(`tests/fixtures/sdcc-generated/${name}.${extension}`,'utf8');
  await page.goto('/#editor');
  await page.getByLabel('C 编译源码').fill(await fixture('c'));
  await page.getByRole('button',{name:'编译 C 工程',exact:true}).click();
  await expect(page.getByTestId('c-build-status')).toContainText('编译成功');
  const next=page.waitForEvent('download');await page.getByRole('button',{name:'下载 C 构建包'}).click();
  const built=JSON.parse(await readFile((await(await next).path())!,'utf8')) as SdccDebugData;
  expect(built.ihx).toBe(await fixture('ihx'));
  expect(built.cdb).toBe(await fixture('cdb'));
  await page.getByRole('button',{name:'加载 C 编译固件'}).click();
  await expect(page.getByTestId('sdcc-status')).toContainText('已校验文件摘要');
});
