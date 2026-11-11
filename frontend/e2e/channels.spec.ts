import type { Page } from "@playwright/test";

import { expect, test, watchErrors } from "./fixtures";

const PHONE = { width: 390, height: 844 };

/** The button that opens a card: its name runs on past the title, into the card's meta line. */
const cardButton = (page: Page, title: string) =>
  page.getByRole("button", { name: new RegExp(`${title}\\s*\\S`) });
const grid = (page: Page) => page.getByRole("list", { name: "Canals" });

const openChannels = async (page: Page, path = "/channels") => {
  await page.goto(path);
  await expect(grid(page)).toBeVisible();
};

test.describe("channels", () => {
  test("browses, inspects, edits and removes a channel, by mouse and keyboard, with no browser errors", async ({
    signedInPage: page,
  }) => {
    const errors = watchErrors(page);

    await openChannels(page);
    await test.step("series and movies share one grid, in alphabetical order, each saying its kind", async () => {
      await expect(page.getByRole("tablist")).toHaveCount(0);
      await expect(grid(page).locator("article [title]")).toHaveText(["Cinema Club", "Sèries CAT"]);
      await expect(cardButton(page, "Cinema Club")).toContainText("Pel·lícula");
      await expect(cardButton(page, "Sèries CAT")).toContainText("Sèrie");
      await expect(page.getByRole("button", { name: /^Accions/ })).toHaveCount(0);
    });

    await test.step("hovering a card does not change its size", async () => {
      const card = page.getByRole("article").filter({ hasText: "Sèries CAT" });
      const before = await card.boundingBox();
      await card.hover();
      const after = await card.boundingBox();
      expect([after?.width, after?.height]).toEqual([before?.width, before?.height]);
    });

    await test.step("the Sheet of a series channel closes on Escape and gives focus back", async () => {
      await cardButton(page, "Sèries CAT").click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("heading", { name: "Sèries CAT" })).toBeVisible();
      await expect(sheet.getByText("Encara no hi ha cap baixada.")).toBeVisible();

      await page.keyboard.press("Escape");

      await expect(sheet).toBeHidden();
      await expect(cardButton(page, "Sèries CAT")).toBeFocused();
    });

    await test.step("the Sheet of a movie channel has room for its Catalog", async () => {
      await cardButton(page, "Cinema Club").click();
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Catàleg" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    });

    const sheet = page.getByRole("dialog", { name: /Cinema Club/ });
    const sheetButton = (name: string) => sheet.getByRole("button", { name, exact: true });

    await test.step("the Sheet edits by keyboard and gives focus back", async () => {
      await cardButton(page, "Cinema Club").focus();
      await page.keyboard.press("Enter");
      await sheetButton("Edita").focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Edita el canal" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Canal de Telegram");

      await dialog.getByLabel("Interval de consulta (minuts)").fill("60");
      await dialog.getByRole("button", { name: "Desa" }).click();

      await expect(dialog).toBeHidden();
      await expect(sheetButton("Edita")).toBeFocused();
      await expect(page.getByText("S’ha actualitzat el canal")).toBeVisible();
      await expect(sheet.getByText(/60 min/)).toBeVisible();
    });

    await test.step("disabling takes the Sheet, and the card shows it", async () => {
      await sheetButton("Desactiva").click();
      await expect(sheetButton("Activa")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("article").filter({ hasText: "Cinema Club" })).toContainText("Desactivat");
      await cardButton(page, "Cinema Club").click();
      await sheetButton("Activa").click();
      await expect(sheetButton("Desactiva")).toBeVisible();
    });

    await test.step("removing asks first, and sticks", async () => {
      await sheetButton("Elimina el canal").click();
      const confirm = page.getByRole("alertdialog");
      await confirm.getByRole("button", { name: "Cancel·la" }).click();
      await expect(confirm).toBeHidden();
      await expect(sheet).toBeVisible();

      await sheetButton("Elimina el canal").click();
      await confirm.getByRole("button", { name: "Elimina" }).click();

      await expect(confirm).toBeHidden();
      await expect(sheet).toBeHidden();
      await expect(cardButton(page, "Cinema Club")).toBeHidden();
      await page.reload();
      await expect(grid(page).getByRole("article")).toHaveCount(1);
    });

    expect(errors).toEqual([]);
  });

  test("stops and resumes scanning, and a stopped channel refuses a scan and says why", async ({
    signedInPage: page,
  }) => {
    const STOPPED = "Escaneig aturat";
    const card = page.getByRole("article").filter({ hasText: "Sèries CAT" });
    const sheet = page.getByRole("dialog");
    const scanning = sheet.getByRole("switch", { name: "Escaneig" });

    await openChannels(page);
    await expect(card.getByText(STOPPED)).toBeHidden();
    await cardButton(page, "Sèries CAT").click();
    await expect(scanning).toBeChecked();

    await scanning.click();

    await expect(sheet.getByText(STOPPED)).toBeVisible();
    await expect(scanning).not.toBeChecked();

    await sheet.getByRole("button", { name: "Escaneja" }).click();
    await expect(page.getByText(/^Sèries CAT: L’escaneig d’aquest canal està desactivat/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(card.getByText(STOPPED)).toBeVisible();

    await page.reload();
    await expect(card.getByText(STOPPED)).toBeVisible();

    await cardButton(page, "Sèries CAT").click();
    await expect(scanning).not.toBeChecked();

    await scanning.click();

    await expect(scanning).toBeChecked();
    await expect(sheet.getByText(STOPPED)).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(card.getByText(STOPPED)).toBeHidden();
  });

  test("an old link to the movies tab still opens every channel", async ({ signedInPage: page }) => {
    await openChannels(page, "/channels?tab=movies");

    await expect(cardButton(page, "Sèries CAT")).toBeVisible();
    await expect(cardButton(page, "Cinema Club")).toBeVisible();
  });

  test("a card shows the channel's Telegram photo", async ({ signedInPage: page }) => {
    await openChannels(page);

    const photo = page.getByRole("article").filter({ hasText: "Sèries CAT" }).locator("img");

    await expect(photo).toHaveAttribute("src", /^\/api\/channels\/\d+\/photo$/);
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });

  test("a phone reaches every action, with no sideways scroll", async ({ signedInPage: page }) => {
    await page.setViewportSize(PHONE);
    await openChannels(page);

    await expect(page.getByRole("button", { name: "Escaneja Sèries CAT" })).toBeVisible();
    const cards = await grid(page).getByRole("article").evaluateAll((articles) =>
      articles.map((article) => Math.round(article.getBoundingClientRect().top)),
    );
    expect(cards[0]).toBe(cards[1]);

    await cardButton(page, "Sèries CAT").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "Tanca" })).toBeVisible();
    for (const name of ["Escaneja", "Recupera l’historial", "Desactiva", "Edita", "Elimina el canal"]) {
      await expect(sheet.getByRole("button", { name, exact: true })).toBeVisible();
    }

    // Polled: while the sheet slides in, its width can round to a hair over the screen's.
    await expect.poll(async () => (await sheet.boundingBox())?.width).toBeLessThanOrEqual(PHONE.width);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
