import {useState} from 'react';
import {deletionBlock,editCProject,type CProjectEdit} from '../core/c-project-editor';
import type {CBuildInput} from '../core/sdcc-build';
export function CProjectManager({input,selected,disabled,onChange}:{input:CBuildInput;selected:string;disabled:boolean;onChange:(input:CBuildInput,selected:string)=>void}) {
  const [path,setPath]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
  if(!input.project)return <p>文件结构管理用于 C/SDAS 混合工程；可先选择「C + SDAS 示例」。单 C 草稿同样可以本地保存。</p>;
  const blocked=deletionBlock(input,selected);
  const apply=(edit:CProjectEdit)=>{
    try {
      const next=editCProject(input,edit);
      if(edit.kind==='rename'&&!window.confirm(`将 ${selected} 改名为 ${edit.next}。不会改写 #include、.module 或符号引用；请手动修复后重新编译。继续？`))return;
      if(edit.kind==='delete'&&!window.confirm(`删除 ${selected} 的全部内容（包括未保存编辑）？引用不会自动更新，旧编译结果将失效。`))return;
      onChange(next,edit.kind==='add'?edit.path:edit.kind==='rename'?edit.next:edit.kind==='delete'?next.project!.entry:selected);
      setPath('');setError('');setMessage(edit.kind==='entry'?'已更换入口；请确认该 C 文件定义 main。':'工程清单已更新；#include、.module 和符号引用请手动检查，需重新编译。');
    }catch(caught){setError(caught instanceof Error?caught.message:'工程操作失败');}
  };
  return <section className="c-project-manager" aria-label="混合工程文件管理">
    <p>{input.project.sources.length} 个源文件 · {input.project.headers.length} 个头文件 · 包含目录：{input.project.includeDirs.join(', ')||'无'}</p>
    <label>入口 C 文件 <select aria-label="入口 C 文件" disabled={disabled} value={input.project.entry} onChange={event=>apply({kind:'entry',path:event.target.value})}>{input.project.sources.filter(source=>source.language==='c').map(source=><option key={source.path}>{source.path}</option>)}</select></label>
    <label>新文件路径 / 重命名目标 <input aria-label="工程文件路径" value={path} disabled={disabled} placeholder="src/helper.c / include/shared.h / asm/helper.asm" onChange={event=>{setPath(event.target.value);setError('');}} /></label>
    <div className="asm-actions">
      <button disabled={disabled||!path} onClick={()=>apply({kind:'add',path})}>新增工程文件</button>
      <button disabled={disabled||!path||path===selected} onClick={()=>apply({kind:'rename',path:selected,next:path})}>重命名当前文件</button>
      <button disabled={disabled||Boolean(blocked)} onClick={()=>apply({kind:'delete',path:selected})}>删除当前文件</button>
    </div>
    <p>{blocked??`当前文件：${selected}`}。仅规范相对路径；头文件目录自动加入包含目录。不自动改写源码引用。</p>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
