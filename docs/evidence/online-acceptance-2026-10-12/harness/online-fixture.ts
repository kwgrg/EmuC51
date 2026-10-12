import { test as base, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export { expect };
export const test=base.extend({page:async({page,context},use,testInfo)=>{
 const events:any[]=[];const errors:string[]=[];const failed:any[]=[];const pending:Promise<any>[]=[];
 context.on('request',r=>events.push({kind:'request',time:new Date().toISOString(),url:r.url(),method:r.method(),body:r.postData(),type:r.resourceType()}));
 context.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()}));
 context.on('response',r=>{pending.push((async()=>{const headers=await r.allHeaders();let sha256;try{sha256=createHash('sha256').update(await r.body()).digest('hex');}catch{}events.push({kind:'response',time:new Date().toISOString(),url:r.url(),status:r.status(),headers,sha256});})());});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
 await use(page);
 await page.screenshot({path:testInfo.outputPath('final.png'),fullPage:true});
 await Promise.allSettled(pending);
 await writeFile(testInfo.outputPath('network.json'),JSON.stringify({title:testInfo.title,events,errors,failed},null,2));
 expect(errors).toEqual([]);
 expect(events.filter(e=>e.kind==='response'&&e.status>=400)).toEqual([]);
 expect(events.filter(e=>e.kind==='request'&&(!e.url.startsWith('https://emuc51.kwgrg-01.workers.dev/')||e.method!=='GET'||e.body!==null))).toEqual([]);
}});
