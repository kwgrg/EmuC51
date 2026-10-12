import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCBuild } from "../../src/components/useCBuild";
import type { CBuildResult } from "../../src/core/sdcc-build";
import type { CBuildEvent } from "../../src/worker/compiler.worker";
const tasks:FakeWorker[]=[];
class FakeWorker {
  onmessage?:(event:MessageEvent<CBuildEvent>)=>void;
  onerror?:()=>void;
  terminate=vi.fn();postMessage=vi.fn();
  constructor(){tasks.push(this);}
  finish(result?:CBuildResult,id=this.postMessage.mock.calls[0]![0].id){this.onmessage?.({data:{id,result,error:result?undefined:"syntax error"}} as MessageEvent<CBuildEvent>);}
}
const input={files:[{path:"main.c",text:"void main(void) {}"}]};
const artifact={data:{},milliseconds:100,maxStageHeapBytes:16777216,diagnostics:""} as CBuildResult;
beforeEach(()=>{tasks.length=0;vi.stubGlobal("Worker",FakeWorker);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
it("terminates superseded tasks and ignores cancelled, misidentified and old workspace results",()=>{
  const hook=renderHook(({epoch})=>useCBuild(input,epoch),{initialProps:{epoch:0}});
  act(()=>{hook.result.current.build();hook.result.current.build();});
  expect(tasks[0]!.terminate).toHaveBeenCalled();
  act(()=>tasks[0]!.finish(artifact));expect(hook.result.current.artifact).toBeUndefined();
  act(()=>tasks[1]!.finish(artifact,99));expect(hook.result.current.building).toBe(true);
  hook.rerender({epoch:1});act(()=>tasks[1]!.finish(artifact));expect(hook.result.current.artifact).toBeUndefined();
  act(()=>hook.result.current.build());act(()=>tasks[2]!.finish(artifact));expect(hook.result.current.artifact).toBe(artifact);
  const accepts=hook.result.current.isCurrent;
  act(()=>hook.result.current.cancel());expect(hook.result.current.artifact).toBeUndefined();expect(accepts(artifact)).toBe(false);
});
it("invalidates a successful load callback immediately when the draft changes and clears bytes on failed builds",()=>{
  const hook=renderHook(({draft})=>useCBuild(draft,0),{initialProps:{draft:input}});
  act(()=>hook.result.current.build());act(()=>tasks[0]!.finish(artifact));
  const accepts=()=>hook.result.current.isCurrent(artifact);expect(accepts()).toBe(true);
  hook.rerender({draft:{files:[{path:"main.c",text:"broken"}]}});expect(accepts()).toBe(false);expect(hook.result.current.artifact).toBeUndefined();
  act(()=>hook.result.current.build());act(()=>tasks[1]!.finish());expect(hook.result.current.message).toContain("syntax error");expect(hook.result.current.artifact).toBeUndefined();
  act(()=>hook.result.current.build());act(()=>tasks[2]!.finish(artifact));const previous=hook.result.current.isCurrent;hook.unmount();expect(previous(artifact)).toBe(false);
});
it("enforces the hard timeout and terminates on unmount",()=>{
  vi.useFakeTimers();const hook=renderHook(()=>useCBuild(input,0));
  act(()=>hook.result.current.build());act(()=>vi.advanceTimersByTime(30000));
  expect(tasks[0]!.terminate).toHaveBeenCalled();expect(hook.result.current.message).toContain("30 秒");
  act(()=>tasks[0]!.finish(artifact));expect(hook.result.current.artifact).toBeUndefined();
  act(()=>hook.result.current.build());hook.unmount();expect(tasks[1]!.terminate).toHaveBeenCalled();
});
