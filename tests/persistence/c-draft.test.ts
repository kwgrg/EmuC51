import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {C_DRAFT_KEY,parseCDraft,serializeCDraft,readCDraft,saveCDraft,clearCDraft} from '../../src/persistence/c-draft';
const draft={input:{files:[{path:'main.c',text:'broken C'}]},selected:'main.c'};
beforeEach(()=>localStorage.clear());afterEach(()=>vi.restoreAllMocks());
it('round trips only source/manifest/selection and clears a slot independently of the CPU',()=>{
 saveCDraft(draft);expect(readCDraft()).toEqual(draft);expect(JSON.parse(localStorage.getItem(C_DRAFT_KEY)!)).toEqual({format:'emuc51-c-draft',version:1,...draft});
 clearCDraft();expect(readCDraft()).toBeUndefined();
});
it('rejects corruption, future versions, unknown CPU fields and missing file identity',()=>{
 const good=JSON.parse(serializeCDraft(draft));
 for(const bad of ['{',JSON.stringify({...good,version:2}),JSON.stringify({...good,cpu:{pc:22}}),JSON.stringify({...good,selected:'gone.c'}),JSON.stringify({...good,input:{files:[{path:'../main.c',text:'bad'}]}})]){
  localStorage.setItem(C_DRAFT_KEY,bad);expect(()=>readCDraft()).toThrow();expect(localStorage.getItem(C_DRAFT_KEY)).toBe(bad);
 }
});
it('checks serialized UTF-8 size before parsing and preserves prior saved content on failed validation/quota',()=>{
 saveCDraft(draft);const saved=localStorage.getItem(C_DRAFT_KEY);
 expect(()=>parseCDraft(' '.repeat(2*1024*1024+1))).toThrow('2 MiB');expect(()=>parseCDraft('中'.repeat(800000))).toThrow('2 MiB');
 expect(()=>saveCDraft({...draft,input:{files:[{path:'main.c',text:'x'.repeat(65537)}]}})).toThrow();expect(localStorage.getItem(C_DRAFT_KEY)).toBe(saved);
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Quota','QuotaExceededError');});
 expect(()=>saveCDraft({...draft,input:{files:[{path:'main.c',text:'new'}]}})).toThrow('Quota');expect(localStorage.getItem(C_DRAFT_KEY)).toBe(saved);
});
it('surfaces denied access instead of claiming empty/successful storage',()=>{
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('denied');});expect(()=>readCDraft()).toThrow('denied');
 vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw new Error('denied');});expect(()=>clearCDraft()).toThrow('denied');
});
