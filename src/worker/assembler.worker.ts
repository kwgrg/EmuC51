/// <reference lib="webworker" />
import { assemble, ASSEMBLER_VERSION, normalizeAsmProject, type AsmArtifact, type AsmDiagnostic } from "../core/assembler";
import { sha256Hex } from "../core/digest";
export type AsmBuildEvent = { artifact?: AsmArtifact; diagnostics: AsmDiagnostic[] };
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<unknown>) => {
  try {
    const project = normalizeAsmProject(event.data);
    if (!project) throw new Error("ASM 项目名称或源码无效");
    const result = assemble(project.source);
    if (!result.bytes) { scope.postMessage({ diagnostics: result.diagnostics } satisfies AsmBuildEvent); return; }
    const bytes = result.bytes.buffer;
    const [sourceSha256, firmwareSha256] = await Promise.all([sha256Hex(new TextEncoder().encode(project.source).buffer), sha256Hex(bytes)]);
    scope.postMessage({ diagnostics: [], artifact: { project, bytes, binding: { sourceSha256, firmwareSha256, assembler: ASSEMBLER_VERSION } } } satisfies AsmBuildEvent, [bytes]);
  } catch (error) {
    scope.postMessage({ diagnostics: [{ line: 1, column: 1, message: error instanceof Error ? error.message : "构建失败" }] } satisfies AsmBuildEvent);
  }
};
