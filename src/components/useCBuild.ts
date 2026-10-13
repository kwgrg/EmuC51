import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildStageLog, CBuildInput, CBuildResult } from "../core/sdcc-build";
import type { CBuildEvent } from "../worker/compiler.worker";

export function useCBuild(input: CBuildInput, epoch: number) {
  const latest=useRef(input); latest.current=input;
  const generation=useRef(epoch); generation.current=epoch;
  const task=useRef<{worker:Worker;timer:ReturnType<typeof setTimeout>} | undefined>(undefined);
  const sequence=useRef(0);
  const published=useRef<CBuildResult | undefined>(undefined);
  const [result,setResult]=useState<{input:CBuildInput;epoch:number;value:CBuildResult}>();
  const [report,setReport]=useState<{input:CBuildInput;epoch:number;stages:BuildStageLog[]}>();
  const [building,setBuilding]=useState(false);
  const [message,setMessage]=useState("编辑草稿后在浏览器内编译；草稿仅保留在当前页面");
  const stop=useCallback(()=>{if(task.current){task.current.worker.terminate();clearTimeout(task.current.timer);task.current=undefined;}},[]);
  const cancel=useCallback(()=>{stop();published.current=undefined;setBuilding(false);setResult(undefined);setReport(undefined);setMessage("编译已取消或草稿已变更");},[stop]);
  useEffect(()=>{cancel();},[input,epoch,cancel]);
  useEffect(()=>()=>{stop();published.current=undefined;},[stop]);
  const build=()=>{
    stop();published.current=undefined;setResult(undefined);setReport(undefined);setBuilding(true);setMessage("正在浏览器内编译…");
    const id=++sequence.current;
    let worker:Worker;
    try { worker=new Worker(new URL("../worker/compiler.worker.ts",import.meta.url),{type:"module",name:"emuc51-sdcc"}); }
    catch(error){setBuilding(false);setMessage(String(error));return;}
    const current=()=>task.current?.worker===worker&&latest.current===input&&generation.current===epoch;
    const finish=(message:string)=>{stop();setBuilding(false);setMessage(message);};
    const timer=setTimeout(()=>{if(current())finish("编译超过 30 秒，Worker 已终止；未生成产物");},30000);
    task.current={worker,timer};
    worker.onmessage=(event:MessageEvent<CBuildEvent>)=>{
      if(!current()||event.data.id!==id)return;
      const value=event.data.result;
      setReport({input,epoch,stages:value?.diagnosticStages ?? event.data.diagnosticStages ?? []});
      if(value){published.current=value;setResult({input,epoch,value});finish(`编译成功：${Math.round(value.milliseconds)} ms；可加载固件或下载构建包`);}
      else finish(event.data.error??"编译失败；未生成产物");
    };
    worker.onerror=()=>{if(current())finish("编译 Worker 失败；未生成产物");};
    worker.postMessage({id,input});
  };
  const artifact=result?.input===input&&result.epoch===epoch?result.value:undefined;
  const isCurrent=(value:CBuildResult)=>published.current===value&&result?.value===value&&latest.current===result.input&&generation.current===result.epoch;
  return {artifact,building,message,build,cancel,isCurrent,report:report?.input===input&&report.epoch===epoch?report:undefined};
}
