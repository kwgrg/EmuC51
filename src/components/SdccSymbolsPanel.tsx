import { cdbIntegerEncoding, decodeCdbInteger } from "../core/cdb-integers";
import { useMemo, useState } from "react";
import type { VerifiedSdccDebug } from "../core/sdcc-debug";
import type { WatchResult } from "../core/expressions";
import { hex8, hex16 } from "../core/numbers";
export interface SymbolSample { id:string; token:string; results:WatchResult[]; pc:number; steps:number }
export const symbolBindingToken=(verified:VerifiedSdccDebug)=>[verified.firmwareSha256,verified.data.manifest.files.source.sha256,verified.data.manifest.files.cdb.sha256,verified.data.manifest.projectSha256??"",...(verified.data.inputs?.map(item=>`${item.path}:${item.sha256}`)??[])].join(":");
export function SdccSymbolsPanel({verified,disabled,sample,onRead,onBrowse}:{
  verified:VerifiedSdccDebug; disabled:boolean; sample?:SymbolSample; onRead:(id:string)=>void; onBrowse:(id:string)=>void;
}) {
  const [query,setQuery]=useState(""),[page,setPage]=useState(0),[selected,setSelected]=useState<string>();
  const symbols=useMemo(()=>verified.symbols.filter(symbol=>symbol.id.toLowerCase().includes(query.trim().toLowerCase())),[verified,query]);
  const target=verified.symbols.find(symbol=>symbol.id===selected&&!symbol.unavailable);
  const current=target&&sample?.id===target.id&&sample.token===symbolBindingToken(verified)?sample:undefined;
  const encoding = target ? cdbIntegerEncoding(target) : undefined;
  const integer = target && current ? decodeCdbInteger(target, current.results) : undefined;
  return <section className="symbol-panel" aria-label="SDCC 静态符号">
    <h3>SDCC 静态符号</h3>
    <p>仅验证过的静态全局存储对象可查看原始字节（地址递增顺序），可按已验证 CDB 标量存储编码解释整数，不恢复原始 C 类型、不解引用指针。CDB 全身份限定名称独立于表达式 Watch，ACC 等名称不会覆盖寄存器。</p>
    <p>构建入口 {verified.data.manifest.files.source.name}；CDB 不保证声明来自此 .c 而非头文件。无声明的启动/库链接名不生成为变量；优化后无记录的名字不猜测。局部变量、参数、函数和未验证类型不提供读取。</p>
    <label>筛选 SDCC 符号<input aria-label="筛选 SDCC 符号" value={query} maxLength={128} onChange={event=>{setQuery(event.target.value);setPage(0);}} /></label>
    <div className="asm-actions"><button disabled={!page} onClick={()=>setPage(page-1)}>符号上一页</button><span>{page+1} / {Math.max(1,Math.ceil(symbols.length/50))} · {symbols.length} 个声明</span><button disabled={(page+1)*50>=symbols.length} onClick={()=>setPage(page+1)}>符号下一页</button></div>
    {target&&<div aria-label="符号只读观察">
      <code>{target.id}</code>
      <p data-testid="symbol-sample">{current?`固定采样 PC ${hex16(current.pc)} · ${current.steps} 条指令（不是实时值）`:"等待本次读取"}</p>
      <output data-testid="symbol-bytes">{current?current.results.some(result=>result.error)?current.results.map(result=>result.error??"").filter(Boolean).join("；"):current.results.map(result=>hex8(result.value!)).join(" "):"…"}</output>
      {encoding ? <div aria-label="CDB 存储整数视图">
        <p>按 CDB 存储编码解释：{target.type} · {encoding.bits} 位{encoding.signed ? "有符号" : "无符号"} · 小端</p>
        <output data-testid="symbol-integer">{integer === undefined ? "暂无完整有效采样" : String(integer)}</output>
        <p>可能是普通整数或相同存储编码的枚举；不能恢复原始 C 声明类型、枚举名或枚举成员。数值与上方原始字节来自同一次固定采样。</p>
      </div> : <p>此对象仅显示原始字节，不作标量整数解释。</p>}
      <div className="asm-actions"><button disabled={disabled} onClick={()=>onRead(target.id)}>刷新符号观察</button><button onClick={()=>setSelected(undefined)}>取消符号观察</button></div>
    </div>}
    <div className="symbol-list">{symbols.slice(page*50,(page+1)*50).map(symbol=><div key={symbol.id} className="symbol-row" data-testid="sdcc-symbol" data-symbol-id={symbol.id}>
      <code>{symbol.id}</code>
      <span>模块 {symbol.module} · 作用域 {symbol.scope} · {symbol.space} [{symbol.spaceCode}] · 地址 {symbol.address===undefined?"未链接":`0x${symbol.address.toString(16).toUpperCase()}`} · 大小 {symbol.size}（CDB 声明）· 类型 {symbol.type}</span>
      <span>{symbol.unavailable??`可观察 ${symbol.size} 个原始字节${symbol.memorySpace==="sfr"?"；SFR 读锁存值，不触发外设读取":""}`}</span>
      <div className="asm-actions">
        <button disabled={disabled||Boolean(symbol.unavailable)} aria-label={`观察 ${symbol.id}`} onClick={()=>{setSelected(symbol.id);onRead(symbol.id);}}>读取原始字节</button>
        <button disabled={disabled||Boolean(symbol.unavailable)} aria-label={`导航 ${symbol.id}`} onClick={()=>onBrowse(symbol.id)}>查看内存</button>
      </div>
      <details><summary>声明与链接来源</summary><pre>{symbol.declaration}{"\n"}{symbol.link??"无完整身份匹配的链接地址"}</pre></details>
    </div>)}</div>
  </section>;
}
