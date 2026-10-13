import {expect,test,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const key='emuc51.c-draft.v1';
const tools=async(page:Page)=>{await page.getByText('工程管理与本地草稿',{exact:true}).click();};
const add=async(page:Page,path:string,text:string)=>{
 await page.getByLabel('工程文件路径').fill(path);await page.getByRole('button',{name:'新增工程文件',exact:true}).click();
 await expect(page.getByLabel('编译源文件',{exact:true})).toHaveValue(path);await page.getByLabel('C 编译源码').fill(text);
};
const build=async(page:Page)=>{await page.getByRole('button',{name:'编译 C 工程',exact:true}).click();};
const rename=async(page:Page,path:string)=>{
 await page.getByLabel('工程文件路径').fill(path);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'重命名当前文件',exact:true}).click();
};
test('新增三类文件、切换入口、改名引用失败修复、真实多文件运行与删除保护',async({page})=>{
 test.setTimeout(90000);const requests:{method:string;body:string|null;url:string}[]=[];
 page.on('request',r=>requests.push({method:r.method(),body:r.postData(),url:r.url()}));
 await page.goto('/#editor');await page.getByRole('button',{name:'C + SDAS 示例',exact:true}).click();await tools(page);
 const select=page.getByLabel('编译源文件',{exact:true}),edit=page.getByLabel('C 编译源码'),load=page.getByRole('button',{name:'加载 C 编译固件'});
 await expect(page.getByRole('button',{name:'删除当前文件',exact:true})).toBeDisabled();
 await select.selectOption('bridge.asm');await expect(page.getByRole('button',{name:'删除当前文件',exact:true})).toBeDisabled();
 await add(page,'include/value.h','#define RESULT 23\nunsigned char helper(void);\n');
 await add(page,'src/helper.c','#include "value.h"\nunsigned char helper(void) { return RESULT; }\n');
 await add(page,'asm/extra.asm','.module extra\n.globl _extra\n.area CSEG (CODE)\n_extra:\n mov dpl,#4\n ret\n');
 await add(page,'src/start.c','#include <8051.h>\n#include "value.h"\nunsigned char extra(void);\nvolatile __data unsigned char result;\nvoid main(void) { result = helper() + extra(); P1 = result; for (;;) {} }\n');
 await page.getByLabel('入口 C 文件',{exact:true}).selectOption('src/start.c');
 await select.selectOption('main.c');page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'删除当前文件',exact:true}).click();await expect(select).toHaveValue('main.c');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'删除当前文件',exact:true}).click();await expect(select).toHaveValue('src/start.c');
 await build(page);await expect(page.getByTestId('c-build-status')).toContainText('编译成功');
 await select.selectOption('include/value.h');await rename(page,'headers/settings.h');await expect(load).toBeDisabled();await expect(page.getByRole('region',{name:'构建诊断'})).toHaveCount(0);
 await build(page);await expect(page.getByTestId('c-build-status')).toContainText('未列入工程的头文件');await expect(load).toBeDisabled();
 for(const path of ['src/start.c','src/helper.c']){await select.selectOption(path);await edit.fill((await edit.inputValue()).replace('"value.h"','"settings.h"'));}
 await select.selectOption('asm/extra.asm');await rename(page,'asm/more.asm');await expect(edit).toHaveValue(/\.module extra/);await build(page);await expect(page.getByTestId('c-build-status')).toContainText('.module 必须与文件名一致');await expect(load).toBeDisabled();
 await edit.fill((await edit.inputValue()).replace('.module extra','.module more'));
 await select.selectOption('src/start.c');await rename(page,'src/entry.c');await expect(page.getByLabel('入口 C 文件',{exact:true})).toHaveValue('src/entry.c');
 await build(page);await expect(page.getByTestId('c-build-status')).toContainText('编译成功');
 await page.getByRole('button',{name:'保存本地 C/SDAS 草稿',exact:true}).click();
 await mkdir('docs/screenshots/project-management',{recursive:true});await page.locator('.c-project-tools').scrollIntoViewIfNeeded();await page.screenshot({path:'docs/screenshots/project-management/desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('.c-project-tools').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/screenshots/project-management/mobile.png'});
 await page.setViewportSize({width:1440,height:1000});await load.click();await expect(page.getByTestId('sdcc-status')).toContainText('已校验文件摘要');
 await page.getByLabel('最大执行单元').fill('1000');await page.locator('.control-strip').getByRole('button',{name:'运行'}).click();await expect(page.locator('.footer-status')).toContainText('步数上限');
 await page.getByRole('button',{name:'观察 CDB::entry::G$result$0_0$0',exact:true}).click();await expect(page.getByTestId('symbol-integer')).toHaveText('27');
 await page.screenshot({path:'docs/screenshots/project-management/running.png'});
 expect(requests.every(r=>r.method==='GET'&&r.body===null&&r.url.startsWith('http://127.0.0.1:41851/'))).toBe(true);
});
test('独立草稿跨页面与刷新、显式恢复不编译不加载、覆盖取消和清除',async({page})=>{
 await page.goto('/#editor');await tools(page);const edit=page.getByLabel('C 编译源码');
 const saved='void main(void) { /* saved draft */ for (;;) {} }\n';await edit.fill(saved);await page.getByRole('button',{name:'保存本地 C/SDAS 草稿',exact:true}).click();
 await edit.fill(saved+'// unsaved\n');await page.locator('.desktop-nav').getByRole('button',{name:'SYS_MEM',exact:true}).click();await page.locator('.desktop-nav').getByRole('button',{name:'BIN_INSPECTOR',exact:true}).click();await expect(edit).toHaveValue(saved+'// unsaved\n');
 await tools(page);page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿',exact:true}).click();await expect(edit).toHaveValue(saved+'// unsaved\n');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿',exact:true}).click();await expect(edit).toHaveValue(saved);
 await page.reload();await tools(page);await expect(edit).not.toHaveValue(saved);await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿',exact:true}).click();await expect(edit).toHaveValue(saved);await expect(page.getByRole('button',{name:'加载 C 编译固件'})).toBeDisabled();await expect(page.getByTestId('firmware-name')).toHaveCount(0);await expect(page.getByTestId('c-build-status')).not.toContainText('编译成功');
 await page.getByRole('button',{name:'C + SDAS 示例',exact:true}).click();page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'保存本地 C/SDAS 草稿',exact:true}).click();expect(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)!).input.files[0].text,key)).toBe(saved);
 await edit.fill('// keep me');page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'> CLEAR_LOCAL',exact:true}).click();await expect(edit).toHaveValue('// keep me');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'> CLEAR_LOCAL',exact:true}).click();await page.waitForEvent('load');expect(await page.evaluate(k=>localStorage.getItem(k),key)).toBeNull();
});
test('损坏、超限与存储失败可见且不替换编辑，非法路径和输入拒绝',async({page})=>{
 await page.goto('/#editor');await page.getByRole('button',{name:'C + SDAS 示例',exact:true}).click();await tools(page);
 const edit=page.getByLabel('C 编译源码'),original=await edit.inputValue();
 for(const path of ['../bad.c','other/MAIN.c','other/bridge.c']){await page.getByLabel('工程文件路径').fill(path);await page.getByRole('button',{name:'新增工程文件',exact:true}).click();await expect(page.getByRole('alert')).toContainText('清单无效');await expect(edit).toHaveValue(original);}
 await edit.fill('x'.repeat(65537));await expect(page.getByRole('alert').filter({hasText:'编辑未应用'})).toBeVisible();await expect(edit).toHaveValue(original);
 for(const bad of ['{',' '.repeat(2*1024*1024+1)]){await page.evaluate(({key,bad})=>localStorage.setItem(key,bad),{key,bad});await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:/草稿损坏|2 MiB/})).toBeVisible();await expect(edit).toHaveValue(original);}
 await page.evaluate(k=>{localStorage.removeItem(k);Storage.prototype.setItem=()=>{throw new DOMException('Quota','QuotaExceededError');};},key);await page.getByRole('button',{name:'保存本地 C/SDAS 草稿',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'无法保存'})).toBeVisible();await expect(edit).toHaveValue(original);
 await page.evaluate(()=>{Storage.prototype.getItem=()=>{throw new Error('denied');};});await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'denied'})).toBeVisible();await expect(edit).toHaveValue(original);
});
