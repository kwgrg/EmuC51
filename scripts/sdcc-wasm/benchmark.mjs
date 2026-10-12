/* global URL, setInterval, clearInterval, setTimeout, clearTimeout, performance, Worker, console */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createServer } from "node:http";
import process from "node:process";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
// Default uses production CSP; --deny-wasm is a local negative control only.
const root=resolve('dist'),allow=!process.argv.includes('--deny-wasm');
const production=readFileSync('public/_headers','utf8').match(/Content-Security-Policy: (.+)/)[1];
const policy=allow?production:production.replace(" 'wasm-unsafe-eval'","");
const server=createServer((req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+'/')){res.writeHead(404);res.end();return;}
  try{const bytes=readFileSync(path);res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript; charset=utf-8':extname(path)==='.html'?'text/html; charset=utf-8':'application/octet-stream');res.setHeader('Content-Security-Policy',policy);res.setHeader('Cache-Control','public, max-age=3600');res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(41852,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.EMUC51_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true});
try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:41852/index.html');
  const session=await browser.newBrowserCDPSession();
  const requests=[];page.on('request',r=>requests.push({method:r.method(),url:r.url(),body:r.postData()}));
  const worker='/assets/'+readdirSync(root+'/assets').find(n=>n.startsWith('compiler.worker-')&&n.endsWith('.js'));
  const input={files:[{path:'main.c',text:readFileSync('tests/fixtures/sdcc-counter/main.c','utf8')}]};
  const sample=async()=>{const {processInfo}=await session.send('SystemInfo.getProcessInfo');return processInfo.filter(p=>p.type==='renderer').reduce((sum,p)=>{try{return sum+Number(readFileSync(`/proc/${p.id}/status`,'utf8').match(/^VmRSS:\s+(\d+)/m)[1])*1024;}catch{return sum;}},0);};
  const baselineRss=await sample();let peakRss=baselineRss,sampling=false;
  const timer=setInterval(async()=>{if(sampling)return;sampling=true;try{peakRss=Math.max(peakRss,await sample());}finally{sampling=false;}},10);
  const trials=[];
  try {for(let i=0;i<(allow?5:1);i++){
    const result=await page.evaluate(({worker,input})=>new Promise(resolve=>{const start=performance.now();const w=new Worker(worker,{type:'module'});const timer=setTimeout(()=>{w.terminate();resolve({error:'probe timeout'});},30000);w.onmessage=e=>{clearTimeout(timer);w.terminate();resolve({...e.data,wallMilliseconds:performance.now()-start});};w.onerror=e=>{clearTimeout(timer);w.terminate();resolve({error:e.message});};w.postMessage({id:1,input});}),{worker,input});
    if(!allow){assert.match(result.error,/Content Security|unsafe-eval|WASM|WebAssembly/i);trials.push({blocked:true,error:result.error});break;}
    assert(result.result,result.error);assert.equal(result.result.data.ihx,readFileSync('tests/fixtures/sdcc-counter/main.ihx','utf8'));assert.equal(result.result.data.cdb,readFileSync('tests/fixtures/sdcc-counter/main.cdb','utf8'));
    trials.push({wallMilliseconds:result.wallMilliseconds,compileMilliseconds:result.result.milliseconds,maxStageHeapBytes:result.result.maxStageHeapBytes});
  }}finally{clearInterval(timer);}
  let cancellation;
  if(allow) cancellation=await page.evaluate(({worker})=>new Promise(resolve=>{
    let messages=0;const w=new Worker(worker,{type:'module'});w.onmessage=()=>messages++;
    const text='void main(void) { volatile unsigned int x=1;'+Array(1600).fill('x=(x*37+19)/(x+1);').join('')+'for (;;) {} }';
    w.postMessage({id:2,input:{files:[{path:'stress.c',text}]}});
    setTimeout(()=>{const started=performance.now();w.terminate();const terminateMilliseconds=performance.now()-started;setTimeout(()=>resolve({terminateMilliseconds,messagesAfterTermination:messages,workload:'1600 volatile arithmetic statements; terminate at 100ms; observe another 200ms'}),200);},100);
  }),{worker});
  if(cancellation)assert.equal(cancellation.messagesAfterTermination,0);
  assert(requests.every(r=>r.method==='GET'&&r.body===null&&r.url.startsWith('http://127.0.0.1:41852/')));
  console.log(JSON.stringify({chromium:browser.version(),policyMode:allow?'production policy':'local negative control without WASM permission',policy,trials,cancellation,baselineRendererRssBytes:baselineRss,peakRendererRssBytes:peakRss,memoryScope:'10ms samples of sum of Chromium renderer RSS, includes page, worker, JIT and browser overhead; sampling can miss transients. maxStageHeapBytes is exact monotonic WASM linear memory high-water for each stage, not total browser memory.',requests},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
