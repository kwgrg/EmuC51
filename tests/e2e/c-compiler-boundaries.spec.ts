import { expect, test, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import type { CBuildInput } from "../../src/core/sdcc-build";
import type { CBuildEvent } from "../../src/worker/compiler.worker";
async function build(page: Page, input: CBuildInput): Promise<CBuildEvent> {
  const worker = (await readdir('dist/assets')).find(name => /^compiler\.worker-.*\.js$/.test(name))!;
  return page.evaluate(({worker,input}) => new Promise(resolve => {
    const task = new Worker(`/assets/${worker}`, {type:'module'});
    task.onmessage = event => {task.terminate(); resolve(event.data);};
    task.onerror = event => {task.terminate(); resolve({id:1,error:event.message});};
    task.postMessage({id:1,input});
  }), {worker,input});
}
async function mixed(): Promise<CBuildInput> {
  const data=JSON.parse(await readFile('tests/fixtures/sdcc-mixed/emuc51-project.build.json','utf8'));
  return {project:data.project,files:data.inputs.map(({path,text}:{path:string;text:string})=>({path,text}))};
}
test('真实混合编译拒绝最终转义 JSON 超过 2 MiB',async({page})=>{
  await page.goto('/#editor');
  const input=await mixed();
  for(let i=0;i<7;i++) { const path=`padding${i}.h`; input.project!.headers.push(path); input.files.push({path,text:'/*'+'\u0001'.repeat(60000)+'*/'}); }
  const event=await build(page,input);
  console.log('bundle boundary:', JSON.stringify({error:event.error, bytes:event.result?Buffer.byteLength(JSON.stringify(event.result.data,null,2)):undefined}));
  expect(event.result).toBeUndefined(); expect(event.error).toContain('2 MiB');
});
test('真实混合编译保留 BOM 入口和摘要并可重新导入',async({page})=>{
  await page.goto('/#editor');
  const input=await mixed(),entry=input.files.find(file=>file.path===input.project!.entry)!;
  entry.text='\ufeff'+entry.text;
  const event=await build(page,input);
  expect(event.error).toBeUndefined(); expect(event.result?.data.source).toBe(entry.text);
  const data=event.result!.data;
  expect(data.inputs!.find(file=>file.path===input.project!.entry)!.text).toBe(entry.text);
  await page.getByLabel('导入 SDCC 构建文件').setInputFiles({name:'emuc51-project.build.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data,null,2)+'\n')});
  await expect(page.getByTestId('sdcc-status')).toContainText('已校验文件摘要');
});
