import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const PHONE = { width: 390, height: 844 };
const DIALOG_NAME = "Afegeix un canal";

const openChannels = async (page: Page) => {
  await page.goto("/channels");
  await expect(page.getByRole("tablist")).toBeVisible();
};

const openDialog = async (page: Page) => {
  await openChannels(page);
  await page.getByRole("button", { name: DIALOG_NAME }).click();
  return page.getByRole("dialog", { name: DIALOG_NAME });
};

const search = (dialog: Locator) => dialog.getByRole("combobox", { name: "Canal de Telegram" });
const save = (dialog: Locator) => dialog.getByRole("button", { name: "Desa" }).click();
const card = (page: Page, title: string) => page.getByRole("article").filter({ hasText: title });

const watchErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

test.describe("adding a channel", () => {
  test("picks a chat by keyboard and adds it, with no browser errors", async ({ signedInPage: page }) => {
    const errors = watchErrors(page);
    const dialog = await openDialog(page);

    await expect(dialog.getByRole("option", { name: /Merlí 1080p.*@merlicat · canal/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Amics del cinema.*grup/ })).toBeVisible();

    await expect(search(dialog)).toBeFocused();
    await page.keyboard.type("merl");
    await expect(dialog.getByRole("listbox").getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("option", { name: /Merlí 1080p/ })).toHaveAttribute("data-checked", "true");
    await save(dialog);

    await expect(dialog).toBeHidden();
    await expect(card(page, "Merlí 1080p")).toBeVisible();
    await expect(page.getByText("S’ha afegit el canal")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("resolves a pasted link, and says why when it cannot", async ({ signedInPage: page }) => {
    const dialog = await openDialog(page);

    await search(dialog).fill("@noexisteix");
    await dialog.getByRole("option", { name: /Resol/ }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();

    await search(dialog).fill("https://t.me/canalsecret");
    await dialog.getByRole("option", { name: /Resol/ }).click();
    await expect(page.getByText("S’ha trobat el canal", { exact: false })).toBeVisible();
    await save(dialog);

    await expect(dialog).toBeHidden();
    await expect(card(page, "Canal Secret")).toBeVisible();
  });

  test("adds a forum group's topics as sources with a kind each", async ({ signedInPage: page }) => {
    const dialog = await openDialog(page);

    await dialog.getByRole("option", { name: /Anime en català/ }).click();
    await dialog.getByRole("checkbox", { name: "Sèries HD" }).check();
    await dialog.getByRole("checkbox", { name: "Pel·lícules HD" }).check();
    await dialog.getByLabel("Tipus per a Pel·lícules HD").selectOption("movie");
    await save(dialog);

    await expect(dialog).toBeHidden();
    await expect(page.getByText("S’han afegit 2 canals de tema")).toBeVisible();
    await expect(card(page, "Sèries HD")).toBeVisible();
    await page.getByRole("tab", { name: /^Pel·lícules/ }).click();
    await expect(card(page, "Pel·lícules HD")).toBeVisible();
  });

  test("maps the new channel to the series TMDB finds for it", async ({ signedInPage: page }) => {
    const errors = watchErrors(page);
    const dialog = await openDialog(page);

    await dialog.getByRole("option", { name: /Merlí 1080p/ }).click();
    await dialog.getByRole("button", { name: /^Merlí \(2015\)/ }).click();
    await expect(dialog.getByText("(TMDB 1001)")).toBeVisible();
    await save(dialog);

    await expect(dialog).toBeHidden();
    await expect(card(page, "Merlí (2015)")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the palette opens the form ready to search, and it closes cleanly", async ({ signedInPage: page }) => {
    await page.goto("/downloads");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type(DIALOG_NAME);
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: DIALOG_NAME });
    await expect(search(dialog)).toBeFocused();
    await page.keyboard.type("merl");
    await expect(dialog.getByRole("listbox").getByRole("option")).toHaveCount(1);

    await dialog.getByRole("button", { name: "Cancel·la" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
    await expect(page.getByRole("tablist")).toBeVisible();
  });

  test("the form fits a phone without sideways scrolling", async ({ signedInPage: page }) => {
    await page.setViewportSize(PHONE);
    const dialog = await openDialog(page);
    await dialog.getByRole("option", { name: /Anime en català/ }).click();
    await expect(dialog.getByRole("checkbox", { name: "Sèries HD" })).toBeVisible();

    const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBe(0);
    expect(pageOverflow).toBe(0);
  });
});
