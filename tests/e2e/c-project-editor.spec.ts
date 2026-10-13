import {expect,test,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const tools=async(page:Page)=>{const details=page.locator('.c-project-tools');if(await details.getAttribute('open')===null)await details.locator('summary').click();};
const build=async(page:Page)=>{await page.getByRole('button',{name:'编译 C 工程',exact:true}).click();};
const success=async(page:Page)=>{await build(page);await expect(page.getByTestId('c-build-status')).toContainText('编译成功');};
const add=async(page:Page,path:string,text:string)=>{await page.getByLabel('工程文件路径').fill(path);await page.getByRole('button',{name:'新增工程文件',exact:true}).click();await expect(page.getByLabel('编译源文件',{exact:true})).toHaveValue(path);await page.getByLabel('C 编译源码').fill(text);};
const rename=async(page:Page,path:string)=>{await page.getByLabel('工程文件路径').fill(path);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'重命名当前文件',exact:true}).click();};
test('真实混合工程新增 C/头文件/ASM、改名入口和引用修复、删除确认后编译运行',async({page})=>{
 test.setTimeout(90000);await page.goto('/#editor');await page.getByRole('button',{name:'C + SDAS 示例',exact:true}).click();await tools(page);
 const select=page.getByLabel('编译源文件',{exact:true}),edit=page.getByLabel('C 编译源码'),load=page.getByRole('button',{name:'加载 C 编译固件',exact:true});
 await add(page,'include/support.h','unsigned char helper(unsigned char value);\n');
 await add(page,'src/helper.c','#include "support.h"\nunsigned char helper(unsigned char value) { return value + 4; }\n');
 await select.selectOption('main.c');await edit.fill((await edit.inputValue()).replace('#include <8051.h>','#include <8051.h>\n#include "support.h"').replace('add_two(5)','add_two(helper(5))'));
 await success(page);await expect(load).toBeEnabled();
 await rename(page,'src/start.c');await expect(page.getByLabel('入口 C 文件')).toHaveValue('src/start.c');await expect(load).toBeDisabled();await expect(page.getByRole('button',{name:'删除当前文件'})).toBeDisabled();
 await select.selectOption('include/support.h');await rename(page,'include/api.h');await build(page);await expect(page.getByTestId('c-build-status')).toContainText('未列入工程的头文件');await expect(load).toBeDisabled();
 for(const path of ['src/start.c','src/helper.c']){await select.selectOption(path);await expect(edit).toHaveValue(/support.h/);await edit.fill((await edit.inputValue()).replace('support.h','api.h'));}
 await select.selectOption('bridge.asm');await rename(page,'asm/adder.asm');await expect(edit).toHaveValue(/\.module bridge/);await build(page);await expect(page.getByTestId('c-build-status')).toContainText('SDAS .module');
 await edit.fill((await edit.inputValue()).replace('.module bridge','.module adder'));await success(page);
 await add(page,'asm/spare.asm','.module spare\n.area CSEG (CODE)\n; UNSAVED CONTENT\n');await expect(load).toBeDisabled();
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'删除当前文件'}).click();await expect(edit).toHaveValue(/UNSAVED CONTENT/);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除当前文件'}).click();await expect(select.locator('option[value="asm/spare.asm"]')).toHaveCount(0);
 await select.selectOption('asm/adder.asm');await expect(page.getByRole('button',{name:'删除当前文件'})).toBeDisabled();
 await select.selectOption('src/helper.c');await rename(page,'src/calculation.c');
 await page.getByLabel('入口 C 文件').selectOption('src/calculation.c');await build(page);await expect(page.getByTestId('c-build-status')).toContainText('入口 C 文件必须定义 main');
 await page.getByLabel('入口 C 文件').selectOption('src/start.c');await success(page);await load.click();await expect(page.getByTestId('sdcc-status')).toContainText('已校验文件摘要');
 await page.getByLabel('最大执行单元').fill('1000');await page.locator('.control-strip').getByRole('button',{name:'运行'}).click();await expect(page.locator('.footer-status')).toContainText('步数上限');
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出工作区',exact:true}).click();const snapshot=JSON.parse(await readFile((await(await downloaded).path())!,'utf8'));expect(snapshot.cpu.sfr[0x10]).toBe(11);
});
test('本地草稿跨视图/刷新显式恢复，保存坏源码，不恢复 CPU 或旧产物',async({page})=>{
 await page.goto('/#editor');await page.getByRole('button',{name:'C + SDAS 示例',exact:true}).click();await tools(page);
 const edit=page.getByLabel('C 编译源码');await add(page,'include/todo.h','#error DRAFT_PENDING\n');
 await page.getByRole('button',{name:'保存本地 C/SDAS 草稿'}).click();await expect(page.getByTestId('c-draft-save-state')).toContainText('已保存');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('emuc51.c-draft.v1')!));expect(Object.keys(saved).sort()).toEqual(['format','input','selected','version']);
 await edit.fill('#error NOT_SAVED\n');await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'SYS_MEM',exact:true}).click();
 await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'BIN_INSPECTOR',exact:true}).click();await expect(edit).toHaveValue('#error NOT_SAVED\n');
 await tools(page);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿'}).click();await expect(edit).toHaveValue('#error NOT_SAVED\n');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿'}).click();await expect(edit).toHaveValue('#error DRAFT_PENDING\n');
 await page.reload();await tools(page);await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿'}).click();await expect(page.getByLabel('编译源文件',{exact:true})).toHaveValue('include/todo.h');await expect(edit).toHaveValue('#error DRAFT_PENDING\n');
 await expect(page.getByRole('button',{name:'加载 C 编译固件'})).toBeDisabled();await expect(page.getByRole('button',{name:'单步'})).toBeDisabled();await expect(page.locator('.run-state')).toContainText('已暂停');
 await page.getByTestId('workbench-firmware-input').setInputFiles({name:'loop.bin',mimeType:'application/octet-stream',buffer:Buffer.from([0x80,0xfe])});await expect(page.getByTestId('firmware-name')).toContainText('loop.bin');
 await tools(page);const pc=await page.getByTestId('register-PC').textContent();await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿'}).click();await expect(page.getByTestId('register-PC')).toHaveText(pc!);await expect(page.getByTestId('firmware-name')).toContainText('loop.bin');
 await page.evaluate(()=>{const remove=Storage.prototype.removeItem;let first=true;Storage.prototype.removeItem=function(key){if(key==='emuc51.c-draft.v1'&&first){first=false;throw new Error('storage denied');}return remove.call(this,key);};});
 await page.getByRole('button',{name:'CLEAR_LOCAL'}).click();await expect(page.getByRole('alert')).toContainText('无法清除本地 C/SDAS 草稿');await expect(page.getByTestId('firmware-name')).toContainText('loop.bin');
 await page.getByRole('button',{name:'单步'}).click();await expect(page.getByTestId('register-PC')).toContainText('0000');
 await page.getByRole('button',{name:'CLEAR_LOCAL'}).click();await expect(page.getByTestId('firmware-name')).toHaveCount(0);expect(await page.evaluate(()=>localStorage.getItem('emuc51.c-draft.v1'))).toBeNull();
});
test('草稿损坏/配额拒绝不替换当前编辑；非法路径及编译中结构变化隔离旧结果',async({page})=>{
 await page.goto('/#editor');await page.getByRole('button',{name:'C + SDAS 示例',exact:true}).click();await tools(page);const edit=page.getByLabel('C 编译源码'),initial=await edit.inputValue();
 await page.getByRole('button',{name:'保存本地 C/SDAS 草稿'}).click();const saved=await page.evaluate(()=>localStorage.getItem('emuc51.c-draft.v1'));
 await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='emuc51.c-draft.v1')throw new DOMException('test quota','QuotaExceededError');return set.call(this,key,value);};});
 await edit.fill(initial+'\n/* retained */');await page.getByRole('button',{name:'保存本地 C/SDAS 草稿'}).click();await expect(page.getByRole('alert')).toContainText('无法保存');expect(await page.evaluate(()=>localStorage.getItem('emuc51.c-draft.v1'))).toBe(saved);
 // setItem's injected failure is limited to this page realm; corrupt storage through its property API.
 await page.evaluate(()=>{localStorage['emuc51.c-draft.v1']='{"format":"emuc51-c-draft","version":9}';});await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿'}).click();await expect(page.getByRole('alert')).toContainText('版本');await expect(edit).toHaveValue(initial+'\n/* retained */');
 await page.getByLabel('工程文件路径').fill('../escape.c');await page.getByRole('button',{name:'新增工程文件'}).click();await expect(page.getByRole('region',{name:'混合工程文件管理'}).getByRole('alert')).toBeVisible();await expect(edit).toHaveValue(initial+'\n/* retained */');
 await build(page);await add(page,'src/next.c','void extra(void) {}\n');await expect(page.getByRole('button',{name:'加载 C 编译固件'})).toBeDisabled();await expect(page.getByRole('region',{name:'构建诊断'})).toHaveCount(0);await success(page);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
