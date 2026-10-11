import { symbolByteExpressions, type CdbSymbol } from "./cdb-symbols";
import type { WatchResult } from "./expressions";

/** Describes storage encoding, not the original C type (CDB erases enum identity). */
export function cdbIntegerEncoding(symbol: CdbSymbol): { bits: number; signed: boolean } | undefined {
  const match = /^(SC|SI|SL):([SU])$/.exec(symbol.type);
  const size = match ? { SC: 1, SI: 2, SL: 4 }[match[1]!] : undefined;
  if (!size || symbol.size !== size || symbolByteExpressions(symbol).length !== size) return;
  return { bits: size * 8, signed: match![2] === "S" };
}

/** The fixed mcs51 profile uses little-endian storage and two's complement.
 * Arithmetic deliberately avoids JS bitwise coercion of unsigned 32-bit values.
 * Only complete, correctly ordered, error-free byte samples can become a number.
 */
export function decodeCdbInteger(symbol: CdbSymbol, results: readonly WatchResult[]): number | undefined {
  const encoding = cdbIntegerEncoding(symbol);
  if (!encoding || results.length !== symbol.size) return;
  const expressions = symbolByteExpressions(symbol);
  if (results.some((result, i) => result.expression !== expressions[i] || result.error !== undefined ||
    !Number.isInteger(result.value) || result.value! < 0 || result.value! > 255)) return;
  const unsigned = results.reduce((value, result, i) => value + result.value! * 256 ** i, 0);
  return encoding.signed && unsigned >= 2 ** (encoding.bits - 1) ? unsigned - 2 ** encoding.bits : unsigned;
}
