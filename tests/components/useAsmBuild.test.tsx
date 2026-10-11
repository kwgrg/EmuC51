import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAsmBuild } from "../../src/components/useAsmBuild";
import { ASSEMBLER_VERSION, type AsmArtifact } from "../../src/core/assembler";
import type { AsmBuildEvent } from "../../src/worker/assembler.worker";

const tasks: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: MessageEvent<AsmBuildEvent>) => void;
  onerror?: () => void;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { tasks.push(this); }
  finish(artifact?: AsmArtifact) { this.onmessage?.({ data: { artifact, diagnostics: artifact ? [] : [{ line: 1, column: 1, message: "invalid" }] } } as MessageEvent<AsmBuildEvent>); }
}
const project = { name: "main.asm", source: "NOP" };
const artifact: AsmArtifact = { labels:[],sourceMap: [{ line: 1, column: 1, address: 0, length: 1, kind: "instruction" }], project, bytes: new Uint8Array([0]).buffer, binding: { assembler: ASSEMBLER_VERSION, sourceSha256: "a".repeat(64), firmwareSha256: "b".repeat(64) } };
beforeEach(() => { tasks.length = 0; vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("deduplicates synchronous build requests and discards a cancelled worker's late success", () => {
  const { result } = renderHook(() => useAsmBuild(project));
  act(() => { result.current.build(); result.current.build(); });
  expect(tasks).toHaveLength(1);
  expect(result.current.building).toBe(true);
  act(() => result.current.cancel());
  act(() => tasks[0]!.finish(artifact));
  expect(result.current.artifact).toBeUndefined();
  expect(tasks[0]!.terminate).toHaveBeenCalled();
  act(() => result.current.build());
  act(() => tasks[1]!.finish(artifact));
  expect(result.current.artifact).toEqual(artifact);
  expect(result.current.building).toBe(false);
});
it("invalidates old results when source changes and clears successful bytes on failed rebuild", async () => {
  const { result, rerender } = renderHook(({ source }) => useAsmBuild({ ...project, source }), { initialProps: { source: "NOP" } });
  act(() => result.current.build());
  rerender({ source: "INC A" });
  act(() => tasks[0]!.finish(artifact));
  expect(result.current.artifact).toBeUndefined();
  rerender({ source: "NOP" });
  act(() => result.current.build());
  act(() => tasks[1]!.finish(artifact));
  expect(result.current.artifact).toEqual(artifact);
  act(() => result.current.build());
  expect(result.current.artifact).toBeUndefined();
  act(() => tasks[2]!.finish());
  await waitFor(() => expect(result.current.diagnostics).toHaveLength(1));
  expect(result.current.artifact).toBeUndefined();
});
it("terminates building work on unmount and reports worker startup/runtime failures", () => {
  const { result, unmount } = renderHook(() => useAsmBuild(project));
  act(() => result.current.build());
  act(() => tasks[0]!.onerror?.());
  expect(result.current.message).toContain("失败");
  act(() => result.current.build());
  unmount();
  expect(tasks[1]!.terminate).toHaveBeenCalled();
  vi.stubGlobal("Worker", class { constructor() { throw new Error("startup unavailable"); } });
  const second = renderHook(() => useAsmBuild(project));
  act(() => second.result.current.build());
  expect(second.result.current.message).toBe("startup unavailable");
  expect(second.result.current.building).toBe(false);
});
