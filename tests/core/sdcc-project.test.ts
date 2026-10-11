import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { verifySdccDebug } from "../../src/core/sdcc-debug";
import { normalizeSdccProject } from "../../src/core/sdcc-project";
import { Cpu8051 } from "../../src/core/cpu";
import { evaluateWatch } from "../../src/core/expressions";
import { symbolByteExpressions } from "../../src/core/cdb-symbols";
const raw = JSON.parse(readFileSync("tests/fixtures/sdcc-mixed/emuc51-project.build.json", "utf8"));
beforeAll(() => vi.stubGlobal("crypto", webcrypto)); afterAll(() => vi.unstubAllGlobals());
it("runs a real two-C/SDAS module with byte/word ABI and C-to-ASM-to-C balanced returns", async () => {
  const verified = await verifySdccDebug(raw);
  expect(verified.files?.map(file => file.path)).toEqual(["src/main.c", "src/compute.c", "asm/bridge.asm", "include/shared.h"]);
  const cpu = new Cpu8051(new Uint8Array(verified.firmware));
  let nested = false; let assemblyWrite = false; let entrySp: number | undefined;
  const main = verified.functions.find(fn => fn.name === "main")!;
  const sharedAddress = verified.symbols.find(symbol => symbol.name === "shared")!.address!;
  for (let i=0;i<1000;i++) { if(cpu.pc===main.entry) entrySp=cpu.memory.sp; cpu.step(); nested ||= cpu.state().callStack.frames.length >= 3; assemblyWrite ||= cpu.state().callStack.frames.length >= 3 && cpu.memory.iram[sharedAddress] === 7; }
  expect(entrySp).toBeDefined(); expect(cpu.memory.sp).toBe(entrySp);
  expect(verified.functions.map(fn=>fn.name).sort()).toEqual(["compute","finish","main"]);
  expect(assemblyWrite).toBe(true); expect(nested).toBe(true); expect(cpu.state().callStack.frames).toEqual([]);
  const read=(name:string,scope?:string)=>{
    const symbol=verified.symbols.find(item=>item.name===name&&(!scope||item.scope===scope)&&!item.unavailable)!;
    expect(symbol).toBeDefined(); return evaluateWatch(cpu,symbolByteExpressions(symbol)).map(item=>item.value);
  };
  expect(read("shared")).toEqual([10]); expect(read("word_result")).toEqual([0,0x13]);
  expect(read("shadow","Fmain")).toEqual([10]); expect(read("shadow","Fcompute")).toEqual([3]);
  expect(new Set(verified.symbols.filter(item=>item.name==="shadow").map(item=>item.id)).size).toBe(2);
  const asm=verified.files!.find(file=>file.language==="sdas8051")!;
  expect(asm.locations.length).toBeGreaterThan(5);
  for(const location of asm.locations) expect(asm.text.split("\n")[location.line-1]).not.toMatch(/^\s*\./);
  expect(verified.files!.find(file=>file.language==="header")!.locations).toEqual([]);
});
it.each(["../main.c","/main.c","C:/main.c","src/../main.c","src\\main.c","./main.c","src//main.c","src/%2e%2e/main.c"])("rejects unsafe project path %s",path=>{
  expect(()=>normalizeSdccProject({...raw.project,entry:path})).toThrow();
});
it("rejects commands, duplicate basename/module, unlisted entry and arbitrary flags",()=>{
  for(const project of [{...raw.project,command:"echo bad"},{...raw.project,options:[...raw.project.options,"--stack-auto"]},
    {...raw.project,entry:"missing.c"},{...raw.project,sources:[...raw.project.sources,{path:"other/main.c",language:"c"}]},
    {...raw.project,sources:[...raw.project.sources,{path:"asm/main.asm",language:"sdas8051"}]}])expect(()=>normalizeSdccProject(project)).toThrow();
});
it("rejects case-folded file/module collisions and noncanonical input paths", async () => {
  for (const source of [{path:"other/Main.c",language:"c"},{path:"asm/MAIN.asm",language:"sdas8051"}])
    expect(()=>normalizeSdccProject({...raw.project,sources:[...raw.project.sources,source]})).toThrow();
  expect(()=>normalizeSdccProject({...raw.project,headers:[...raw.project.headers,"other/Shared.h"]})).toThrow();
  for (const path of ["src/Main.c","src/./main.c","src//main.c"]) {
    const changed=structuredClone(raw);changed.inputs[0].path=path;
    await expect(verifySdccDebug(changed)).rejects.toThrow();
  }
  const duplicate=structuredClone(raw);duplicate.inputs[1]=duplicate.inputs[0];
  await expect(verifySdccDebug(duplicate)).rejects.toThrow();
});
it("atomically binds headers, sources, project configuration and firmware",async()=>{
  for(const key of ["source","ihx","cdb"] as const) await expect(verifySdccDebug({...raw,[key]:raw[key]+"\n"})).rejects.toThrow();
  const changed=structuredClone(raw);changed.inputs.find((item:{path:string})=>item.path.endsWith(".h")).text+="\n";
  await expect(verifySdccDebug(changed)).rejects.toThrow("SHA-256");
  const source=structuredClone(raw);source.inputs.find((item:{path:string})=>item.path==="src/compute.c").text+="\n";
  await expect(verifySdccDebug(source)).rejects.toThrow("SHA-256");
  await expect(verifySdccDebug({...raw,project:{...raw.project,includeDirs:[]}})).rejects.toThrow("项目清单 SHA");
  await expect(verifySdccDebug(raw,new Uint8Array([0]).buffer)).rejects.toThrow("当前固件");
});
it("rejects a remapped unknown source even with an updated CDB digest",async()=>{
  const changed=structuredClone(raw);changed.cdb=changed.cdb.replace("L:C$main.c$","L:C$missing.c$");
  changed.manifest.files.cdb.sha256=createHash("sha256").update(changed.cdb).digest("hex");
  await expect(verifySdccDebug(changed)).rejects.toThrow("未打包");
});
it.each([
  ["duplicate module", (cdb:string)=>cdb+"\nM:main"],
  ["unknown ASM module", (cdb:string)=>cdb.replace("L:A$bridge$","L:A$alien$")],
  ["C row beyond source", (cdb:string)=>cdb.replace(/L:C\$main.c\$\d+\$/, "L:C$main.c$999$")],
  ["missing entry module", (cdb:string)=>cdb.replace("M:main","M:alien")],
  ["missing secondary module", (cdb:string)=>cdb.replace("M:compute\n","")],
])("rejects malformed multi-module debug records: %s",async(_name,edit)=>{
  const changed=structuredClone(raw);changed.cdb=edit(changed.cdb);changed.manifest.files.cdb.sha256=createHash("sha256").update(changed.cdb).digest("hex");
  await expect(verifySdccDebug(changed)).rejects.toThrow();
});
it("does not infer SDAS code lines in non-CODE areas",async()=>{
  const changed=structuredClone(raw);
  const source=changed.inputs.find((item:{path:string})=>item.path==="asm/bridge.asm");source.text=source.text.replace(".area CSEG (CODE)",".area DSEG (DATA)");source.sha256=createHash("sha256").update(source.text).digest("hex");
  const verified=await verifySdccDebug(changed);
  expect(verified.files!.find(file=>file.language==="sdas8051")!.locations).toEqual([]);
});
it("disables conflicting external/global storage declarations without merging file statics",async()=>{
  const changed=structuredClone(raw);
  const position=changed.cdb.indexOf("M:compute");
  changed.cdb=changed.cdb.slice(0,position)+changed.cdb.slice(position).replace("S:G$shared$0_0$0({1}SC:U)","S:G$shared$0_0$0({2}SI:U)");
  changed.manifest.files.cdb.sha256=createHash("sha256").update(changed.cdb).digest("hex");
  const verified=await verifySdccDebug(changed);
  for(const symbol of verified.symbols.filter(item=>item.name==="shared"))expect(symbol.unavailable).toContain("跨模块");
  for(const symbol of verified.symbols.filter(item=>item.name==="shadow"))expect(symbol.unavailable).toBeUndefined();
});
