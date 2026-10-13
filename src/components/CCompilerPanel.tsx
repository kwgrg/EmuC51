import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildDiagnostics, type BuildDiagnostic } from "../core/sdcc-diagnostics";
import type { CBuildInput } from "../core/sdcc-build";
import type { SdccDebugData } from "../core/sdcc-debug";
import { useCBuild } from "./useCBuild";
import { PROJECT_OPTIONS, serializeSdccBundle } from "../core/sdcc-project";
const counter="#include <8051.h>\nvolatile __data unsigned char counter;\nvoid main(void) {\n  counter = 0;\n  for (;;) {\n    P1 = counter;\n    counter++;\n  }\n}\n";
const single: CBuildInput={files:[{path:"main.c",text:counter}]};
const mixed: CBuildInput={project:{format:"emuc51-sdcc-project",version:1,entry:"main.c",sources:[{path:"main.c",language:"c"},{path:"bridge.asm",language:"sdas8051"}],headers:[],includeDirs:[],options:[...PROJECT_OPTIONS]},files:[{path:"main.c",text:"#include <8051.h>\nunsigned char add_two(unsigned char value);\nvoid main(void) {\n  P1 = add_two(5);\n  for (;;) {}\n}\n"},{path:"bridge.asm",text:".module bridge\n.globl _add_two\n.area CSEG (CODE)\n_add_two:\n mov a,dpl\n add a,#2\n mov dpl,a\n ret\n"}]};
export function CCompilerPanel({disabled,epoch,imported,onLoad}:{disabled:boolean;epoch:number;imported?:SdccDebugData;onLoad:(data:SdccDebugData,current:()=>boolean)=>void}) {
  const [input,setInput]=useState<CBuildInput>(()=>imported ? (imported.project ? {project:imported.project,files:imported.inputs!.map(({path,text})=>({path,text}))} : {files:[{path:imported.manifest.files.source.name,text:imported.source}]}) : single),[selected,setSelected]=useState("main.c");
  const [baseline,setBaseline]=useState(input);
  const editor=useRef<HTMLTextAreaElement>(null);
  const [navigation,setNavigation]=useState<{diagnostic:BuildDiagnostic;input:CBuildInput;epoch:number}>();
  const build=useCBuild(input,epoch);
  const diagnostics=useMemo(()=>build.report ? buildDiagnostics(build.report.stages,input) : [],[build.report,input]);
  const dirty=JSON.stringify(input)!==JSON.stringify(baseline);
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
  const replace=(value:CBuildInput)=>{
    if(dirty && !window.confirm("当前 C/SDAS 草稿有编辑。替换将丢弃当前草稿，是否继续？"))return;
    setInput(value);setBaseline(value);setSelected(value.files[0]!.path);setNavigation(undefined);
  };
  const download=()=>{
    if(!build.artifact)return;
    const url=URL.createObjectURL(new Blob([serializeSdccBundle(build.artifact.data)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=build.artifact.data.project?"emuc51-project.build.json":"emuc51-browser.build.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section className="asm-panel" aria-label="浏览器 C 编译">
    <h3>C / SDAS8051 浏览器编译</h3>
    <p>SDCC 4.5.0 · classic 8051 · 128 B IRAM · small。源码留在浏览器；草稿仅在本页保留，加载固件后保存对应源码和调试信息。</p>
    <div className="asm-actions">
      <button disabled={disabled} onClick={()=>replace(single)}>单文件 C 示例</button>
      <button disabled={disabled} onClick={()=>replace(mixed)}>C + SDAS 示例</button>
      <button disabled={disabled||!imported} onClick={()=>{if(imported)replace(imported.project?{project:imported.project,files:imported.inputs!.map(({path,text})=>({path,text}))}:{files:[{path:imported.manifest.files.source.name,text:imported.source}]});}}>编辑已加载 C 工程</button>
    </div>
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
