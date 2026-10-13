import type { BuildStageLog, CBuildInput } from './sdcc-build';

export interface BuildDiagnostic {
  tool: BuildStageLog['tool']; raw: string; path: string; line: number; column?: number;
  severity: 'error' | 'warning' | 'note'; preciseColumn?: boolean;
  target?: { path: string; start: number; end: number };
  unavailable?: string;
}

/** Only formats observed from the pinned tools, not arbitrary log text or linker guesses. */
export function buildDiagnostics(stages: BuildStageLog[], input: CBuildInput): BuildDiagnostic[] {
  const result: BuildDiagnostic[] = [];
  for (const stage of stages) for (const raw of `${stage.stderr}\n${stage.stdout}`.split(/\r?\n/)) {
    if (result.length >= 200) return result;
    const match = /^([^\s:]+):(\d+):(?:(\d+):)?\s*(fatal error|syntax error|error|warning|note)\b/i.exec(raw);
    if (!match) continue;
    const columnText = match[3] ?? (stage.tool === 'sdcc' ? /; column (\d+)\s*$/.exec(raw)?.[1] : undefined);
    const diagnostic: BuildDiagnostic = { tool: stage.tool, raw, path: match[1]!, line: Number(match[2]),
      ...(columnText ? {column:Number(columnText)} : {}), severity: /warning/i.test(match[4]!) ? 'warning' : /note/i.test(match[4]!) ? 'note' : 'error' };
    result.push(diagnostic);
    if (stage.tool === 'sdld' || stage.generated) { diagnostic.unavailable = '链接或生成汇编位置，不能映射到用户源码'; continue; }
    let path = diagnostic.path;
    const explicit = path.startsWith('/work/') || path.startsWith('./');
    if (path.startsWith('/work/')) path = path.slice(6);
    else if (path.startsWith('./')) path = path.slice(2);
    if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
      diagnostic.unavailable = '路径不属于当前工程'; continue;
    }
    // Bare basenames can be stripped by tools. Never choose one of several matches.
    const candidates = input.files.filter(file => explicit || path.includes('/') ? file.path === path : file.path.split('/').at(-1) === path);
    if (candidates.length !== 1) { diagnostic.unavailable = candidates.length ? '文件名歧义，不能定位' : '文件不在当前工程'; continue; }
    const file = candidates[0]!;
    const lines = file.text.split(/\r\n|\n|\r/);
    if (!Number.isSafeInteger(diagnostic.line) || diagnostic.line < 1 || diagnostic.line > lines.length) {
      diagnostic.unavailable = '行号超出当前源码'; continue;
    }
    // textarea normalizes CRLF to LF. Columns in tab/non-ASCII lines differ between tools:
    // preserve the reported column but select the whole line unless exact ASCII mapping is safe.
    const line = lines[diagnostic.line - 1]!;
    const start = lines.slice(0,diagnostic.line - 1).reduce((sum,text) => sum + text.length + 1,0);
    const column = diagnostic.column;
    const exact = column !== undefined && Number.isSafeInteger(column) && column >= 1 && column <= line.length + 1 && [...line].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126);
    diagnostic.preciseColumn = exact;
    diagnostic.target = {path:file.path,start:exact ? start + column! - 1 : start,end:exact ? start + column! - 1 : start + line.length};
  }
  return result;
}
