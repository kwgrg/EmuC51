/** Fixed mcs51/small/debug compiler output, not the user SDAS language profile.
 * SDCCglue.c emits .ascii for strings and .byte for typed initializers.
 * Inline assembly still passes this check: file inclusion/macros remain forbidden.
 */
export function checkGeneratedSdccAssembly(path: string, text: string): void {
  const allowed = new Set(["module", "globl", "area", "org", "db", "dw", "ds", "equ", "end", "optsdcc", "ascii", "byte"]);
  for (const line of text.split(/\r\n|\n|\r/)) {
    // Quoted data may contain semicolons or directive-looking text. SDCC emits
    // quotes/backslashes as .db bytes; also handle escaped quotes in inline ASM.
    const code = line.replace(/"(?:\\.|[^"\\])*"/g, '""').split(";")[0]!;
    const directive = /^\s*(?:(?:[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+\$):{1,2}\s*)*\.([A-Za-z][A-Za-z0-9]*)\b/.exec(code);
    if (directive && !allowed.has(directive[1]!.toLowerCase())) throw new Error(`不支持的生成 SDAS 指令 .${directive[1]}：${path}`);
  }
}
