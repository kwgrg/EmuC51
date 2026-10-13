/* global window, document, localStorage, console */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium,expect} from '@playwright/test';
const directory='docs/screenshots/c-project-editor';mkdirSync(directory,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:41855,strictPort:true,headers:{'Content-Security-Policy':readFileSync('public/_headers','utf8').match(/Content-Security-Policy: (.+)/)[1]}}});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium'}),context=await browser.newContext({viewport:{width:1440,height:1000}});
const network=[],errors=[],environmentNotes=[];context.on('request',r=>network.push({url:r.url(),method:r.method(),body:r.postData()}));context.on('requestfailed',r=>errors.push({url:r.url(),failure:r.failure()}));
await context.tracing.start({snapshots:true,screenshots:true,sources:true});
try{
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'){const entry={text:m.text(),location:m.location()};if(entry.location.url==='http://127.0.0.1:41855/favicon.ico')environmentNotes.push(entry);else errors.push(entry);}});
 await page.goto('http://127.0.0.1:41855/#editor');await page.getByRole('button',{name:'C + SDAS 示例',exact:true}).click();await page.locator('.c-project-tools summary').click();
 const edit=page.getByLabel('C 编译源码'),select=page.getByLabel('编译源文件',{exact:true});
 const add=async(path,text)=>{await page.getByLabel('工程文件路径').fill(path);await page.getByRole('button',{name:'新增工程文件'}).click();await expect(select).toHaveValue(path);await edit.fill(text);};
 await add('include/value.h','unsigned char helper(unsigned char value);\n');await add('src/helper.c','#include "value.h"\nunsigned char helper(unsigned char value) { return value + 4; }\n');
 await select.selectOption('main.c');await edit.fill((await edit.inputValue()).replace('#include <8051.h>','#include <8051.h>\n#include "value.h"').replace('add_two(5)','add_two(helper(5))'));
 await page.getByLabel('工程文件路径').fill('src/start.c');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'重命名当前文件'}).click();await expect(page.getByLabel('入口 C 文件')).toHaveValue('src/start.c');
 await page.getByRole('button',{name:'保存本地 C/SDAS 草稿'}).click();await expect(page.getByTestId('c-draft-save-state')).toContainText('已保存');
 await page.locator('.c-project-tools').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/desktop-project.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('.c-project-tools').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:directory+'/mobile-project.png'});
 await page.setViewportSize({width:1440,height:1000});await page.reload();await page.locator('.c-project-tools summary').click();await page.getByRole('button',{name:'恢复本地 C/SDAS 草稿'}).click();await expect(select).toHaveValue('src/start.c');await expect(page.getByRole('button',{name:'加载 C 编译固件'})).toBeDisabled();await expect(page.getByRole('button',{name:'单步'})).toBeDisabled();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('emuc51.c-draft.v1')));assert.equal(saved.input.files.length,4);assert.deepEqual(Object.keys(saved).sort(),['format','input','selected','version']);
 await page.locator('.c-project-tools').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/restored-draft.png'});
 await page.getByRole('button',{name:'编译 C 工程',exact:true}).click();await expect(page.getByTestId('c-build-status')).toContainText('编译成功');await page.getByRole('button',{name:'加载 C 编译固件'}).click();await expect(page.getByTestId('sdcc-status')).toContainText('已校验文件摘要');
 await page.getByLabel('最大执行单元').fill('1000');await page.locator('.control-strip').getByRole('button',{name:'运行'}).click();await expect(page.locator('.footer-status')).toContainText('步数上限');
 const next=page.waitForEvent('download');await page.getByRole('button',{name:'导出工作区',exact:true}).click();const snapshot=JSON.parse(readFileSync(await(await next).path(),'utf8'));assert.equal(snapshot.cpu.sfr[0x10],11);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:directory+'/compiled-runtime.png'});
 assert.deepEqual(errors,[]);assert(network.every(r=>r.method==='GET'&&r.body===null&&r.url.startsWith('http://127.0.0.1:41855/')));
 writeFileSync(directory+'/validation.json',JSON.stringify({date:new Date().toISOString(),scope:'local production build with production CSP; no production retry',chromium:browser.version(),files:saved.input.files.map(f=>f.path),entry:saved.input.project.entry,p1:snapshot.cpu.sfr[0x10],draftKeys:Object.keys(saved),errors,environmentNotes,network},null,2)+'\n');console.log('Project/draft browser capture passed');
}finally{await context.tracing.stop({path:directory+'/trace.zip'});await context.close();await browser.close();await server.close();}
