import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const PHONE = { width: 390, height: 844 };

/** The fake Radarr of tests/e2e_server.py; the seed leaves it unconfigured for other screens. */
const connectRadarr = async (page: Page) => {
  const response = await page.request.patch("/api/settings", {
    data: { radarr_url: "http://radarr.test", radarr_key: "radarr-secret-key" },
  });
  expect(response.ok()).toBe(true);
};

const openCatalog = async (page: Page) => {
  await page.goto("/channels");
  await page.getByRole("tab", { name: /^Pel·lícules/ }).click();
  await page.getByRole("button", { name: /Cinema Club\s*\S/ }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Catàleg" })).toBeVisible();
  await expect(sheet.getByText("Radarr connectat")).toBeVisible();
  return sheet;
};

test.describe("Catalog", () => {
  test("searches, pages, expands and downloads a film, with no browser errors", async ({ signedInPage: page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await connectRadarr(page);

    const sheet = await openCatalog(page);
    const search = sheet.getByRole("searchbox", { name: "Cerca per títol" });
    const paNegre = sheet.getByRole("button", { name: /^Pa negre 2010/ });

    await test.step("pages come from the server, 25 at a time", async () => {
      await expect(sheet.getByText("Mostrant 1–25 de 30")).toBeVisible();
      await expect(sheet.getByRole("listitem").filter({ hasText: "Pel·lícula" })).toHaveCount(24);

      await sheet.getByRole("link", { name: "Pàgina 2" }).click();

      await expect(sheet.getByText("Mostrant 26–30 de 30")).toBeVisible();
      await expect(sheet.getByRole("button", { name: /^Pel·lícula 01/ })).toBeVisible();
      await expect(sheet.getByRole("link", { name: "Revisa Els.Pirates.CAT.mkv" })).toBeVisible();
    });

    await test.step("a search narrows the list and goes back to page 1", async () => {
      await search.fill("pa negre");

      await expect(sheet.getByText("1 resultat")).toBeVisible();
      await expect(paNegre).toBeVisible();
      await expect(sheet.getByRole("navigation")).toBeHidden();
    });

    await test.step("the row expands from the keyboard", async () => {
      await paNegre.focus();
      await page.keyboard.press("Enter");

      await expect(sheet.getByText("tt9027")).toBeVisible();

      await page.keyboard.press("Enter");

      await expect(sheet.getByText("tt9027")).toBeHidden();
    });

    await test.step("Download marks the film Requested, and it stays so", async () => {
      await sheet.getByRole("button", { name: "Baixar Pa negre" }).click();

      await expect(sheet.getByRole("button", { name: "Sol·licitada" })).toBeDisabled();
      await expect(sheet.getByRole("button", { name: /^Per baixar\s*26$/ })).toBeVisible();

      const reopened = await openCatalog(page);
      await reopened.getByRole("searchbox").fill("pa negre");

      await expect(reopened.getByRole("button", { name: "Sol·licitada" })).toBeDisabled();
    });

    expect(errors).toEqual([]);
  });

  test("says Radarr is missing, and still lists the Catalog", async ({ signedInPage: page }) => {
    await page.goto("/channels");
    await page.getByRole("tab", { name: /^Pel·lícules/ }).click();
    await page.getByRole("button", { name: /Cinema Club\s*\S/ }).click();
    const sheet = page.getByRole("dialog");

    await expect(sheet.getByText("Radarr no connectat")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Baixar Pa negre" })).toBeDisabled();
  });

  test("says why Radarr hasn't grabbed a film, on a phone", async ({ signedInPage: page }) => {
    await page.setViewportSize(PHONE);
    await connectRadarr(page);

    const sheet = await openCatalog(page);
    await sheet.getByRole("searchbox", { name: "Cerca per títol" }).fill("pa negre");
    await sheet.getByRole("button", { name: "Baixar Pa negre" }).click();
    await expect(sheet.getByRole("button", { name: "Sol·licitada" })).toBeVisible();
    await sheet.getByRole("button", { name: /^Pa negre 2010/ }).click();

    await sheet.getByRole("button", { name: "Per què no s’ha agafat?" }).click();

    await expect(sheet.getByText("Radarr ha rebutjat les versions del canal d’aquesta pel·lícula.")).toBeVisible();
    await expect(sheet.getByText("Quality profile does not allow 1080p")).toBeVisible();

    const link = sheet.getByRole("link", { name: "Obre Pa negre a Radarr" });
    await expect(link).toHaveAttribute("href", "http://radarr.test/movie/9027");
    await expect(link).toHaveAttribute("target", "_blank");

    const { scrollWidth, clientWidth } = await sheet.evaluate(({ scrollWidth, clientWidth }) => ({
      scrollWidth,
      clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("fits a phone", async ({ signedInPage: page }) => {
    await page.setViewportSize(PHONE);
    await connectRadarr(page);

    const sheet = await openCatalog(page);
    await sheet.getByRole("button", { name: /^Pa negre 2010/ }).click();
    await expect(sheet.getByText("tt9027")).toBeVisible();

    const { scrollWidth, clientWidth } = await sheet.evaluate(({ scrollWidth, clientWidth }) => ({
      scrollWidth,
      clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
