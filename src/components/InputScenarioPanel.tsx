import { useEffect, useRef, useState } from "react";
import { MAX_SCENARIO_BYTES, parseInputScenario, type InputScenario, type ReplayView } from "../core/input-scenario";
import exampleSource from "../examples/scenario-timer-uart.asm?raw";
import exampleScenario from "../examples/scenario-timer-uart.json";
const PAGE_SIZE = 50;
function download(text: string, name: string) {
  const url=URL.createObjectURL(new Blob([text],{type:"text/plain"}));
  const link=document.createElement("a"); link.href=url; link.download=name; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function InputScenarioPanel({scenario,replay,disabled,running,pending,firmwareSha256,onInstall,onStart,onCancel,onClear}: {
  scenario?:InputScenario; replay:ReplayView; disabled:boolean; running:boolean; pending:boolean; firmwareSha256?:string;
  onInstall:(value:InputScenario)=>void; onStart:()=>void; onCancel:()=>void; onClear:()=>void;
}) {
  const [importing,setImporting]=useState(false);
  const [draft,setDraft]=useState(()=>scenario?JSON.stringify(scenario,null,2):""); const [error,setError]=useState(""); const [page,setPage]=useState(0);
  const reading=useRef(0), locked=useRef(false);
  locked.current=disabled||running||pending||replay.active;
  useEffect(()=>()=>{reading.current+=1;},[]);
  const install=(text:string)=>{try {const value=parseInputScenario(text); onInstall(value);setError("");setPage(0);}catch(caught){setError((caught as Error).message);}};
  const importFile=async(file:File)=>{
    const generation=++reading.current;setImporting(true);
    try {
      if(file.size>MAX_SCENARIO_BYTES)throw new Error("输入场景超过 128 KiB 上限");
      const text=await file.text();
      if(generation!==reading.current||locked.current)return;
      const parsed=parseInputScenario(text); setDraft(text);onInstall(parsed);setError("");setPage(0);
    }catch(caught){if(generation===reading.current)setError((caught as Error).message);}
    finally {if(generation===reading.current)setImporting(false);}
  };
  const pages=Math.max(1,Math.ceil((scenario?.events.length??0)/PAGE_SIZE));
  const currentPage=Math.min(page,pages-1);
  return <section className="input-scenario-panel" aria-label="输入场景重放">
    <h2>输入场景重放</h2>
    <p>默认关闭。JSON 仅接受 GPIO/UART 事件；按机器周期在下次执行边界投递，不是电气波形。刷新保留定义及 CPU，停用调度。重新重放会清空 CPU 内存并从零开始。</p>
    <p data-testid="scenario-status">{pending?"正在验证场景…":!scenario?"未准备场景":`${scenario.name} · ${replay.active?"重放已启用":"调度未启用"} · 已投递 ${replay.delivered.length}/${scenario.events.length}`}</p>
    {scenario&&<p className="scenario-digest">固件 SHA-256：{scenario.firmwareSha256}</p>}
    <div className="asm-actions">
      <button disabled={locked.current||importing} onClick={()=>{reading.current+=1;setDraft(JSON.stringify({format:"emuc51-input-scenario",version:1,name:"我的输入场景",firmwareSha256,events:[{cycle:40,type:"gpio",port:3,value:251},{cycle:44,type:"gpio",port:3,value:255},{cycle:80,type:"uart",value:65,ninthBit:true}]},null,2));}}>生成当前固件模板</button>
      <label>导入场景 JSON<input aria-label="导入场景 JSON" type="file" accept=".json" disabled={locked.current||importing} onChange={event=>{const file=event.target.files?.[0];if(file)void importFile(file);event.target.value="";}} /></label>
      <button onClick={()=>download(exampleSource,"scenario-timer-uart.asm")}>下载 Timer/UART/INT0 示例 ASM</button>
      <button disabled={locked.current||importing} onClick={()=>{reading.current+=1;const text=JSON.stringify(exampleScenario,null,2);setDraft(text);install(text);}}>准备示例场景</button>
    </div>
    <p>示例：先在 ASM 工作台导入、构建并加载上述源码，再准备示例场景；运行 1500 个执行单元后 UART 应回显 AB，IRAM 30h=01、32h=42、33h=02。</p>
    <label>场景 JSON<textarea aria-label="场景 JSON" maxLength={MAX_SCENARIO_BYTES} value={draft} disabled={locked.current||importing} onChange={event=>{reading.current+=1;setDraft(event.target.value);}} /></label>
    <div className="asm-actions">
      <button disabled={locked.current||importing||!draft} onClick={()=>{reading.current+=1;install(draft);}}>验证并准备场景</button>
      <button disabled={!scenario||pending} onClick={()=>scenario&&download(JSON.stringify(scenario,null,2),"input-scenario.json")}>导出场景</button>
      <button disabled={!scenario||disabled||running||pending||importing||replay.active} onClick={()=>{setPage(0);onStart();}}>从干净复位重放</button>
      <button disabled={!replay.active&&!pending&&!importing} onClick={()=>{reading.current+=1;setImporting(false);onCancel();}}>取消输入重放</button>
      <button disabled={!scenario||locked.current||importing} onClick={onClear}>移除场景</button>
    </div>
    {error&&<p role="alert">{error}</p>}
    {scenario&&<>
      <p>启用后使用顶部单步/运行推进；手工输入、内存和寄存器写入须先取消。取消不撤回 UART 队列中的字节。</p>
      <div className="asm-actions"><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>场景上一页</button><span>{currentPage+1} / {pages}</span><button disabled={currentPage+1===pages} onClick={()=>setPage(currentPage+1)}>场景下一页</button></div>
      <div className="scenario-timeline" aria-label="输入投递时间线">{scenario.events.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE).map((event,index)=>{
        const ordinal=currentPage*PAGE_SIZE+index;
        return <p key={ordinal} data-testid="scenario-event">#{ordinal+1} · 目标 {event.cycle} → {replay.delivered[ordinal]===undefined?"未投递":`实际 ${replay.delivered[ordinal]}`} · {event.type==="gpio"?`P${event.port}=${event.value.toString(16).padStart(2,"0")}`:`UART ${event.value.toString(16).padStart(2,"0")} / bit9=${Number(event.ninthBit)}`}</p>;
      })}</div>
    </>}
  </section>;
}
