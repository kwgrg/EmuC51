import { expect, test } from "@playwright/test";
import path from "node:path";

test("固件不上传且刷新后恢复工作区", async ({ page }) => {
  const requests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) =>
    requests.push({ method: request.method(), url: request.url() }),
  );

  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("emuc51"));
  await page.reload();

  const firmware = path.resolve("tests/fixtures/firmware/testc51a.bin");
  await page.getByTestId("firmware-input").setInputFiles(firmware);
  await expect(page.getByText("testc51a.bin")).toBeVisible();
  await expect(page.getByTestId("register-PC")).toContainText("0000");

  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0003");
  await expect(page.getByText("工作区已保存在此浏览器")).toBeVisible();

  await page.reload();
  await expect(page.getByText("testc51a.bin")).toBeVisible();
  await expect(page.getByTestId("register-PC")).toContainText("0003");

  expect(requests.every((request) => request.method === "GET")).toBe(true);
  expect(requests.every((request) => new URL(request.url).origin === "http://127.0.0.1:4173")).toBe(
    true,
  );
});
