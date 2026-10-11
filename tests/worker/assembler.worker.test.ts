import { webcrypto, createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { AsmBuildEvent } from "../../src/worker/assembler.worker";
afterEach(()=>vi.unstubAllGlobals());
it("transports source maps together with the actual source/binary digests and drops mappings on errors",async()=>{
  vi.resetModules(); vi.stubGlobal("crypto",webcrypto);
  const events:AsmBuildEvent[]=[];
  const scope:{onmessage?: (event:MessageEvent<unknown>)=>Promise<void>;postMessage:(event:AsmBuildEvent)=>void}={postMessage:event=>events.push(event)};
  vi.stubGlobal("self",scope); await import("../../src/worker/assembler.worker");
  const project={name:"map.asm",source:"ORG 10h\nSTART: NOP\nDB 0"};
  await scope.onmessage!({data:project} as MessageEvent<unknown>);
  const artifact=events[0]!.artifact!;
  expect(artifact.sourceMap).toEqual([{line:2,column:8,address:16,length:1,kind:"instruction"},{line:3,column:1,address:17,length:1,kind:"data"}]);
  expect(artifact.labels).toEqual([{name:"START",line:2,column:1,address:16,kind:"instruction"}]);
  expect(artifact.binding.sourceSha256).toBe(createHash("sha256").update(project.source).digest("hex"));
  expect(artifact.binding.firmwareSha256).toBe(createHash("sha256").update(new Uint8Array(artifact.bytes)).digest("hex"));
  await scope.onmessage!({data:{...project,source:"NOP\nBAD"}} as MessageEvent<unknown>);
  expect(events[1]!.artifact).toBeUndefined(); expect(events[1]!.diagnostics.length).toBeGreaterThan(0);
});
