import { useState } from "react";
import type { CBuildInput } from "../core/sdcc-build";
import type { SdccDebugData } from "../core/sdcc-debug";
import { useCBuild } from "./useCBuild";
import { PROJECT_OPTIONS } from "../core/sdcc-project";
const counter="#include <8051.h>\nvolatile __data unsigned char counter;\nvoid main(void) {\n  counter = 0;\n  for (;;) {\n    P1 = counter;\n    counter++;\n  }\n}\n";
const single: CBuildInput={files:[{path:"main.c",text:counter}]};
const mixed: CBuildInput={project:{format:"emuc51-sdcc-project",version:1,entry:"main.c",sources:[{path:"main.c",language:"c"},{path:"bridge.asm",language:"sdas8051"}],headers:[],includeDirs:[],options:[...PROJECT_OPTIONS]},files:[{path:"main.c",text:"#include <8051.h>\nunsigned char add_two(unsigned char value);\nvoid main(void) {\n  P1 = add_two(5);\n  for (;;) {}\n}\n"},{path:"bridge.asm",text:".module bridge\n.globl _add_two\n.area CSEG (CODE)\n_add_two:\n mov a,dpl\n add a,#2\n mov dpl,a\n ret\n"}]};
export function CCompilerPanel({disabled,epoch,imported,onLoad}:{disabled:boolean;epoch:number;imported?:SdccDebugData;onLoad:(data:SdccDebugData,current:()=>boolean)=>void}) {
  const [input,setInput]=useState<CBuildInput>(()=>imported ? (imported.project ? {project:imported.project,files:imported.inputs!.map(({path,text})=>({path,text}))} : {files:[{path:imported.manifest.files.source.name,text:imported.source}]}) : single),[selected,setSelected]=useState("main.c");
  const build=useCBuild(input,epoch);
  const file=input.files.find(file=>file.path===selected)??input.files[0]!;
  const replace=(value:CBuildInput)=>{setInput(value);setSelected(value.files[0]!.path);};
  const download=()=>{
    if(!build.artifact)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(build.artifact.data,null,2)],{type:"application/json"}));
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
    <label>编译源文件 <select aria-label="编译源文件" value={file.path} onChange={event=>setSelected(event.target.value)}>{input.files.map(file=><option key={file.path}>{file.path}</option>)}</select></label>
    <label className="asm-source-label">{file.path}<textarea aria-label="C 编译源码" spellCheck={false} disabled={disabled} value={file.text} onChange={event=>setInput({...input,files:input.files.map(item=>item.path===file.path?{...item,text:event.target.value}:item)})}/></label>
    <div className="asm-actions">
      <button disabled={disabled||build.building} onClick={build.build}>编译 C 工程</button>
      <button disabled={!build.building} onClick={build.cancel}>取消 C 编译</button>
      <button disabled={disabled||!build.artifact} onClick={()=>{const artifact=build.artifact;if(artifact)onLoad(artifact.data,()=>build.isCurrent(artifact));}}>加载 C 编译固件</button>
      <button disabled={!build.artifact} onClick={download}>下载 C 构建包</button>
    </div>
    <pre role="status" data-testid="c-build-status" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{build.message}{build.artifact?.diagnostics?`\n${build.artifact.diagnostics}`:""}</pre>
    <p><a href="/sdcc/4.5.0-r1/NOTICE.txt" target="_blank" rel="noreferrer">编译器版权、许可与对应源码</a></p>
  </section>;
}
