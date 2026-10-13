import { expect, it } from "vitest";
import { checkBuildText, validateBuildInput } from "../../src/core/sdcc-build";
it("limits browser compiler inputs and rejects user filesystem/flag directives",()=>{
  for(const text of ['#include "/etc/passwd"','#include_next <8051.h>','#pragma sdcc_hash +','#include HEADER','_Pragma("foo")','#define X \\\n#include <8051.h>']) expect(()=>validateBuildInput({files:[{path:"main.c",text}]})).toThrow();
  for(const path of ['../main.c','/main.c','main.c -o hack','a/main.c']) expect(()=>validateBuildInput({files:[{path,text:""}]})).toThrow();
  expect(()=>validateBuildInput({files:[{path:"main.c",text:"x".repeat(65537)}]})).toThrow();
  expect(()=>validateBuildInput({files:[{path:"main.c",text:'#include <8051.h>\n#include <stdint.h>\nvoid main(void) {}'}]})).not.toThrow();
  for(const text of ['.include "x"','.incbin "x"','.macro evil']) expect(()=>checkBuildText('bridge.asm',text)).toThrow();
});

it("accepts actual SDCC strings/typed initializers while rejecting generated file/macro directives", async()=>{
  const { readFileSync } = await import('node:fs');
  for(const name of ['main','values','literals']) expect(()=>checkBuildText(`${name}.asm`,readFileSync(`tests/fixtures/sdcc-generated/${name}.asm`,'utf8'),undefined,true)).not.toThrow();
  expect(()=>checkBuildText('main.asm','.ascii "semi; .include x"\n.byte 0x12,0x34',undefined,true)).not.toThrow();
  for(const directive of ['.include "x"','.incbin "x"','.macro evil','.unknown 1']) for(const label of ['', 'foo: ', '00123$: ']) expect(()=>checkBuildText('main.asm',`.ascii "safe"\n${label}${directive}`,undefined,true)).toThrow();
  for(const directive of ['.ascii "x"','.byte 1','.optsdcc -mmcs51']) expect(()=>checkBuildText('user.asm',directive)).toThrow();
});

it("preserves stage provenance and earlier raw logs when a later compiler stage fails",async()=>{
  const {compileC,CBuildFailure}=await import('../../src/core/sdcc-build');
  const factory:import('../../src/core/sdcc-build').ToolFactory=async options=>({
    FS:{mkdirTree(){},writeFile(){},chdir(){},readFile(){return new Uint8Array();},stat(){return {size:0};},readdir(){return [];}},
    heapBytes:()=>16777216,
    callMain(){
      if(options.thisProgram==='/tools/sdcpp'){options.printErr('main.c:1:1: warning: earlier warning');options.print('void main(void) {}');return 0;}
      options.printErr('main.c:1: error 1: later error');return 1;
    },
  });
  const failure=await compileC({files:[{path:'main.c',text:'void main(void) {}'}]},{sdcpp:factory,sdcc:factory,sdas8051:factory,sdld:factory},{}).catch(e=>e);
  expect(failure).toBeInstanceOf(CBuildFailure);
  expect(failure.diagnosticStages).toEqual([
    {tool:'sdcpp',sourcePath:'main.c',generated:false,stderr:'main.c:1:1: warning: earlier warning\n',stdout:''},
    {tool:'sdcc',sourcePath:'main.c',generated:false,stderr:'main.c:1: error 1: later error\n',stdout:''},
  ]);
  expect(failure.message).toContain('sdcc 退出 1');
});
