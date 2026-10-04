import { defineConfig, devices } from "@playwright/test";

const externalServer = process.env.EMUC51_E2E_EXTERNAL_SERVER === "1";
const chromiumExecutable = process.env.EMUC51_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:41851",
    trace: "retain-on-failure",
  },
  webServer: externalServer
    ? undefined
    : {
        command: "node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 41851 --strictPort",
        url: "http://127.0.0.1:41851",
        reuseExistingServer: false,
      },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutable
          ? { launchOptions: { executablePath: chromiumExecutable } }
          : {}),
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
