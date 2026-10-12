import { PROJECT_BUNDLE_LIMIT } from "../core/sdcc-project";
import { normalizeSdccDebug, SDCC_TEXT_LIMIT, verifySdccDebug, type VerifiedSdccDebug } from "../core/sdcc-debug";

/** Validate all four explicit files before changing the active workspace. */
export async function importSdccFiles(files: File[]): Promise<VerifiedSdccDebug> {
  if (files.length === 1 && ["emuc51-project.build.json", "emuc51-browser.build.json"].includes(files[0]!.name)) {
    if (files[0]!.size > PROJECT_BUNDLE_LIMIT) throw new Error("混合工程构建包最多 2 MiB");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await files[0]!.arrayBuffer());
    const data = normalizeSdccDebug(JSON.parse(text));
    if (files[0]!.name === "emuc51-project.build.json" && !data.project) throw new Error("此入口需要版本 2 混合工程构建包");
    return verifySdccDebug(data);
  }
  if (files.length !== 4 || new Set(files.map(file => file.name)).size !== 4) throw new Error("请同时选择源文件、IHX、CDB 和摘要清单四个不同文件");
  const manifestFile = files.find(file => file.name === "emuc51-sdcc.json");
  if (!manifestFile || manifestFile.size > 8192) throw new Error("缺少有效的 emuc51-sdcc.json 构建清单");
  for (const file of files) if (file.size > SDCC_TEXT_LIMIT) throw new Error("SDCC 单个文件最多 256 KiB");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const entries = await Promise.all(files.map(async file => [file.name, decoder.decode(await file.arrayBuffer())] as const));
  const texts = new Map(entries);
  let manifest: unknown;
  try { manifest = JSON.parse(texts.get(manifestFile.name)!); } catch { throw new Error("SDCC 摘要清单不是有效 JSON"); }
  // Normalize names before using them to pick file contents.
  const normalized = normalizeSdccDebug({ manifest, source: "", ihx: "", cdb: "" });
  const source = texts.get(normalized.manifest.files.source.name);
  const ihx = texts.get(normalized.manifest.files.ihx.name);
  const cdb = texts.get(normalized.manifest.files.cdb.name);
  return verifySdccDebug({ manifest: normalized.manifest, source, ihx, cdb });
}
