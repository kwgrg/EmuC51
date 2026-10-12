import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import process from "node:process";

// Native feasibility probe only: no browser compiler and no third-party asset distribution.
const root = process.env.SDCC_ROOT;
if (!root) throw new Error("Set SDCC_ROOT to the verified installation prefix (containing bin and share/sdcc)");
const prefix = resolve(root);
const bin = name => name === "sdcc" && process.env.SDCC_C1_BIN ? resolve(process.env.SDCC_C1_BIN) : join(prefix, "bin", name);
const patchedC1 = Boolean(process.env.SDCC_C1_BIN);
const include = join(prefix, "share/sdcc/include");
const library = join(prefix, "share/sdcc/lib/small");
const version = execFileSync(bin("sdcc"), ["--version"], { encoding: "utf8", timeout: 10000 });
assert.match(version, /4\.5\.0 #15242/);
const macros = ["__SDCC_CHAR_UNSIGNED", "__SDCC_MODEL_SMALL", "__SDCC_FLOAT_REENT", "__SDCCCALL=0", "__SDCC=4_5_0", "__SDCC_VERSION_MAJOR=4", "__SDCC_VERSION_MINOR=5", "__SDCC_VERSION_PATCH=0", "SDCC=450", "__SDCC_REVISION=15242", "__SDCC_mcs51", "__STDC_NO_COMPLEX__=1", "__STDC_NO_THREADS__=1", "__STDC_NO_ATOMICS__=1", "__STDC_NO_VLA__=1", "__STDC_ISO_10646__=201409L", "__SIZEOF_FLOAT__=4", "__SIZEOF_DOUBLE__=4", "__SDCC_BITINT_MAXWIDTH=64"];
const options = ["-mmcs51", "--model-small", "--iram-size", "128", "--debug"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function compile(source, stem) {
  const work = mkdtempSync(join(tmpdir(), "emuc51-split-sdcc-"));
  const run = (tool, args, input) => execFileSync(bin(tool), args, { cwd: work, input, timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  try {
    writeFileSync(join(work, `${stem}.c`), source);
    const preprocessed = run("sdcpp", ["-nostdinc", "-Wall", "-std=c11", "--obj-ext=.rel", ...macros.map(value => `-D${value}`), "-isystem", join(include, "mcs51"), "-isystem", include, "-xc", `${stem}.c`]);
    run("sdcc", ["--c1mode", ...(patchedC1 ? ["--c1-source", `${stem}.c`] : []), ...options, "-o", `${stem}.asm`], preprocessed);
    run("sdas8051", ["-plosgffwy", `${stem}.rel`, `${stem}.asm`]);
    writeFileSync(join(work, `${stem}.lk`), ["-muwx", `-i ${stem}.ihx`, "-M", "-I 0x0080", "-y", "-b HOME = 0x0000", "-b XSEG = 0x0001", "-b PSEG = 0x0001", "-b ISEG = 0x0000", "-b BSEG = 0x0000", `-k ${library}`, "-l mcs51", "-l libsdcc", "-l libint", "-l liblong", "-l libfloat", `${stem}.rel`, "-e", ""].join("\n"));
    run("sdld", ["-nf", `${stem}.lk`]);
    return { ihx: readFileSync(join(work, `${stem}.ihx`)), cdb: readFileSync(join(work, `${stem}.cdb`), "utf8") };
  } finally { rmSync(work, { recursive: true, force: true }); }
}
const results = [];
for (const [directory, stem] of [["sdcc-counter", "main"], ["sdcc-flow", "flow"]]) {
  const source = readFileSync(`tests/fixtures/${directory}/${stem}.c`, "utf8");
  const result = compile(source, stem);
  assert.deepEqual(result.ihx, readFileSync(`tests/fixtures/${directory}/${stem}.ihx`));
  // Known upstream c1mode limitation: never claim that native binary parity implies debug parity.
  assert.equal(/^M:/m.test(result.cdb), patchedC1);
  assert.equal(/^L:C\$/m.test(result.cdb), patchedC1);
  if (patchedC1) assert.equal(result.cdb, readFileSync(`tests/fixtures/${directory}/${stem}.cdb`, "utf8"));
  results.push({ fixture: directory, ihxSha256: sha(result.ihx), ihxMatches: true, sourceDebugAvailable: patchedC1 });
}
const original = readFileSync("tests/fixtures/sdcc-counter/main.c", "utf8");
const edited = compile(original.replace("counter = 0;", "counter = 7;"), "main");
assert.notEqual(sha(edited.ihx), results[0].ihxSha256);
let diagnostic;
try { compile("void main(void) {\n  unsigned char value = ;\n}\n", "broken"); }
catch (error) { diagnostic = error.stderr?.toString(); assert.notEqual(error.status, 0); }
assert.match(diagnostic ?? "", /broken\.c:2:.*syntax error/i);
assert.deepEqual(compile(original, "main").ihx, readFileSync("tests/fixtures/sdcc-counter/main.ihx"));
const assets = ["mcs51", "libsdcc", "libint", "liblong", "libfloat"].map(name => {
  const bytes = readFileSync(join(library, `${name}.lib`));
  return { path: `lib/small/${name}.lib`, bytes: bytes.length, sha256: sha(bytes) };
});
const header = readFileSync(join(include, "mcs51/8051.h"));
assets.push({ path: "include/mcs51/8051.h", bytes: header.length, sha256: sha(header) });
process.stdout.write(JSON.stringify({ compiler: version.split("\n")[0], patchedC1, nativeOnly: true, options, results, editedSourceChangesFirmware: true, syntaxDiagnostic: diagnostic.trim(), validBuildAfterErrorMatches: true, assets, assetBytes: assets.reduce((total, item) => total + item.bytes, 0), wasmBuild: "not attempted by this native-only probe", browserWorker: "not run", browserCancellation: "not run", wasmSizeAndPeakMemory: "not measured" }, null, 2) + "\n");
