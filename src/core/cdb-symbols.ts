import { SFR } from "./memory";
import type { MemorySpace } from "./types";
export const MAX_CDB_SYMBOLS = 2048;
export interface CdbSymbol {
  id:string; name:string; module:string; scope:string; level:string; block:string;
  type:string; spaceCode:string; space:string; size:number; address?:number;
  declaration:string; link?:string; unavailable?:string; memorySpace?:MemorySpace;
}
const fail=(message:string):never=>{throw new Error(`SDCC 符号：${message}`);};
const identifier="(?:G|F[A-Za-z_][A-Za-z0-9_-]{0,63}|L[A-Za-z_][A-Za-z0-9_.-]{0,128})\\$[A-Za-z_][A-Za-z0-9_]{0,127}\\$[0-9]+(?:_[0-9]+)*\\$[0-9]+";
const symbolPattern=new RegExp(`^S:(${identifier})\\(\\{([0-9]+)\\}([^()]{1,512})\\),([A-Z ]),(-?[0-9]+),(-?[0-9]+)(?:,\\[([A-Za-z0-9_, ]{0,64})\\])?$`);
const linkPattern=new RegExp(`^L:(${identifier}):([0-9a-fA-F]{1,8})$`);
const spaces:Record<string,string>={A:"外部栈",B:"内部栈",C:"CODE",D:"CODE",E:"DATA",F:"XDATA",G:"IDATA",H:"BIT",I:"SFR",J:"SBIT",P:"PDATA",R:"寄存器",Z:"未确定"};
/** Only S declarations with exact full-identity L addresses can become readable objects. */
export function parseCdbSymbols(cdb:string,module:string,firmwareLength:number):CdbSymbol[] {
  if(typeof cdb!=="string"||cdb.length>256*1024||/[^\t\n\r -~]/.test(cdb))fail("CDB 大小或字符无效");
  const records=cdb.split(/\r\n|\n|\r/);if(records.length>16384||records.some(record=>record.length>4096))fail("CDB 记录超限");
  const declarations=new Map<string,RegExpExecArray>(), links=new Map<string,{address:number;record:string}>();
  for(const raw of records){
    const record=raw.trim();
    if(record.startsWith("S:")){
      const match=symbolPattern.exec(record);if(!match)fail("不支持或畸形的 S 记录");
      if(declarations.has(match![1]!))fail("重复符号身份，不能选择一个声明猜测");
      declarations.set(match![1]!,match!);if(declarations.size>MAX_CDB_SYMBOLS)fail("最多 2048 个符号声明");
    }else if(/^L:[GFL]/.test(record)){
      const match=linkPattern.exec(record);if(!match)fail("畸形的符号链接记录");
      if(links.has(match![1]!))fail("重复符号链接身份");
      links.set(match![1]!,{address:parseInt(match![2]!,16),record});
    }
  }
  return Array.from(declarations,([identity,match]):CdbSymbol=>{
    const [scope,name,level,block]=identity.split("$") as [string,string,string,string];
    const size=Number(match[2]),type=match[3]!,spaceCode=match[4]!,link=links.get(identity);
    if(!Number.isSafeInteger(size)||!level.split("_").every(value=>Number.isSafeInteger(Number(value)))||!Number.isSafeInteger(Number(block)))fail("符号大小或作用域计数越界");
    const symbol:CdbSymbol={id:`CDB::${module}::${identity}`,module:scope.startsWith("F")?scope.slice(1):module,name,scope,level,block,type,spaceCode,space:spaces[spaceCode]??"不支持",size,declaration:match[0],...(link?{address:link.address,link:link.record}:{})};
    const scalar=/^(SC|SI|SL):[SU]$/.exec(type);
    const array=/^DA([0-9]+)d,SC:[SU]$/.exec(type);
    const expected=scalar?({SC:1,SI:2,SL:4}[scalar[1]!]??0):array?Number(array[1]):0;
    let reason:string|undefined;
    if(scope.startsWith("L")||level!=="0_0"||block!=="0")reason="不观察函数局部、参数或嵌套作用域（包括局部 static）";
    else if(scope.startsWith("F")&&symbol.module!==module)reason="声明模块与当前单文件构建不匹配";
    else if(match[5]!=="0"||match[6]!=="0"||match[7]!==undefined||spaceCode==="R")reason="栈/寄存器位置未经验证";
    else if(!expected||expected!==size||size>16)reason="类型/大小未验证；仅 1/2/4 字节整数存储或至多 16 字节字符数组";
    else if(!link)reason="没有精确链接地址：可能仅声明或被优化，不能猜位置";
    else {
      const address=link.address;
      if(spaceCode==="E"||spaceCode==="G"){
        if(address+size>128)reason="超出经典 8051 的 128 字节 IRAM，不映射为 SFR";
        else symbol.memorySpace="iram";
      }else if(spaceCode==="F"){
        if(address+size>65536)reason="超出 64 KiB XDATA";else symbol.memorySpace="xram";
      }else if(spaceCode==="D"){
        if(address+size>firmwareLength)reason="CODE 对象超出已加载固件";else symbol.memorySpace="code";
      }else if(spaceCode==="I"){
        if(size!==1||!Object.values(SFR).some(value=>value===address))reason="不是已建模的经典单字节 SFR";else symbol.memorySpace="sfr";
      }else reason="该地址空间尚无验证过的对象观察语义";
    }
    if(reason)symbol.unavailable=reason;
    return symbol;
  });
}
export function symbolByteExpressions(symbol:CdbSymbol):string[] {
  if(symbol.unavailable||!symbol.memorySpace||symbol.address===undefined)return [];
  const space={iram:"IRAM",sfr:"SFR",xram:"XRAM",code:"CODE"}[symbol.memorySpace];
  return Array.from({length:symbol.size},(_,index)=>`${space}[${symbol.address!+index}]`);
}
