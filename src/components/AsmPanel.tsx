import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ASSEMBLER_VERSION, MAX_ASM_SOURCE, type AsmArtifact, type AsmDiagnostic, type AsmProject } from "../core/assembler";

export function AsmPanel({ project, artifact, diagnostics, building, disabled, status, onProject, onBuild, onCancel, onLoad, onNew }: {
  project?: AsmProject; artifact?: AsmArtifact; diagnostics: AsmDiagnostic[];
  building: boolean; disabled: boolean; status: string;
  onProject: (project: AsmProject) => void; onBuild: () => void; onCancel: () => void;
  onLoad: () => void; onNew: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ disabled, onProject });
  latest.current = { disabled, onProject };
  const fileAction = useRef(0);
  useEffect(() => () => { fileAction.current++; }, []);
  const [error, setError] = useState<string>();
  const importSource = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    const id = ++fileAction.current;
    try {
      if (file.size > MAX_ASM_SOURCE * 4) throw new Error("ASM 文件最多 256 KiB，解码后最多 65536 个字符");
      const source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (source.length > MAX_ASM_SOURCE) throw new Error("ASM 源码最多 65536 个字符");
      if (id !== fileAction.current || latest.current.disabled) return;
      // Keep a portable basename; source content is never used as a filename.
      const name = /^[\w\-.]{1,80}\.asm$/i.test(file.name) ? file.name : "main.asm";
      latest.current.onProject({ name, source });
      setError(undefined);
    } catch (caught) { if (id === fileAction.current) setError(caught instanceof Error ? caught.message : "无法读取源码"); }
  };
  const download = (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const locate = (diagnostic: AsmDiagnostic) => {
    const text = input.current?.value ?? project?.source ?? "";
    const lines = text.split(/\r\n|\n|\r/);
    let offset = 0;
    const breaks = [...text.matchAll(/\r\n|\n|\r/g)];
    if (diagnostic.line > 1) { const previous = breaks[diagnostic.line - 2]; if (previous) offset = previous.index! + previous[0].length; }
    offset += Math.min(diagnostic.column - 1, lines[diagnostic.line - 1]?.length ?? 0);
    input.current?.focus(); input.current?.setSelectionRange(offset, Math.min(offset + 1, text.length));
    if (input.current) input.current.scrollTop = Math.max(0, diagnostic.line - 3) * 20;
  };
  return <section className="asm-panel" aria-label="ASM 源码工程">
    <div className="asm-actions">
      <button disabled={disabled || building} onClick={() => { fileAction.current++; onNew(); }}>新建 ASM 示例</button>
      <label className="secondary-command"><input aria-label="导入 ASM 源码" type="file" accept=".asm,text/plain" disabled={disabled || building} onChange={event => void importSource(event)} />导入 ASM</label>
      <button disabled={!project} onClick={() => project && download(project.name, new Blob([project.source], { type: "text/plain;charset=utf-8" }))}>导出 ASM</button>
      <button disabled={!project || disabled || building} onClick={onBuild}>构建 ASM</button>
      <button disabled={!building} onClick={onCancel}>取消构建</button>
      <button disabled={!artifact || disabled || building} onClick={onLoad}>加载构建产物</button>
      <button disabled={!artifact || building} onClick={() => artifact && download(artifact.project.name.replace(/\.asm$/i, ".bin"), new Blob([artifact.bytes], { type: "application/octet-stream" }))}>导出 BIN</button>
    </div>
    <p data-testid="asm-status">{status}</p>
    {error && <p role="alert">{error}</p>}
    {project && <label className="asm-source-label">{project.name}
      <textarea ref={input} aria-label="ASM 源码" spellCheck={false} value={project.source} maxLength={MAX_ASM_SOURCE} disabled={disabled}
        onChange={event => { fileAction.current++; onProject({ ...project, source: event.target.value }); }} />
    </label>}
    {diagnostics.length > 0 && <ul className="asm-diagnostics" aria-label="ASM 构建诊断">{diagnostics.map((diagnostic, i) => <li key={i}>
      <button onClick={() => locate(diagnostic)}>第 {diagnostic.line} 行，第 {diagnostic.column} 列：{diagnostic.message}</button>
    </li>)}</ul>}
    {artifact && <p className="asm-hashes">{ASSEMBLER_VERSION} · {artifact.bytes.byteLength} B<br />SOURCE SHA-256 {artifact.binding.sourceSha256}<br />BIN SHA-256 {artifact.binding.firmwareSha256}</p>}
    <p>单文件 ASM：经典 8051 指令、标签、ORG/DB/DW/EQU/END；整数、SFR 名称、$ 与 +/−。不支持宏、INCLUDE、字符串、P1.0 位名或 C。源码只保存在本浏览器，导出 ASM 可备份；构建不会自动覆盖当前 CPU。</p>
  </section>;
}
