import type { Locator, Page } from "@playwright/test";

import { expect, test, watchErrors } from "./fixtures";

const PHONE = { width: 390, height: 844 };
const SHORT_LAPTOP = { width: 1280, height: 720 };
const LONG_TITLE = "Sèries en català HD — estrenes, clàssics i temporades completes de TV3, 3Cat i SX3";
/** A real account: many chats, some with names wider than the dialog. */
const MANY_CHATS = Array.from({ length: 20 }, (_, index) => ({
  chat_id: -1009000 - index,
  title: index === 0 ? LONG_TITLE : `Canal ${index}`,
  username: index === 0 ? "un_nom_d_usuari_molt_llarg_que_no_cap_a_la_fila" : "",
  kind: "channel",
  members: 10,
}));
const DIALOG_NAME = "Afegeix un canal";

const openChannels = async (page: Page) => {
  await page.goto("/channels");
  await expect(page.getByRole("list", { name: "Canals" })).toBeVisible();
};

const openDialog = async (page: Page) => {
  await openChannels(page);
  await page.getByRole("button", { name: DIALOG_NAME }).click();
  return page.getByRole("dialog", { name: DIALOG_NAME });
};

const search = (dialog: Locator) => dialog.getByRole("combobox", { name: "Canal de Telegram" });
const save = (dialog: Locator) => dialog.getByRole("button", { name: "Desa" }).click();
const card = (page: Page, title: string) => page.getByRole("article").filter({ hasText: title });

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
    await expect(card(page, "Sèries HD")).toContainText("Sèrie");
    await expect(card(page, "Pel·lícules HD")).toContainText("Pel·lícula");
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
    await expect(page.getByRole("heading", { level: 1, name: "Baixades" })).toBeVisible();
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
    await expect(page.getByRole("list", { name: "Canals" })).toBeVisible();
  });

  test("keeps its actions and its X in view on a short screen full of chats", async ({ signedInPage: page }) => {
    await page.setViewportSize(SHORT_LAPTOP);
    await page.route("**/api/telegram/dialogs**", (route) => route.fulfill({ json: MANY_CHATS }));
    const dialog = await openDialog(page);
    await expect(dialog.getByRole("option", { name: new RegExp(LONG_TITLE.slice(0, 20)) })).toBeVisible();

    await expect(dialog.getByRole("button", { name: "Desa" })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: "Cancel·la" })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: "Tanca" })).toBeInViewport({ ratio: 1 });
    const overflow = await dialog.evaluate((element) => {
      const body = element.querySelector("[data-slot=dialog-body]") as HTMLElement;
      return [element.scrollWidth - element.clientWidth, body.scrollWidth - body.clientWidth];
    });
    expect(overflow).toEqual([0, 0]);

    await dialog.getByRole("button", { name: "Tanca" }).click();
    await expect(dialog).toBeHidden();
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
