import {createHash,webcrypto} from "node:crypto";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {sdccFixture} from "../fixtures/sdcc-fixture";
import {parseCdbSymbols,symbolByteExpressions} from "../../src/core/cdb-symbols";
import {verifySdccDebug} from "../../src/core/sdcc-debug";
import {Cpu8051} from "../../src/core/cpu";
import {evaluateWatch,evaluateExpression} from "../../src/core/expressions";
const data=sdccFixture("symbols","sdcc-symbols");
beforeAll(()=>vi.stubGlobal("crypto",webcrypto));afterAll(()=>vi.unstubAllGlobals());
it("binds a real native build, reads bounded raw storage without side effects or register name shadowing",async()=>{
  const verified=await verifySdccDebug(data);const cpu=new Cpu8051(new Uint8Array(verified.firmware));
  for(let i=0;i<1000;i++)cpu.step();cpu.setPortInput(1,0);const before=cpu.snapshot();
  const read=(name:string)=>{const symbol=verified.symbols.find(item=>item.name===name&&!item.unavailable)!;expect(symbol, name).toBeDefined();return evaluateWatch(cpu,symbolByteExpressions(symbol)).map(result=>result.value);};
  expect(read("ACC")).toEqual([0x31]);expect(read("count16")).toEqual([0x34,0x12]);expect(read("indirect_byte")).toEqual([0x56]);
  expect(read("wide")).toEqual([0x78,0x56,0x34,0x12]);expect(read("rom_bytes")).toEqual([0x12,0x34,0x56]);
  expect(read("port_out")).toEqual([0xa5]);expect(cpu.peripherals.pins(1)).toBe(0);
  expect(read("serial_latch")).toEqual([0x41]);expect(read("shadow")).toEqual([0x22]);
  expect(evaluateExpression(cpu,"ACC")).toBe(cpu.state().acc);expect(cpu.snapshot()).toEqual(before);
  const twins=verified.symbols.filter(item=>item.name==="shadow");expect(twins).toHaveLength(2);expect(new Set(twins.map(item=>item.id)).size).toBe(2);
  expect(twins.find(item=>item.scope.startsWith("L"))!.unavailable).toContain("局部");
  for(const name of ["pointer_value","pair_value","flag","outside_classic","missing_external","main"]){
    const symbol=verified.symbols.find(item=>item.name===name)!;expect(symbol.unavailable,name).toBeTruthy();expect(symbolByteExpressions(symbol)).toEqual([]);
  }
  expect(verified.symbols.find(item=>item.name==="outside_classic")!.address).toBe(0x80);
  expect(verified.symbols.find(item=>item.name==="missing_external")!.unavailable).toContain("没有精确链接地址");
});
it("does not turn orphan startup/library linker names into variables or alias a different scope",()=>{
  const symbols=parseCdbSymbols(data.cdb+"\nL:G$__sdcc_startup$0$0:0\nL:Fother$missing_external$0_0$0:8","symbols",65536);
  expect(symbols.some(symbol=>symbol.name==="__sdcc_startup")).toBe(false);
  expect(symbols.find(symbol=>symbol.name==="missing_external")!.address).toBeUndefined();
});
it.each([
  ["duplicate declaration",data.cdb+"\nS:G$ACC$0_0$0({1}SC:U),E,0,0"],
  ["conflicting links",data.cdb+"\nL:G$ACC$0_0$0:9"],
  ["malformed",data.cdb+"\nS:G$bad"],
  ["unsafe size","S:G$a$0_0$0({9007199254740992}SC:U),E,0,0"],
  ["control",data.cdb+"\0"],
  ["too many",Array.from({length:2049},(_,i)=>`S:G$n${i}$0_0$0({1}SC:U),E,0,0`).join("\n")],
  ["too long","S:"+"a".repeat(4096)],
])("rejects malformed or excessive symbols: %s",(_name,cdb)=>expect(()=>parseCdbSymbols(cdb,"symbols",65536)).toThrow());
it.each([
  ["G$a$0_0$0","{1}SC:U","G,0,0","80","128 字节"],
  ["G$a$0_0$0","{2}SI:U","F,0,0","FFFF","64 KiB"],
  ["G$a$0_0$0","{1}SC:U","I,0,0","C0","SFR"],
  ["G$a$0_0$0","{3}DA3d,SC:U","D,0,0","FF","CODE"],
  ["G$a$0_0$0","{3}SI:U","E,0,0","8","类型/大小"],
  ["G$a$0_0$0","{17}DA17d,SC:U","F,0,0","8","类型/大小"],
  ["G$a$0_0$0","{1}SC:U","R,0,0,[r2]","8","寄存器"],
  ["G$a$0_0$0","{1}SC:U","E,1,-2","8","栈"],
  ["Fother$a$0_0$0","{1}SC:U","E,0,0","8","模块"],
])("keeps unsupported storage explicitly unavailable %#",(id,type,storage,address,reason)=>{
  const [symbol]=parseCdbSymbols(`S:${id}(${type}),${storage}\nL:${id}:${address}`,"symbols",256);
  expect(symbol!.unavailable).toContain(reason);expect(symbolByteExpressions(symbol!)).toEqual([]);
});
it("supports all existing actual header declarations without treating SBIT aliases as bytes",async()=>{
  const verified=await verifySdccDebug(sdccFixture());
  expect(verified.symbols.find(symbol=>symbol.name==="ACC")).toMatchObject({memorySpace:"sfr",address:0xe0,size:1});
  expect(verified.symbols.find(symbol=>symbol.name==="P1_0")!.unavailable).toBeTruthy();
});

it("rejects a malformed symbol bundle even when its edited CDB digest matches",async()=>{
  const cdb=data.cdb+"\nL:G$ACC$0_0$0:9";
  const altered={...data,cdb,manifest:{...data.manifest,files:{...data.manifest.files,cdb:{...data.manifest.files.cdb,sha256:createHash("sha256").update(cdb).digest("hex")}}}};
  await expect(verifySdccDebug(altered)).rejects.toThrow("重复符号链接身份");
});
