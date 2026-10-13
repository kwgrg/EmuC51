import {expect,it} from 'vitest';
import {buildDiagnostics} from '../../src/core/sdcc-diagnostics';
import type {BuildStageLog,CBuildInput} from '../../src/core/sdcc-build';
const input:CBuildInput={files:[{path:'src/main.c',text:'void main(void) {\n unsigned char x = ;\n}\n'},{path:'asm/bridge.asm',text:'.module bridge\n mov a,#\n'},{path:'include/shared.h',text:'// header\n#error HEADER_DIAGNOSTIC\n'}]};
const log=(stderr:string,tool:BuildStageLog['tool']='sdcc'):BuildStageLog=>({tool,stderr,stdout:''});
it('maps actual pinned SDCC syntax columns, GCC headers, SDAS line-only errors without inventing columns',()=>{
 const [c,header,asm]=buildDiagnostics([
 log("src/main.c:2: syntax error: token -> ';' ; column 20"),
 log('In file included from src/main.c:1:\ninclude/shared.h:2:2: error: #error HEADER_DIAGNOSTIC','sdcpp'),
 log('asm/bridge.asm:2: Error: <q> missing or improper operators, terminators, or delimiters','sdas8051')],input);
 expect(c).toMatchObject({column:20,target:{path:'src/main.c',start:37,end:37}});
 expect(header).toMatchObject({column:2,target:{path:'include/shared.h',start:11,end:11}});
 expect(asm).toMatchObject({line:2,target:{path:'asm/bridge.asm',start:15,end:23}});expect(asm?.column).toBeUndefined();
});
it('rejects escapes, unknown and ambiguous files, wrong case, out of range rows and generated assembly',()=>{
 for(const path of ['../src/main.c','/other/src/main.c','/work/main.c','./main.c','/work/../src/main.c','src/./main.c','src//main.c','src\\main.c','SRC/main.c','missing.c'])expect(buildDiagnostics([log(`${path}:2: error 1: invalid`)],input)[0]?.target).toBeUndefined();
 for(const line of ['0','99999999999999999999','55'])expect(buildDiagnostics([log(`src/main.c:${line}: error 1: invalid`)],input)[0]?.target).toBeUndefined();
 const duplicate={files:[...input.files,{path:'main.c',text:'a\nb\n'}]};
 expect(buildDiagnostics([log('main.c:2: error 1: invalid')],duplicate)[0]?.unavailable).toContain('歧义');
 expect(buildDiagnostics([log('src/main.c:2: error 1: invalid')],duplicate)[0]?.target?.path).toBe('src/main.c');
 expect(buildDiagnostics([{...log('asm/bridge.asm:2: Error: invalid','sdas8051'),generated:true}],input)[0]?.target).toBeUndefined();
 expect(buildDiagnostics([log('src/main.c:2: error: invalid','sdld')],input)[0]?.target).toBeUndefined();
});
it('accepts exact work-root paths and unique basenames, retains warning/note and raw unknown output',()=>{
 const ds=buildDiagnostics([log('/work/src/main.c:2: warning 85: unused\n./include/shared.h:2:1: note: here\nmain.c:2: error 1: bad\n?ASlink-Warning-Undefined Global')],input);
 expect(ds).toHaveLength(3);expect(ds.map(d=>d.target?.path)).toEqual(['src/main.c','include/shared.h','src/main.c']);expect(ds[0]?.severity).toBe('warning');expect(ds[1]?.severity).toBe('note');
});
it('normalizes textarea newlines, selects full line for untrustworthy columns and bounds the list',()=>{
 for(const line of ['\tbad','中文','bad'])for(const column of [0,999]){
 const d=buildDiagnostics([log(`main.c:2:${column}: error: bad`)],{files:[{path:'main.c',text:`first\r\n${line}\r\n`}]})[0]!;
 expect(d.target).toEqual({path:'main.c',start:6,end:6+line.length});expect(d.column).toBe(column);
 }
 expect(buildDiagnostics([log(Array(250).fill('src/main.c:2: error: bad').join('\n'))],input)).toHaveLength(200);
});
