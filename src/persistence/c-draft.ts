import {normalizeCEditorInput} from '../core/c-project-editor';
import type {CBuildInput} from '../core/sdcc-build';
export const C_DRAFT_KEY='emuc51.c-draft.v1';
export const C_DRAFT_BYTES=2*1024*1024;
export interface CEditorDraft {input:CBuildInput;selected:string}
export interface CEditorSession extends CEditorDraft {baseline:CBuildInput;unsaved:boolean;savedInput?:CBuildInput}
const invalid=():never=>{throw new Error('C/SDAS 草稿损坏、版本不支持或内容无效；当前编辑未替换');};
export function parseCDraft(text:string):CEditorDraft {
  if(text.length>C_DRAFT_BYTES||new TextEncoder().encode(text).byteLength>C_DRAFT_BYTES)throw new Error('C/SDAS 草稿超过 2 MiB');
  let value:unknown;try{value=JSON.parse(text);}catch{return invalid();}
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const data=value as Record<string,unknown>;
  if(Object.keys(data).some(key=>!['format','version','input','selected'].includes(key))||data.format!=='emuc51-c-draft'||data.version!==1||typeof data.selected!=='string')return invalid();
  const input=normalizeCEditorInput(data.input);
  if(!input.files.some(file=>file.path===data.selected))return invalid();
  return {input,selected:data.selected};
}
export function serializeCDraft(draft:CEditorDraft):string {
  const text=JSON.stringify({format:'emuc51-c-draft',version:1,input:normalizeCEditorInput(draft.input),selected:draft.selected});
  parseCDraft(text);return text;
}
export function saveCDraft(draft:CEditorDraft):void {
  const text=serializeCDraft(draft);localStorage.setItem(C_DRAFT_KEY,text);
}
export function readCDraft():CEditorDraft|undefined {
  const text=localStorage.getItem(C_DRAFT_KEY);return text===null?undefined:parseCDraft(text);
}
export function clearCDraft():void {localStorage.removeItem(C_DRAFT_KEY);}
