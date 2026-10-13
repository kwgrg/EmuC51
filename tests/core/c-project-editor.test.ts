import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {editCProject,normalizeCEditorInput} from '../../src/core/c-project-editor';
import type {CBuildInput} from '../../src/core/sdcc-build';
const bundle=JSON.parse(readFileSync('tests/fixtures/sdcc-mixed/emuc51-project.build.json','utf8'));
const fresh=():CBuildInput=>({project:structuredClone(bundle.project),files:bundle.inputs.map(({path,text}:{path:string;text:string})=>({path,text}))});
it('atomically adds each kind and updates entry metadata without rewriting source',()=>{
 const base=fresh();let input=editCProject(base,{kind:'add',path:'src/helper.c'});
 input=editCProject(input,{kind:'add',path:'extras/config.h'});expect(input.project?.includeDirs).toContain('extras');
 input=editCProject(input,{kind:'add',path:'asm/extra.asm'});expect(input.files.at(-1)?.text).toBe('.module extra\n.area CSEG (CODE)\n');
 const renamed=editCProject(input,{kind:'rename',path:'src/main.c',next:'app/start.c'});expect(renamed.project?.entry).toBe('app/start.c');expect(renamed.files.find(f=>f.path==='app/start.c')?.text).toBe(base.files[0]?.text);
 expect(base.files).toHaveLength(4);expect(input.project?.entry).toBe('src/main.c');
 const next=editCProject(renamed,{kind:'entry',path:'src/helper.c'});expect(next.project?.entry).toBe('src/helper.c');
 expect(editCProject(next,{kind:'delete',path:'app/start.c'}).files.some(f=>f.path==='app/start.c')).toBe(false);
});
it('preserves include/.module content and keeps only usable include directories after rename/delete',()=>{
 const base=fresh();const renamed=editCProject(base,{kind:'rename',path:'include/shared.h',next:'headers/common.h'});
 expect(renamed.project?.includeDirs).toEqual(['headers']);expect(renamed.files.find(f=>f.path==='src/main.c')?.text).toContain('#include "shared.h"');
 const asm=editCProject(base,{kind:'rename',path:'asm/bridge.asm',next:'asm/renamed.asm'});expect(asm.files.find(f=>f.path==='asm/renamed.asm')?.text).toContain('.module bridge');
 expect(editCProject(renamed,{kind:'delete',path:'headers/common.h'}).project?.includeDirs).toEqual([]);
});
it('protects entry/last ASM, type, paths, basename/module collisions and case ambiguity without mutation',()=>{
 const base=fresh(),before=JSON.stringify(base);
 for(const path of ['../bad.c','/bad.c','src//bad.c','src/main.c','other/MAIN.c','firmware.c','other/compute.asm','bad.txt'])expect(()=>editCProject(base,{kind:'add',path})).toThrow();
 for(const path of ['src/main.c','asm/bridge.asm'])expect(()=>editCProject(base,{kind:'delete',path})).toThrow();
 expect(()=>editCProject(base,{kind:'rename',path:'src/compute.c',next:'compute.h'})).toThrow();
 expect(()=>editCProject(base,{kind:'entry',path:'asm/bridge.asm'})).toThrow();
 expect(()=>editCProject(base,{kind:'delete',path:'missing.c'})).toThrow();expect(JSON.stringify(base)).toBe(before);
});
it('allows broken source drafts but rejects unsupported structure and bounded source violations',()=>{
 const base=fresh();base.files[0]!.text='#include "missing.h"\nBAD C';expect(normalizeCEditorInput(base).files[0]!.text).toContain('BAD C');
 expect(()=>normalizeCEditorInput({...base,cpu:{}})).toThrow();
 expect(()=>normalizeCEditorInput({files:[{path:'main.c',text:'x'.repeat(65537)}]})).toThrow();
 expect(()=>normalizeCEditorInput({files:[{path:'main.c',text:'\n'.repeat(8192)}]})).toThrow();
 expect(()=>normalizeCEditorInput({files:[{path:'dir/main.c',text:''}]})).toThrow();
 let full=base;for(let i=0;i<13;i++)full=editCProject(full,{kind:'add',path:`more${i}.c`});expect(()=>editCProject(full,{kind:'add',path:'overflow.c'})).toThrow();
});
it('enforces aggregate, header and include-directory limits atomically',()=>{
 let input=fresh();
 for(let i=0;i<15;i++)input=editCProject(input,{kind:'add',path:`include/h${i}.h`});
 expect(()=>editCProject(input,{kind:'add',path:'include/overflow.h'})).toThrow();
 let directories=fresh();for(let i=0;i<7;i++)directories=editCProject(directories,{kind:'add',path:`dir${i}/h${i}.h`});
 expect(()=>editCProject(directories,{kind:'add',path:'overflow/last.h'})).toThrow();
 let large=fresh();for(let i=0;i<5;i++)large=editCProject(large,{kind:'add',path:`f${i}.c`});
 large.files=large.files.map((file,index)=>({...file,text:index<8?'x'.repeat(65536):''}));
 expect(normalizeCEditorInput(large).files).toHaveLength(9);
 large.files[8]!.text='x';expect(()=>normalizeCEditorInput(large)).toThrow();
});
it('case-only rename preserves text and rejects conflicts against other basenames and stems',()=>{
 const input=fresh();const renamed=editCProject(input,{kind:'rename',path:'src/main.c',next:'src/Main.c'});
 expect(renamed.project?.entry).toBe('src/Main.c');expect(renamed.files[0]?.text).toBe(input.files[0]?.text);
 for(const next of ['src/COMPUTE.c','bridge.c','firmware.c'])expect(()=>editCProject(input,{kind:'rename',path:'src/main.c',next})).toThrow();
 expect(()=>editCProject(input,{kind:'entry',path:'include/shared.h'})).toThrow();
});

it('can delete a file to repair an oversized edited draft without allowing oversized saved results',()=>{
 const input=editCProject(fresh(),{kind:'add',path:'too_big.c'});input.files.at(-1)!.text='x'.repeat(65537);
 expect(()=>normalizeCEditorInput(input)).toThrow();expect(editCProject(input,{kind:'delete',path:'too_big.c'}).files).toHaveLength(4);
 expect(()=>editCProject(input,{kind:'rename',path:'too_big.c',next:'still_big.c'})).toThrow();
});
