import type { Page } from "@playwright/test";

import { expect, test, watchErrors } from "./fixtures";

const PHONE = { width: 390, height: 844 };

/** The button that opens a card: its name runs on past the title, into the card's meta line. */
const cardButton = (page: Page, title: string) =>
  page.getByRole("button", { name: new RegExp(`${title}\\s*\\S`) });
const menuButton = (page: Page, title: string) => page.getByRole("button", { name: `Accions de ${title}` });
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });

const openChannels = async (page: Page) => {
  await page.goto("/channels");
  await expect(page.getByRole("tablist")).toBeVisible();
};

test.describe("channels", () => {
  test("browses, inspects, edits and removes a channel, by mouse and keyboard, with no browser errors", async ({
    signedInPage: page,
  }) => {
    const errors = watchErrors(page);

    await openChannels(page);
    await expect(tab(page, /^Sèries\s*1$/)).toBeVisible();
    await expect(cardButton(page, "Sèries CAT")).toBeVisible();
    await expect(cardButton(page, "Cinema Club")).toBeHidden();

    await test.step("hovering a card does not change its size", async () => {
      const card = page.getByRole("article").filter({ hasText: "Sèries CAT" });
      const before = await card.boundingBox();
      await card.hover();
      expect(await card.boundingBox()).toEqual(before);
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

    await tab(page, /^Pel·lícules\s*1$/).click();

    await test.step("the Sheet of a movie channel has room for its Catalog", async () => {
      await cardButton(page, "Cinema Club").click();
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Catàleg" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    });

    await test.step("the menu edits by keyboard and gives focus back", async () => {
      await menuButton(page, "Cinema Club").focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Edita" }).focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Edita el canal" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Canal de Telegram");

      await dialog.getByLabel("Interval de consulta (minuts)").fill("60");
      await dialog.getByRole("button", { name: "Desa" }).click();

      await expect(dialog).toBeHidden();
      await expect(menuButton(page, "Cinema Club")).toBeFocused();
      await expect(page.getByText("S’ha actualitzat el canal")).toBeVisible();
      await expect(page.getByRole("article").filter({ hasText: "60 min" })).toBeVisible();
    });

    await test.step("removing asks first, and sticks", async () => {
      await menuButton(page, "Cinema Club").click();
      await page.getByRole("menuitem", { name: "Elimina" }).click();
      const confirm = page.getByRole("alertdialog");
      await confirm.getByRole("button", { name: "Cancel·la" }).click();
      await expect(confirm).toBeHidden();
      await expect(cardButton(page, "Cinema Club")).toBeVisible();

      await menuButton(page, "Cinema Club").click();
      await page.getByRole("menuitem", { name: "Elimina" }).click();
      await confirm.getByRole("button", { name: "Elimina" }).click();

      await expect(confirm).toBeHidden();
      await expect(cardButton(page, "Cinema Club")).toBeHidden();
      await page.reload();
      await expect(tab(page, /^Pel·lícules\s*0$/)).toBeVisible();
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
    await menuButton(page, "Sèries CAT").click();
    await expect(page.getByRole("menuitem", { name: "Elimina" })).toBeVisible();
    await page.keyboard.press("Escape");

    await cardButton(page, "Sèries CAT").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "Tanca" })).toBeVisible();

    // Polled: while the sheet slides in, its width can round to a hair over the screen's.
    await expect.poll(async () => (await sheet.boundingBox())?.width).toBeLessThanOrEqual(PHONE.width);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
