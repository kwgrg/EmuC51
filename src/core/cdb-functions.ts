import { opcodeMeta } from "./opcodes";

export interface CdbFunction {
  id: string;
  name: string;
  entry: number;
  end: number; // Inclusive address of the final instruction's final byte.
}

/** SDCC 4.5 mcs51: F uses level 0_0; function G/F and XG/XF links use 0.
 * X marks the final instruction, not an exclusive byte bound. Unsupported
 * declarations/endpoints remain unnamed; never infer sizes from neighbours.
 */
export function parseCdbFunctions(cdb: string, module: string, firmware: Uint8Array): CdbFunction[] {
  if (cdb.length > 256 * 1024 || /[^\t\n\r -~]/.test(cdb)) throw new Error("CDB 函数记录超出限制");
  const records = cdb.split(/\r\n|\n|\r/);
  if (records.length > 16384 || records.some(record => record.length > 4096)) throw new Error("CDB 函数记录超出限制");
  const links = new Map<string, number[]>();
  const asm = new Set<number>();
  const declarations = new Map<string, { name: string; count: number }>();
  for (const raw of records) {
    const record = raw.trim();
    const link = /^L:((?:X?G|X?F[A-Za-z_][A-Za-z0-9_-]*)\$[A-Za-z_][A-Za-z0-9_]*\$0\$0):([\da-fA-F]{1,8})$/.exec(record);
    if (link) {
      const addresses = links.get(link[1]!) ?? [];
      if (addresses.length < 2) addresses.push(parseInt(link[2]!, 16));
      links.set(link[1]!, addresses);
    }
    const instruction = /^L:A\$([^$]+)\$\d+:([\da-fA-F]{1,8})$/.exec(record);
    if (instruction?.[1] === module) asm.add(parseInt(instruction[2]!, 16));
    const declaration = /^F:(G|F[A-Za-z_][A-Za-z0-9_-]*)\$([A-Za-z_][A-Za-z0-9_]*)\$0_0\$0\(\{\d+\}DF,[^\r\n]+\),[CZ],0,0,[01],\d+,\d+$/.exec(record);
    if (!declaration || (declaration[1] !== "G" && declaration[1] !== `F${module}`)) continue;
    const key = `${declaration[1]}$${declaration[2]}$0$0`;
    declarations.set(key, { name: declaration[2]!, count: (declarations.get(key)?.count ?? 0) + 1 });
    if (declarations.size > 256) throw new Error("CDB 函数数量超出限制");
  }
  const functions: CdbFunction[] = [];
  for (const [key, declaration] of declarations) {
    const starts = links.get(key), ends = links.get(`X${key}`);
    if (declaration.count !== 1 || starts?.length !== 1 || ends?.length !== 1) continue;
    const entry = starts[0]!, last = ends[0]!;
    if (entry > last || last >= firmware.length || last > 0xffff || !asm.has(entry) || !asm.has(last)) continue;
    let pc = entry;
    while (pc <= last) {
      const meta = opcodeMeta(firmware[pc]!);
      if (!meta.legal || pc + meta.length > firmware.length || pc + meta.length > 65536) break;
      if (pc === last) {
        functions.push({ id: `CDB::${module}::${key}`, name: declaration.name, entry, end: pc + meta.length - 1 });
        break;
      }
      pc += meta.length;
    }
  }
  return functions;
}

/** Names annotate the historical CALL target only, never claim the current C
 * activation (tail calls/jumps do not create machine frames). */
export function nameCallEntry(functions: readonly CdbFunction[], entry: number): { label: string; definition?: CdbFunction } {
  const exact = functions.filter(item => item.entry === entry);
  if (!exact.length) return { label: functions.some(item => item.entry < entry && entry <= item.end) ? "入口位于函数内部，未命名" : "无已验证函数入口" };
  const fn = exact[0]!;
  if (exact.length !== 1 || functions.some(item => item !== fn && item.entry <= fn.end && fn.entry <= item.end)) return { label: "函数别名或范围重叠，未命名" };
  return { label: fn.id, definition: fn };
}
