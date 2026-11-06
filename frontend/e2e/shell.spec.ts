import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const SCREENS = [
  ["Tauler", "/ui/"],
  ["Canals", "/ui/channels"],
  ["Baixades", "/ui/downloads"],
  ["Activitat", "/ui/activity"],
  ["Revisió", "/ui/review"],
  ["Connexió", "/ui/connect"],
  ["Sistema", "/ui/system"],
  ["Configuració", "/ui/settings"],
] as const;

const mainNavigation = (page: Page) => page.getByRole("navigation", { name: "Navegació principal" });
const screenHeading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

test.describe("signed in", () => {
  test("every screen is reachable from the sidebar, with no browser errors", async ({ signedInPage: page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/ui/");

    for (const [name, url] of SCREENS) {
      await mainNavigation(page).getByRole("link", { name }).click();
      await expect(screenHeading(page, name)).toBeVisible();
      await expect(page).toHaveURL(url);
    }
    expect(errors).toEqual([]);
  });

  test("a deep link opens its screen and survives a reload", async ({ signedInPage: page }) => {
    await page.goto("/ui/channels");
    await expect(screenHeading(page, "Canals")).toBeVisible();

    await page.reload();

    await expect(screenHeading(page, "Canals")).toBeVisible();
  });

  test("the language switch changes the shell and persists", async ({ signedInPage: page }) => {
    await page.goto("/ui/downloads");

    await page.getByRole("combobox", { name: "Idioma" }).selectOption("en");

    await expect(screenHeading(page, "Downloads")).toBeVisible();
    await expect(mainNavigation(page)).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();

    await page.reload();

    await expect(screenHeading(page, "Downloads")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("a 401 from the API ends at the login page", async ({ signedInPage: page }) => {
    await page.goto("/ui/");
    await expect(screenHeading(page, "Tauler")).toBeVisible();

    await page.context().clearCookies();
    await page.getByRole("combobox", { name: "Idioma" }).selectOption("en");

    await expect(page).toHaveURL("/login");
  });

  test("signing out ends the session", async ({ signedInPage: page }) => {
    await page.goto("/ui/");

    await page.getByRole("link", { name: "Tanca la sessió" }).click();
    await expect(page).toHaveURL("/login");

    await page.goto("/ui/");
    await expect(page).toHaveURL("/login");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("every screen is reachable from the drawer", async ({ signedInPage: page }) => {
      await page.goto("/ui/");
      await expect(mainNavigation(page)).toBeHidden();

      for (const [name, url] of SCREENS) {
        await page.getByRole("button", { name: "Obre el menú" }).click();
        const drawer = page.getByRole("dialog", { name: "Menú" });
        await drawer.getByRole("link", { name }).click();

        await expect(drawer).toBeHidden();
        await expect(screenHeading(page, name)).toBeVisible();
        await expect(page).toHaveURL(url);
      }
    });

    test("the page does not scroll sideways", async ({ signedInPage: page }) => {
      await page.goto("/ui/settings");
      await expect(screenHeading(page, "Configuració")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow).toBe(0);
    });
  });
});

test.describe("signed out", () => {
  for (const url of ["/ui/", "/ui/channels", "/ui/no-such-screen"]) {
    test(`${url} ends at the login page`, async ({ page }) => {
      await page.goto(url);

      await expect(page).toHaveURL("/login");
    });
  }
});
