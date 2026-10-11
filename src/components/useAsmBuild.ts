import { useCallback, useEffect, useRef, useState } from "react";
import type { AsmArtifact, AsmDiagnostic, AsmProject } from "../core/assembler";
import type { AsmBuildEvent } from "../worker/assembler.worker";

export function useAsmBuild(project?: AsmProject) {
  const worker = useRef<Worker | undefined>(undefined);
  const latestProject = useRef(project);
  latestProject.current = project;
  const [artifact, setArtifact] = useState<AsmArtifact>();
  const [diagnostics, setDiagnostics] = useState<AsmDiagnostic[]>([]);
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState("尚未构建");
  const cancel = useCallback(() => {
    worker.current?.terminate(); worker.current = undefined;
    setBuilding(false); setArtifact(undefined); setDiagnostics([]); setMessage("构建已取消或源码已变更，请重新构建");
  }, []);
  useEffect(() => { cancel(); }, [project?.name, project?.source, cancel]);
  useEffect(() => () => { worker.current?.terminate(); worker.current = undefined; }, []);
  const build = () => {
    if (!project || worker.current) return;
    setArtifact(undefined); setDiagnostics([]); setBuilding(true); setMessage("正在本地构建…");
    let task: Worker;
    try { task = new Worker(new URL("../worker/assembler.worker.ts", import.meta.url), { type: "module", name: "emuc51-assembler" }); }
    catch (error) { setBuilding(false); setMessage(error instanceof Error ? error.message : "无法启动构建 Worker"); return; }
    worker.current = task;
    const current = () => worker.current === task && latestProject.current?.name === project.name && latestProject.current?.source === project.source;
    task.onmessage = (event: MessageEvent<AsmBuildEvent>) => {
      if (!current()) return;
      task.terminate(); worker.current = undefined; setBuilding(false);
      setArtifact(event.data.artifact); setDiagnostics(event.data.diagnostics);
      setMessage(event.data.artifact ? "构建成功；可加载产物或导出 BIN" : "构建失败；未生成可加载产物");
    };
    task.onerror = () => {
      if (!current()) return;
      task.terminate(); worker.current = undefined; setBuilding(false); setMessage("构建 Worker 失败，请重试");
    };
    task.postMessage(project);
  };
  // Never expose stale bytes, even before the invalidation effect has run.
  const valid = artifact?.project.name === project?.name && artifact?.project.source === project?.source ? artifact : undefined;
  return { artifact: valid, diagnostics, building, message, build, cancel };
}
