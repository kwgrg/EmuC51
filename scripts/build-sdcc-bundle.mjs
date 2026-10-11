import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { TextDecoder } from "node:util";

// Native, explicit local build only. A fresh directory prevents mixing stale compiler outputs.
const [sourceArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument) throw new Error("Usage: SDCC_BIN=sdcc node scripts/build-sdcc-bundle.mjs source.c empty-output-directory");
const sourcePath = resolve(sourceArgument);
const output = resolve(outputArgument);
const name = basename(sourcePath);
if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}\.c$/.test(name)) throw new Error("Use a portable single-file basename ending in .c");
if (existsSync(output) && readdirSync(output).length) throw new Error("Output directory must be empty; old build files will not be reused");
const sourceBytes = readFileSync(sourcePath);
const sourceText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(sourceBytes);
if (sourceBytes.length > 256 * 1024 || sourceText.length > 65536 || sourceText.split(/\r\n|\n|\r/).length > 8192) throw new Error("Source exceeds the single-file import limits");
const options = ["-mmcs51", "--model-small", "--iram-size", "128", "--debug"];
const executable = process.env.SDCC_BIN || "sdcc";
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 10000 });
if (!/4\.5\.0 #15242 \(Linux\)/.test(version)) throw new Error("This import profile is validated for SDCC 4.5.0 #15242 (Linux)");
const work = mkdtempSync(`${tmpdir()}/emuc51-sdcc-build-`);
try {
  copyFileSync(sourcePath, `${work}/${name}`);
  execFileSync(executable, [...options, name, "-o", name.replace(/\.c$/, ".ihx")], { cwd: work, encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
  const files = {};
  for (const [key, extension] of [["source", "c"], ["ihx", "ihx"], ["cdb", "cdb"]]) {
    const filename = name.replace(/\.c$/, `.${extension}`);
    const bytes = readFileSync(`${work}/${filename}`);
    if (bytes.length > 256 * 1024) throw new Error(`${filename} exceeds the import profile's size limit`);
    files[key] = { name: filename, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  mkdirSync(dirname(output), { recursive: true }); mkdirSync(output, { recursive: true });
  for (const file of Object.values(files)) copyFileSync(`${work}/${file.name}`, `${output}/${file.name}`);
  writeFileSync(`${output}/emuc51-sdcc.json`, JSON.stringify({ format: "emuc51-sdcc-debug", version: 1, compiler: "SDCC 4.5.0 #15242", target: "classic-8051", options, files }, null, 2) + "\n");
  process.stdout.write(`Real native SDCC build complete. Select the four files in ${output} in EmuC51.\n`);
} finally { rmSync(work, { recursive: true, force: true }); }
