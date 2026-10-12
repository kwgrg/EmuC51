import {chromium} from '@playwright/test';
import fs from 'node:fs';
const dir='/workspace/acceptance-evidence';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',proxy:{server:process.env.HTTPS_PROXY},headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordHar:{path:dir+'/probe.har',content:'omit'}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{const r=await page.goto('https://emuc51.kwgrg-01.workers.dev/',{waitUntil:'networkidle'});await page.screenshot({path:dir+'/online-home.png'});fs.writeFileSync(dir+'/browser-probe.json',JSON.stringify({time:new Date().toISOString(),status:r.status(),headers:await r.allHeaders(),text:await page.locator('body').innerText(),errors},null,2));console.log(await page.title(),r.status(),await page.getByRole('main').getAttribute('data-view'));}finally{await context.close();await browser.close();}
