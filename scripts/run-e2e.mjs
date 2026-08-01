import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { preview } from "vite";

const host = "127.0.0.1";
const port = 41851;

const server = await preview({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  preview: { host, port, strictPort: true },
});

const playwrightCli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);

try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, "test", ...process.argv.slice(2)],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, EMUC51_E2E_EXTERNAL_SERVER: "1" },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Playwright exited after signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
  process.exitCode = exitCode;
} finally {
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}
