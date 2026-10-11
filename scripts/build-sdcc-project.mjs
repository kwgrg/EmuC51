import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, lstatSync, realpathSync, mkdirSync, mkdtempSync, rmSync, existsSync, renameSync } from "node:fs";
import { resolve, dirname, join, relative, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { normalizeSdccProject, normalizeProjectInputs, PROJECT_BUNDLE_LIMIT } from "../src/core/sdcc-project.ts";

// Node >=22.18 native TS stripping; this is a local developer tool, never invoked by the browser.
const [manifestArgument, outputArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) throw new Error("Usage: SDCC_BIN=/path/to/sdcc node scripts/build-sdcc-project.mjs project.json NEW_OUTPUT_DIRECTORY");
const manifestPath = resolve(manifestArgument), root = realpathSync(dirname(manifestPath)), output = resolve(outputArgument);
// Refusing every existing destination prevents an old successful artifact being mistaken for this run.
if (existsSync(output)) throw new Error("Output directory must not exist; use a fresh destination for every build");
if (lstatSync(manifestPath).isSymbolicLink() || lstatSync(manifestPath).size > 16384) throw new Error("Invalid project manifest file");
const project = normalizeSdccProject(JSON.parse(readFileSync(manifestPath, "utf8")));
const sha = value => createHash("sha256").update(value).digest("hex");
const decode = bytes => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
const files = [...project.sources.map(item => item.path), ...project.headers];
const inputs = normalizeProjectInputs(project, files.map(path => {
  const absolute = join(root, path), resolved = realpathSync(absolute), inside = relative(root, resolved);
  if (inside.startsWith(`..${sep}`) || inside === ".." || inside.startsWith(sep) || resolved !== absolute || !lstatSync(absolute).isFile() || lstatSync(absolute).size > 256 * 1024) throw new Error("Source must be a regular in-project file, without symlinks");
  const bytes = readFileSync(absolute); return { path, text: decode(bytes), sha256: sha(bytes) };
}));
const inputByPath = new Map(inputs.map(item => [item.path, item.text]));
function checkText(path, text, generated = false) {
  // Conservative initial profile: no disguised directives, pragma flags or assembler file inclusion.
  if (/\\\r?\n|\?\?|%:|_Pragma|__has_include/.test(text) || /\.\s*(?:include|incbin)\b/i.test(text)) throw new Error(`Unsupported file/directive syntax in ${path}`);
  if (path.endsWith(".asm")) {
    for (const line of text.split(/\r\n|\n|\r/)) {
      const directive = /^\s*\.([A-Za-z]+)/.exec(line.split(";")[0]);
      if (directive && !["module","globl","area","org","db","dw","ds","equ","end",...(generated ? ["optsdcc"] : [])].includes(directive[1].toLowerCase())) throw new Error(`Unsupported SDAS directive in ${path}`);
    }
  }
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  for (const line of clean.split(/\r\n|\n|\r/)) {
    if (!/^\s*#/.test(line)) continue;
    const include = /^\s*#\s*include\s*(["<])([A-Za-z_][A-Za-z0-9_/-]*\.[hH])[">]\s*$/.exec(line);
    if (include) {
      const name = include[2];
      const candidates = [join(dirname(path), name), ...project.includeDirs.map(dir => join(dir, name))];
      if (!candidates.some(candidate => project.headers.includes(candidate)) && !(include[1] === "<" && ["8051.h","stdint.h"].includes(name))) throw new Error(`Unlisted header in ${path}`);
    } else if (!/^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif|define|undef|error)\b/.test(line)) throw new Error(`Unsupported preprocessor directive in ${path}`);
  }
}
for (const input of inputs) checkText(input.path, input.text);
const executable = process.env.SDCC_BIN || "sdcc";
const assembler = process.env.SDAS8051_BIN || (executable.includes("/") ? join(dirname(resolve(executable)), "sdas8051") : "sdas8051");
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 10000 });
if (!/4\.5\.0 #15242 \(Linux\)/.test(version)) throw new Error("Requires native SDCC 4.5.0 #15242 (Linux)");
const work = mkdtempSync(join(tmpdir(), "emuc51-mixed-build-"));
try {
  for (const input of inputs) { const file = join(work, input.path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, input.text); }
  const sources = [project.sources.find(item => item.path === project.entry), ...project.sources.filter(item => item.path !== project.entry)];
  const run = (tool, args) => execFileSync(tool, args, { env: { PATH: process.env.PATH, LC_ALL: "C" }, cwd: work, timeout: 60000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore","pipe","pipe"] });
  const rels = [];
  for (const source of sources) {
    const stem = basename(source.path).replace(/\.[^.]+$/, "");
    let assembly = source.path;
    if (source.language === "c") {
      assembly = `${stem}.asm`;
      run(executable, [...project.options, ...project.includeDirs.map(dir => `-I${dir}`), "-S", source.path, "-o", assembly]);
      checkText(assembly, readFileSync(join(work, assembly), "utf8"), true);
    } else if (inputByPath.get(source.path).match(/^\s*\.module\s+(\w+)/m)?.[1] !== stem) throw new Error("SDAS .module must exactly match its unique filename stem");
    run(assembler, ["-plosgffwy", `${stem}.rel`, assembly]); rels.push(`${stem}.rel`);
  }
  run(executable, [...project.options, ...rels, "-o", "firmware.ihx"]);
  const ihx = readFileSync(join(work, "firmware.ihx"), "utf8"), cdb = readFileSync(join(work, "firmware.cdb"), "utf8");
  const entryModule = basename(project.entry).replace(/\.c$/, "");
  const entryRecords = cdb.split(/^M:/m).find(section => section.startsWith(`${entryModule}\n`));
  if (!entryRecords || !/^F:G\$main\$0_0\$0\(/m.test(entryRecords)) throw new Error("Entry C source must define main");
  if (Buffer.byteLength(ihx) > 256 * 1024 || Buffer.byteLength(cdb) > 256 * 1024) throw new Error("Linked artifact exceeds import limits");
  const entry = inputs.find(item => item.path === project.entry);
  const bundle = { manifest: { format: "emuc51-sdcc-debug", version: 2, compiler: "SDCC 4.5.0 #15242", target: "classic-8051", options: project.options,
    files: { source: { name: entry.path, sha256: entry.sha256 }, ihx: { name: "firmware.ihx", sha256: sha(ihx) }, cdb: { name: "firmware.cdb", sha256: sha(cdb) } }, projectSha256: sha(JSON.stringify(project)) },
    project, inputs, source: entry.text, ihx, cdb };
  const text = JSON.stringify(bundle, null, 2) + "\n";
  if (Buffer.byteLength(text) > PROJECT_BUNDLE_LIMIT) throw new Error("Build package exceeds 2 MiB");
  // Publish a single package only after every stage succeeds. Never leave partial output.
  mkdirSync(dirname(output), { recursive: true });
  const staging = mkdtempSync(join(dirname(output), ".emuc51-package-"));
  try { writeFileSync(join(staging, "emuc51-project.build.json"), text); renameSync(staging, output); }
  finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
  process.stdout.write(`Mixed project built successfully: ${output}/emuc51-project.build.json\n`);
} finally { rmSync(work, { recursive: true, force: true }); }
