/* global window */
// Local-only visual review. Build first; uses the exact production CSP.
import { readFileSync, mkdirSync } from 'node:fs';
import process from 'node:process';
import { preview } from 'vite';
import { chromium } from '@playwright/test';
const label=process.argv[2] ?? 'after';
if(!/^[a-z]+$/.test(label)) throw new Error('Use a simple snapshot label');
const directory='docs/screenshots/neutral-workbench';mkdirSync(directory,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:41853,strictPort:true,headers:{'Content-Security-Policy':readFileSync('public/_headers','utf8').match(/Content-Security-Policy: (.+)/)[1]}}});
const browser=await chromium.launch({executablePath:process.env.EMUC51_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true});
try {
  for(const [name,view,width,height] of [['home','home',1440,1000],['editor','editor',1440,1000],['memory','memory',1440,1000],['io','io',1440,1000],['mobile','editor',390,844],['tablet','editor',820,1024]]) {
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
    await page.goto('http://127.0.0.1:41853/#'+view);await page.getByRole('main').waitFor();
    await page.screenshot({path:`${directory}/${label}-${name}.png`});await page.close();
  }
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:41853/#editor');
  await page.getByRole('button',{name:'C + SDAS 示例',exact:true}).click();
  await page.getByRole('button',{name:'编译 C 工程',exact:true}).click();
  await page.getByTestId('c-build-status').filter({hasText:'编译成功'}).waitFor();
  await page.getByRole('button',{name:'加载 C 编译固件'}).click();
  await page.getByTestId('sdcc-status').filter({hasText:'已校验文件摘要'}).waitFor();
  await page.getByLabel('最大执行单元').fill('1000');
  await page.locator('.control-strip').getByRole('button',{name:'运行',exact:false}).first().click();
  await page.locator('.footer-status').filter({hasText:'步数上限'}).waitFor();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${directory}/${label}-mixed-debug.png`});
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'SYS_MEM'}).click();
  await page.locator('.memory-row').first().waitFor();
  await page.screenshot({path:`${directory}/${label}-loaded-memory.png`});
  await page.close();
} finally {await browser.close();await server.close();}
