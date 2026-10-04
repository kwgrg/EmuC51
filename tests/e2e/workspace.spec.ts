import { expect, test } from "@playwright/test";
import path from "node:path";

test("固件不上传且刷新后恢复工作区", async ({ page }) => {
  const requests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) =>
    requests.push({ method: request.method(), url: request.url() }),
  );

  await page.goto("/");
  const appOrigin = new URL(page.url()).origin;
  await page.evaluate(() => indexedDB.deleteDatabase("emuc51"));
  await page.reload();

  const firmware = path.resolve("tests/fixtures/firmware/testc51a.bin");
  await page.getByTestId("firmware-input").setInputFiles(firmware);
  await expect(page.getByText("testc51a.bin")).toBeVisible();
  await expect(page.getByTestId("register-PC")).toContainText("0000");

  await page.getByRole("button", { name: "单步" }).click();
  await expect(page.getByTestId("register-PC")).toContainText("0003");
  await expect(page.locator(".footer-status")).toHaveText("工作区已保存在此浏览器");

  await page.reload();
  await expect(page.getByText("testc51a.bin")).toBeVisible();
  await expect(page.getByTestId("register-PC")).toContainText("0003");

  expect(requests.every((request) => request.method === "GET")).toBe(true);
  expect(requests.every((request) => new URL(request.url).origin === appOrigin)).toBe(
    true,
  );
});

test("四个终端视图可以通过共享导航访问", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toHaveAttribute("data-view", "home");
  await expect(page.getByText("MCS-51 Next-Gen Emulation")).toBeVisible();

  const desktopNav = page.locator(".desktop-nav");
  await desktopNav.getByRole("button", { name: "BIN_INSPECTOR" }).click();
  await expect(page.getByRole("main")).toHaveAttribute("data-view", "editor");

  await desktopNav.getByRole("button", { name: "SYS_MEM" }).click();
  await expect(page.getByRole("main")).toHaveAttribute("data-view", "memory");
  await expect(page.getByText("ROM_VIEW [CODE]")).toBeVisible();

  await desktopNav.getByRole("button", { name: "I/O_PORTS" }).click();
  await expect(page.getByRole("main")).toHaveAttribute("data-view", "io");
  await expect(page.getByText("GPIO_INPUT_OUTPUT")).toBeVisible();

  await page.getByRole("button", { name: "MCS-51_EMU_V1.0" }).click();
  await expect(page.getByRole("main")).toHaveAttribute("data-view", "home");
});
