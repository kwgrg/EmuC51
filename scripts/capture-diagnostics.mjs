/* global window, document, URL, console */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import process from 'node:process';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium,expect} from '@playwright/test';
const external=process.env.EMUC51_ACCEPTANCE_URL;
const directory=process.env.EMUC51_EVIDENCE_DIR||'docs/screenshots/sdcc-diagnostics';mkdirSync(directory,{recursive:true});
const server=external?undefined:await preview({preview:{host:'127.0.0.1',port:41854,strictPort:true,headers:{'Content-Security-Policy':readFileSync('public/_headers','utf8').match(/Content-Security-Policy: (.+)/)[1]}}});
const base=external||'http://127.0.0.1:41854';
const browser=await chromium.launch({executablePath:process.env.EMUC51_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',...(external?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const network=[],errors=[],environmentNotes=[],failed=[],pending=[];context.on('request',r=>network.push({kind:'request',method:r.method(),url:r.url(),body:r.postData()}));
context.on('requestfailed',r=>failed.push({url:r.url(),failure:r.failure()}));
context.on('response',r=>pending.push((async()=>{const entry={kind:'response',url:r.url(),status:r.status(),headers:await r.allHeaders()};try{entry.sha256=createHash('sha256').update(await r.body()).digest('hex');}catch{entry.unavailable='response body unavailable';}network.push(entry);})()));
await context.tracing.start({screenshots:true,snapshots:true,sources:true});
try{
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'){const entry={text:m.text(),location:m.location()};if(!external&&entry.location.url===base+'/favicon.ico')environmentNotes.push(entry);else errors.push(entry);}});
 await page.goto(base+'/#editor');
 await page.getByLabel('导入 SDCC 构建文件').setInputFiles('tests/fixtures/sdcc-mixed/emuc51-project.build.json');await expect(page.getByTestId('sdcc-status')).toContainText('已校验文件摘要');await page.getByRole('button',{name:'编辑已加载 C 工程',exact:true}).click();
 const select=page.getByLabel('编译源文件',{exact:true}),edit=page.getByLabel('C 编译源码');
 const header=readFileSync('tests/fixtures/sdcc-mixed/project/include/shared.h','utf8'),asm=readFileSync('tests/fixtures/sdcc-mixed/project/asm/bridge.asm','utf8');
 const build=()=>page.getByRole('button',{name:'编译 C 工程',exact:true}).click();
 await select.selectOption('include/shared.h');await edit.fill(header+'\n#error HEADER_DIAGNOSTIC\n');await select.selectOption('src/main.c');await build();
 await page.getByRole('button',{name:'定位诊断 include/shared.h:10:2',exact:true}).click();await expect(select).toHaveValue('include/shared.h');await expect(edit).toBeFocused();
 await page.getByText('原始构建日志',{exact:true}).click();await page.locator('.compiler-diagnostics').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/header-diagnostic.png'});
 await edit.fill(header);await select.selectOption('asm/bridge.asm');await edit.fill(asm+'\n mov a,#\n');await select.selectOption('src/main.c');await build();
 await page.getByRole('button',{name:'定位诊断 asm/bridge.asm:27',exact:true}).click();await expect(select).toHaveValue('asm/bridge.asm');assert.equal(await edit.evaluate(e=>e.value.slice(e.selectionStart,e.selectionEnd)),' mov a,#');
 await page.locator('.compiler-diagnostics').scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/asm-diagnostic.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'定位诊断 asm/bridge.asm:27',exact:true}).click();await page.screenshot({path:directory+'/mobile-location.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await edit.fill(asm);await expect(page.getByRole('region',{name:'构建诊断'})).toHaveCount(0);await build();await expect(page.getByTestId('c-build-status')).toContainText('编译成功');
 await page.getByRole('button',{name:'加载 C 编译固件'}).click();await expect(page.getByTestId('sdcc-status')).toContainText('已校验文件摘要');await page.getByLabel('最大执行单元').fill('1000');await page.locator('.control-strip').getByRole('button',{name:'运行'}).click();await expect(page.locator('.footer-status')).toContainText('步数上限');
 await page.getByRole('button',{name:'观察 CDB::main::G$word_result$0_0$0',exact:true}).click();await expect(page.getByTestId('symbol-integer')).toHaveText('4864');
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:directory+'/repaired-running.png'});
 await Promise.all(pending);if(errors.length)console.error(JSON.stringify(errors));assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert(network.filter(e=>e.kind==='request').every(e=>e.method==='GET'&&e.body===null&&e.url.startsWith(base+'/')));assert(network.filter(e=>e.kind==='response').every(e=>e.status===200));
 if(external){for(const entry of network.filter(e=>e.kind==='response')){const pathname=new URL(entry.url).pathname;const file='dist'+(pathname==='/'?'/index.html':pathname);assert.equal(entry.sha256,createHash('sha256').update(readFileSync(file)).digest('hex'),entry.url);}}
 writeFileSync(directory+'/validation.json',JSON.stringify({date:new Date().toISOString(),base,chromium:browser.version(),result:'passed',errors,environmentNotes,failed,network},null,2)+'\n');console.log('Diagnostic workflow passed:',directory);
}finally{await context.tracing.stop({path:directory+'/trace.zip'});await context.close();await browser.close();if(server)await server.close();}
