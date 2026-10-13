import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CProjectManager } from "./CProjectManager";
import { readCDraft, saveCDraft, C_DRAFT_KEY, type CEditorSession } from "../persistence/c-draft";
import { buildDiagnostics, type BuildDiagnostic } from "../core/sdcc-diagnostics";
import type { CBuildInput } from "../core/sdcc-build";
import type { SdccDebugData } from "../core/sdcc-debug";
import { useCBuild } from "./useCBuild";
import { PROJECT_OPTIONS, serializeSdccBundle } from "../core/sdcc-project";
const counter="#include <8051.h>\nvolatile __data unsigned char counter;\nvoid main(void) {\n  counter = 0;\n  for (;;) {\n    P1 = counter;\n    counter++;\n  }\n}\n";
const single: CBuildInput={files:[{path:"main.c",text:counter}]};
const mixed: CBuildInput={project:{format:"emuc51-sdcc-project",version:1,entry:"main.c",sources:[{path:"main.c",language:"c"},{path:"bridge.asm",language:"sdas8051"}],headers:[],includeDirs:[],options:[...PROJECT_OPTIONS]},files:[{path:"main.c",text:"#include <8051.h>\nunsigned char add_two(unsigned char value);\nvoid main(void) {\n  P1 = add_two(5);\n  for (;;) {}\n}\n"},{path:"bridge.asm",text:".module bridge\n.globl _add_two\n.area CSEG (CODE)\n_add_two:\n mov a,dpl\n add a,#2\n mov dpl,a\n ret\n"}]};
const fromImported=(data?:SdccDebugData):CBuildInput=>data ? (data.project ? {project:data.project,files:data.inputs!.map(({path,text})=>({path,text}))} : {files:[{path:data.manifest.files.source.name,text:data.source}]}) : single;
export function CCompilerPanel({disabled,epoch,imported,onLoad,session}:{disabled:boolean;epoch:number;imported?:SdccDebugData;onLoad:(data:SdccDebugData,current:()=>boolean)=>void;session:RefObject<CEditorSession|undefined>}) {
  const [input,setInput]=useState<CBuildInput>(()=>session.current?.input ?? fromImported(imported));
  const [selected,setSelected]=useState(()=>session.current?.selected ?? input.files[0]!.path);
  const [baseline,setBaseline]=useState(()=>session.current?.baseline ?? input);
  const [savedInput,setSavedInput]=useState(session.current?.savedInput);
  const [draftMessage,setDraftMessage]=useState(''),[draftError,setDraftError]=useState('');
  const editor=useRef<HTMLTextAreaElement>(null);
  const [navigation,setNavigation]=useState<{diagnostic:BuildDiagnostic;input:CBuildInput;epoch:number}>();
  const build=useCBuild(input,epoch);
  const diagnostics=useMemo(()=>build.report ? buildDiagnostics(build.report.stages,input) : [],[build.report,input]);
  const dirty=useMemo(()=>JSON.stringify(input)!==JSON.stringify(baseline),[input,baseline]);
  const matchesLoaded=useMemo(()=>Boolean(imported)&&JSON.stringify(input)===JSON.stringify(fromImported(imported)),[input,imported]);
  useLayoutEffect(()=>{session.current={input,baseline,selected,unsaved:dirty&&!matchesLoaded,savedInput};},[session,input,baseline,selected,dirty,matchesLoaded,savedInput]);
  const currentNavigation=navigation?.input===input&&navigation.epoch===epoch&&diagnostics.includes(navigation.diagnostic)?navigation:undefined;
  useLayoutEffect(()=>{
    const target=currentNavigation?.diagnostic.target;
    const element=editor.current;
    if(target && element){
      element.focus();element.setSelectionRange(target.start,target.end);
      const style=getComputedStyle(element);
      element.scrollTop=Math.max(0,(currentNavigation.diagnostic.line-3)*parseFloat(style.lineHeight));
      const canvas=document.createElement("canvas").getContext("2d");
      if(canvas)canvas.font=`${style.fontSize} ${style.fontFamily}`;
      const column=currentNavigation.diagnostic.preciseColumn ? currentNavigation.diagnostic.column! - 1 : 0;
      element.scrollLeft=Math.max(0,column*(canvas?.measureText("0").width ?? 8)-element.clientWidth/2);
      element.scrollIntoView({block:"center"});
    }
  },[currentNavigation]);
  const file=input.files.find(file=>file.path===selected)??input.files[0]!;
  const replace=(value:CBuildInput,selection=value.files[0]!.path,saved=false)=>{
    if(dirty && !window.confirm("当前 C/SDAS 草稿有编辑。替换将丢弃当前草稿，是否继续？"))return;
    setInput(value);setBaseline(value);setSelected(selection);setNavigation(undefined);setSavedInput(saved?value:undefined);setDraftError("");setDraftMessage(saved?"已恢复本地草稿；未加载固件或运行 CPU":"已替换编辑草稿；尚未保存到本地草稿槽");
  };
  const saveDraft=()=>{
    try {
      if(!savedInput&&localStorage.getItem(C_DRAFT_KEY)!==null&&!window.confirm("此浏览器只保存一个 C/SDAS 草稿。用当前草稿覆盖已保存内容？"))return;
      saveCDraft({input,selected});setSavedInput(input);setBaseline(input);setDraftError("");setDraftMessage("草稿已保存到此浏览器；刷新后点击恢复，不会自动运行");
    }catch(caught){setDraftError(`无法保存 C/SDAS 草稿：${caught instanceof Error?caught.message:"浏览器存储不可用"}。当前编辑保留。`);}
  };
  const restoreDraft=()=>{
    try{const value=readCDraft();if(!value)throw new Error("此浏览器没有已保存的 C/SDAS 草稿");replace(value.input,value.selected,true);}
    catch(caught){setDraftError(caught instanceof Error?caught.message:"无法读取本地草稿；当前编辑保留");}
  };
  const download=()=>{
    if(!build.artifact)return;
    const url=URL.createObjectURL(new Blob([serializeSdccBundle(build.artifact.data)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=build.artifact.data.project?"emuc51-project.build.json":"emuc51-browser.build.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="asm-panel" aria-label="浏览器 C 编译">
    <h3>C / SDAS8051 浏览器编译</h3>
    <p>SDCC 4.5.0 · classic 8051 · 128 B IRAM · small。源码留在浏览器；草稿在本次会话内保留；显式保存到此浏览器后可跨刷新恢复。加载固件另行保存其源码和调试信息。</p>
    <div className="asm-actions">
      <button disabled={disabled} onClick={()=>replace(single)}>单文件 C 示例</button>
      <button disabled={disabled} onClick={()=>replace(mixed)}>C + SDAS 示例</button>
      <button disabled={disabled||!imported} onClick={()=>{if(imported)replace(fromImported(imported));}}>编辑已加载 C 工程</button>
    </div>
    <details className="c-project-tools"><summary>工程管理与本地草稿</summary>
      <p>一个本地草稿槽，仅保存工程源码、清单和所选文件，不包含 CPU 状态或编译产物。刷新后需显式恢复；未保存编辑关闭页面可能丢失。</p>
      <div className="asm-actions"><button disabled={disabled} onClick={saveDraft}>保存本地 C/SDAS 草稿</button><button disabled={disabled} onClick={restoreDraft}>恢复本地 C/SDAS 草稿</button></div>
      <p data-testid="c-draft-save-state">{savedInput===input ? "当前草稿内容已保存" : "当前内容尚未保存到本地草稿槽"}</p>
      {draftMessage&&<p role="status">{draftMessage}</p>}{draftError&&<p role="alert">{draftError}</p>}
      <CProjectManager input={input} selected={selected} disabled={disabled} onChange={(value,selection)=>{setInput(value);setSelected(selection);setNavigation(undefined);setDraftError("");}} />
    </details>
    <label>编译源文件 <select aria-label="编译源文件" value={file.path} onChange={event=>{setSelected(event.target.value);setNavigation(undefined);}}>{input.files.map(file=><option key={file.path}>{file.path}</option>)}</select></label>
    <label className="asm-source-label">{file.path}<textarea ref={editor} wrap="off" aria-label="C 编译源码" spellCheck={false} disabled={disabled} value={file.text} onChange={event=>setInput({...input,files:input.files.map(item=>item.path===file.path?{...item,text:event.target.value}:item)})}/></label>
    <p className="compiler-position" role="status">{dirty ? "草稿有编辑（替换前需确认）" : "当前草稿"}{currentNavigation ? ` · ${file.path}:${currentNavigation.diagnostic.line}${currentNavigation.diagnostic.column===undefined ? "（未提供列号，选择整行）" : `:${currentNavigation.diagnostic.column}${currentNavigation.diagnostic.preciseColumn ? "（已定位报告列）" : "（列位置无法精确换算，选择整行）"}`}` : ""}</p>
    <div className="asm-actions">
      <button disabled={disabled||build.building} onClick={build.build}>编译 C 工程</button>
      <button disabled={!build.building} onClick={build.cancel}>取消 C 编译</button>
      <button disabled={disabled||!build.artifact} onClick={()=>{const artifact=build.artifact;if(artifact)onLoad(artifact.data,()=>build.isCurrent(artifact));}}>加载 C 编译固件</button>
      <button disabled={!build.artifact} onClick={download}>下载 C 构建包</button>
    </div>
    <pre role="status" data-testid="c-build-status" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{build.message}{build.artifact?.diagnostics?`\n${build.artifact.diagnostics}`:""}</pre>
    {build.report && <section className="compiler-diagnostics" aria-label="构建诊断">
      <h4>构建诊断 · {diagnostics.length}{diagnostics.length===200 ? "（最多显示 200 项，完整输出见日志）" : ""}</h4>
      {diagnostics.length===0 && <p>没有可识别的位置诊断；请查看原始构建日志。</p>}
      <ul>{diagnostics.map((diagnostic,index)=><li key={index}>
        {diagnostic.target ? <button disabled={disabled} onClick={()=>{
          if(!build.report || !diagnostics.includes(diagnostic))return;
          setSelected(diagnostic.target!.path);setNavigation({diagnostic,input,epoch});
        }} aria-label={`定位诊断 ${diagnostic.path}:${diagnostic.line}${diagnostic.column===undefined ? "" : `:${diagnostic.column}`}`}>{diagnostic.raw}</button> : <span>{diagnostic.raw} · {diagnostic.unavailable}</span>}
      </li>)}</ul>
      <details><summary>原始构建日志</summary>{build.report.stages.map((stage,index)=><div key={index}>
        <h5>{stage.tool} · {stage.sourcePath ?? "链接"}{stage.generated ? "（生成汇编）" : ""}</h5>
        <pre>{stage.stderr}{stage.stdout}</pre>
      </div>)}</details>
    </section>}
    <p><a href="/sdcc/4.5.0-r1/NOTICE.txt" target="_blank" rel="noreferrer">编译器版权、许可与对应源码</a></p>
  </section>;
}
