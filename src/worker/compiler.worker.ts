import { compileC, type CBuildInput, type CBuildResult, type ToolFactory, type ToolName } from "../core/sdcc-build";
export type CBuildEvent = { id: number; result?: CBuildResult; error?: string };
// Versioned, same-origin static scripts contain the WASM and fixed filesystem.
// Dynamic module loading uses script-src; never fetch/XHR or user-derived URLs.
self.onmessage = async (event: MessageEvent<{id:number; input:CBuildInput}>) => {
  const {id,input}=event.data;
  self.onmessage=null;
  try {
    const base="/sdcc/4.5.0-r1/";
    const names: ToolName[]=["sdcpp","sdcc","sdas8051","sdld"];
    const factories=await Promise.all(names.map(async name=>(await import(/* @vite-ignore */ `${base}${name}.js`)).default as ToolFactory));
    const assets=(await import(/* @vite-ignore */ `${base}files.js`)).default as Record<string,string>;
    const result=await compileC(input,Object.fromEntries(names.map((name,i)=>[name,factories[i]!])) as Record<ToolName,ToolFactory>,assets);
    self.postMessage({id,result} satisfies CBuildEvent);
  } catch(error) { self.postMessage({id,error:error instanceof Error?error.message:"编译失败"} satisfies CBuildEvent); }
};
