import type { CBuildInput } from './sdcc-build';
import { normalizeProjectInputs, normalizeSdccProject, projectPath, type SdccProject } from './sdcc-project';
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
/** Drafts may contain broken C/ASM; validate structure and limits, not compilability. */
export function normalizeCEditorInput(value:unknown):CBuildInput {return normalizeEditorInput(value,true);}
function normalizeEditorInput(value:unknown,bounded:boolean):CBuildInput {
  if(!object(value)||Object.keys(value).some(key=>!['project','files'].includes(key))||!Array.isArray(value.files)||!value.files.length||value.files.length>32)throw new Error('C/SDAS 草稿结构无效');
  const files=value.files.map(file=>{
    if(!object(file)||Object.keys(file).some(key=>!['path','text'].includes(key))||typeof file.text!=='string'||(bounded&&(file.text.length>65536||file.text.split(/\r\n|\n|\r/).length>8192)))throw new Error('草稿文件无效或超过 64 Ki 字符 / 8192 行');
    return {path:projectPath(file.path),text:file.text};
  });
  const project=value.project===undefined?undefined:normalizeSdccProject(value.project);
  if(project)normalizeProjectInputs(project,files.map(file=>({...file,text:bounded?file.text:'',sha256:'0'.repeat(64)})));
  else if(files.length!==1||!/^[A-Za-z_][A-Za-z0-9_]{0,63}\.c$/.test(files[0]!.path))throw new Error('单 C 草稿必须只有一个规范 .c 文件');
  return {project,files};
}
export type CProjectEdit={kind:'add';path:string}|{kind:'rename';path:string;next:string}|{kind:'delete';path:string}|{kind:'entry';path:string};
const parent=(path:string)=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):undefined;
const stem=(path:string)=>path.split('/').at(-1)!.replace(/\.[^.]+$/,'');
export function deletionBlock(input:CBuildInput,path:string):string|undefined {
  if(!input.project)return '结构编辑仅用于 C/SDAS 混合工程';
  if(input.project.entry===path)return '不能删除入口 C 文件；请先选择其他 C 入口';
  if(input.project.sources.filter(source=>source.language==='sdas8051').length===1&&input.project.sources.some(source=>source.path===path&&source.language==='sdas8051'))return '混合工程必须保留至少一个 ASM 文件';
}
/** Metadata-only rename: never rewrite include directives, .module or linker symbols. */
export function editCProject(current:CBuildInput,edit:CProjectEdit):CBuildInput {
  const input=normalizeEditorInput(current,false);
  if(!input.project)throw new Error('结构编辑仅用于 C/SDAS 混合工程');
  const project:SdccProject=structuredClone(input.project);
  let files=input.files;
  const path=projectPath(edit.path);
  if(edit.kind==='add'){
    const text=path.endsWith('.asm')?`.module ${stem(path)}\n.area CSEG (CODE)\n`:'';
    files=[...files,{path,text}];
    if(path.endsWith('.h'))project.headers.push(path);
    else project.sources.push({path,language:path.endsWith('.c')?'c':'sdas8051'});
  }else{
    if(!files.some(file=>file.path===path))throw new Error('文件不在当前草稿中');
    if(edit.kind==='entry')project.entry=path;
    else if(edit.kind==='delete'){
      const reason=deletionBlock(input,path);if(reason)throw new Error(reason);
      files=files.filter(file=>file.path!==path);
      project.sources=project.sources.filter(source=>source.path!==path);project.headers=project.headers.filter(header=>header!==path);
    }else{
      const next=projectPath(edit.next);
      if(path.slice(path.lastIndexOf('.'))!==next.slice(next.lastIndexOf('.')))throw new Error('重命名不能改变文件类型');
      // Case-only renames are explicit, but collisions with any other file remain invalid.
      files=files.map(file=>file.path===path?{...file,path:next}:file);
      project.sources=project.sources.map(source=>source.path===path?{...source,path:next}:source);
      project.headers=project.headers.map(header=>header===path?next:header);
      if(project.entry===path)project.entry=next;
    }
  }
  // Keep the old search order; prune empty directories, append the new header's directory.
  project.includeDirs=project.includeDirs.filter(dir=>project.headers.some(header=>header.startsWith(dir+'/')));
  if(edit.kind==='add'||edit.kind==='rename'){
    const header=edit.kind==='add'?path:edit.next,dir=parent(header);
    if(header.endsWith('.h')&&dir&&!project.includeDirs.includes(dir))project.includeDirs.push(dir);
  }
  return normalizeCEditorInput({project,files});
}
