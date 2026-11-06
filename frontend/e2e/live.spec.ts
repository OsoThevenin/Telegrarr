import { chromium, type Page } from "@playwright/test";

import { expect, signIn, submitLoginForm, test } from "./fixtures";

const PAUSE = "Posa en pausa les baixades";
const RESUME = "Reprèn les baixades";

// The sidebar toggle: the Dashboard also offers to resume, from its status line.
const button = (page: Page, name: string) => page.getByRole("complementary").getByRole("button", { name });
const palette = (page: Page) => page.getByRole("dialog", { name: "Paleta d’ordres" });

async function runCommand(page: Page, name: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type(name);
  await expect(page.getByRole("option", { name })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
}

async function isQueuePaused(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/status");
  return (await response.json()).paused;
}

const OLD_SHELL_CACHE = "telearr-shell-v18";

const serviceWorkerScope = (page: Page) =>
  page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
const cacheNames = (page: Page) => page.evaluate(() => caches.keys());
const isControlled = (page: Page) => page.evaluate(() => navigator.serviceWorker.controller !== null);

async function serveOldWorker(page: Page, serving: boolean) {
  const response = await page.request.post("/__e2e__/old-worker", { params: { serving } });
  expect(response.ok()).toBe(true);
}

test.describe("live updates", () => {
  test("a pause made elsewhere reaches the open page through the stream", async ({ signedInPage: page }) => {
    await page.goto("/");
    await expect(button(page, PAUSE)).toBeEnabled();

    await page.request.post("/api/queue/pause");

    await expect(button(page, RESUME)).toBeEnabled();
  });

  test("the toggle pauses and resumes the queue", async ({ signedInPage: page }) => {
    await page.goto("/");

    await button(page, PAUSE).click();
    await expect(button(page, RESUME)).toBeEnabled();
    expect(await isQueuePaused(page)).toBe(true);

    await button(page, RESUME).click();
    await expect(button(page, PAUSE)).toBeEnabled();
    expect(await isQueuePaused(page)).toBe(false);
  });
});

test.describe("command palette", () => {
  test("reaches a screen with the keyboard alone", async ({ signedInPage: page }) => {
    await page.goto("/");
    await expect(button(page, PAUSE)).toBeEnabled();

    await runCommand(page, "Ves a Sistema");

    await expect(page.getByRole("heading", { level: 1, name: "Sistema" })).toBeVisible();
    await expect(page).toHaveURL("/system");
  });

  test("marks only the highlighted command", async ({ signedInPage: page }) => {
    await page.goto("/");
    await expect(button(page, PAUSE)).toBeEnabled();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();

    const backgrounds = await page
      .getByRole("option")
      .evaluateAll((options) => options.map((option) => getComputedStyle(option).backgroundColor));
    const unmarked = backgrounds.filter((color) => color === "rgba(0, 0, 0, 0)");
    expect(backgrounds.length).toBeGreaterThan(1);
    expect(unmarked).toHaveLength(backgrounds.length - 1);
  });

  test("runs an action against the backend", async ({ signedInPage: page }) => {
    await page.goto("/");
    await expect(button(page, PAUSE)).toBeEnabled();

    await runCommand(page, PAUSE);

    await expect(button(page, RESUME)).toBeEnabled();
    expect(await isQueuePaused(page)).toBe(true);
  });

  test("toggles the theme and keeps it across a reload", async ({ signedInPage: page }) => {
    await page.goto("/");
    await expect(button(page, PAUSE)).toBeEnabled();

    await runCommand(page, "Canvia el tema");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("installed app", () => {
  // The headless shell answers no errors for any page, and a throwaway context always
  // answers "in-incognito": only full Chromium with a real profile runs this check.
  test("passes the browser's installability check", async ({ baseURL }, testInfo) => {
    const context = await chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      baseURL,
      channel: "chromium",
    });
    await signIn(context.request);
    const page = await context.newPage();
    await page.goto("/");
    expect(await serviceWorkerScope(page)).toBe(`${baseURL}/`);

    const browser = await context.newCDPSession(page);
    const { installabilityErrors } = await browser.send("Page.getInstallabilityErrors");
    await context.close();

    expect(installabilityErrors).toEqual([]);
  });

  test("takes over from an installed copy of the old UI and drops its cache", async ({ page }) => {
    await serveOldWorker(page, true);
    await page.goto("/login");
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    expect(await cacheNames(page)).toContain(OLD_SHELL_CACHE);

    await serveOldWorker(page, false);
    await page.reload();
    await submitLoginForm(page);

    await expect(page.getByRole("heading", { level: 1, name: "Tauler" })).toBeVisible();
    await expect.poll(() => cacheNames(page)).not.toContain(OLD_SHELL_CACHE);
    await expect.poll(() => isControlled(page)).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Tauler" })).toBeVisible();
  });

  test("still ends at the login page once the session is gone", async ({ signedInPage: page }) => {
    await page.goto("/");
    await serviceWorkerScope(page);
    await page.reload();
    await expect(button(page, PAUSE)).toBeEnabled();

    await page.goto("/logout");
    await page.goto("/");

    await expect(page).toHaveURL("/login");
  });
});
