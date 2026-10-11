// Real Worker protocol benchmark, run with: node scripts/benchmark-coverage.mjs [baseline-ref]
// Baseline replaces only the worker entrypoint; both variants share the same CPU core.
import process from "node:process";
import { Buffer } from "node:buffer";
import { setInterval, clearInterval } from "node:timers";
import console from "node:console";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

const baselineRef = process.argv[2] ?? "e57399d";
const baselineSource = execFileSync("git", ["show", `${baselineRef}:src/worker/emulator.worker.ts`], { encoding: "utf8" });
const options = { bundle: true, write: false, platform: "node", format: "iife", logLevel: "silent" };
const baseline = (await build({ ...options, stdin: { contents: baselineSource, loader: "ts", resolveDir: resolve("src/worker") } })).outputFiles[0].text;
const current = (await build({ ...options, entryPoints: ["src/worker/emulator.worker.ts"] })).outputFiles[0].text;
const prefix = 'const { parentPort } = require("node:worker_threads"); global.self = { postMessage: data => parentPort.postMessage(data) };\n';
const suffix = '\nparentPort.on("message", data => self.onmessage({ data }));';

async function measure(source, enabled, poll) {
  const worker = new Worker(prefix + source + suffix, { eval: true });
  let requestId = 0;
  let coverageMessages = 0;
  let coverageJsonBytes = 0;
  let pending;
  worker.on("message", event => {
    if (event.type.startsWith("Coverage")) {
      coverageMessages++;
      coverageJsonBytes += Buffer.byteLength(JSON.stringify(event));
    }
    if (pending && event.requestId === pending.id && event.type === pending.type) { pending.resolve(event); pending = undefined; }
  });
  const send = (command, type) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending = { id, type, resolve, reject };
    worker.postMessage({ ...command, requestId: id });
  });
  worker.on("error", error => pending?.reject(error));
  try {
    await send({ type: "LoadFirmware", name: "loop.bin", bytes: Uint8Array.of(0x04, 0x80, 0xfd).buffer }, "Ready");
    if (enabled) await send({ type: "SetCoverage", enabled: true }, "CoverageChanged");
    await send({ type: "Run", maxSteps: 30_000, trace: false }, "Stopped"); // warm-up
    coverageMessages = 0;
    coverageJsonBytes = 0;
    const timer = poll ? setInterval(() => worker.postMessage({ type: "ReadCoverage", requestId: ++requestId, addresses: Array.from({ length: 80 }, (_, i) => i) }), 250) : undefined;
    const start = performance.now();
    const result = await send({ type: "Run", maxSteps: 200_000, trace: false }, "Stopped");
    const milliseconds = performance.now() - start;
    clearInterval(timer);
    if (result.state.steps !== 230_000) throw new Error("Unexpected instruction count");
    return { milliseconds, coverageMessages, coverageJsonBytes };
  } finally { await worker.terminate(); }
}
const results = { baseline: [], disabled: [], enabled: [], sampled: [] };
for (let round = 0; round < 5; round++) {
  const order = round % 2 ? ["sampled", "enabled", "disabled", "baseline"] : ["baseline", "disabled", "enabled", "sampled"];
  for (const mode of order) results[mode].push(await measure(mode === "baseline" ? baseline : current, mode === "enabled" || mode === "sampled", mode === "sampled"));
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = Object.fromEntries(Object.entries(results).map(([mode, values]) => [mode, {
  medianMs: Math.round(median(values.map(value => value.milliseconds))),
  runsMs: values.map(value => Math.round(value.milliseconds)),
  coverageMessages: values.map(value => value.coverageMessages),
  coverageJsonBytes: values.map(value => value.coverageJsonBytes),
}]));
console.log(JSON.stringify({ baselineRef, instructionsPerRun: 200_000, rounds: 5, ...report,
  disabledRatio: +(report.disabled.medianMs / report.baseline.medianMs).toFixed(3),
  sampledRatio: +(report.sampled.medianMs / report.baseline.medianMs).toFixed(3),
}, null, 2));
