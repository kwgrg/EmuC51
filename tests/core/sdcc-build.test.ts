import { expect, it } from "vitest";
import { checkBuildText, validateBuildInput } from "../../src/core/sdcc-build";
it("limits browser compiler inputs and rejects user filesystem/flag directives",()=>{
  for(const text of ['#include "/etc/passwd"','#include_next <8051.h>','#pragma sdcc_hash +','#include HEADER','_Pragma("foo")','#define X \\\n#include <8051.h>']) expect(()=>validateBuildInput({files:[{path:"main.c",text}]})).toThrow();
  for(const path of ['../main.c','/main.c','main.c -o hack','a/main.c']) expect(()=>validateBuildInput({files:[{path,text:""}]})).toThrow();
  expect(()=>validateBuildInput({files:[{path:"main.c",text:"x".repeat(65537)}]})).toThrow();
  expect(()=>validateBuildInput({files:[{path:"main.c",text:'#include <8051.h>\n#include <stdint.h>\nvoid main(void) {}'}]})).not.toThrow();
  for(const text of ['.include "x"','.incbin "x"','.macro evil']) expect(()=>checkBuildText('bridge.asm',text)).toThrow();
});
