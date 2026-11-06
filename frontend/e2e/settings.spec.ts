import type { Page } from "@playwright/test";

import { expect, setBackendEnv, test } from "./fixtures";

const panel = (page: Page) => page.getByRole("tabpanel");

async function openTab(page: Page, name: string) {
  await page.goto("/ui/settings");
  await page.getByRole("tab", { name }).click();
}

test("fits a phone without sideways scrolling, with its tabs above the content", async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openTab(page, "Integracions");
  await expect(panel(page).getByText("Imatges (TMDB)")).toBeVisible();

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  const tabs = await page.getByRole("tablist").boundingBox();
  const content = await panel(page).boundingBox();

  expect(hasOverflow).toBe(false);
  expect(tabs!.y + tabs!.height).toBeLessThanOrEqual(content!.y);
});

test("a secret shows as saved, can be cleared, and never comes back", async ({ signedInPage: page }) => {
  await openTab(page, "Integracions");
  const tmdb = page.locator('[data-slot="card"]', { hasText: "Imatges (TMDB)" });
  await expect(tmdb.getByText("Desat ••••")).toBeVisible();

  await tmdb.getByRole("button", { name: /^Esborra/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Esborra/ }).click();
  await expect(tmdb.getByText("Desat ••••")).toHaveCount(0);

  await tmdb.getByLabel("Clau de l’API").fill("tmdb-e2e-key");
  await tmdb.getByRole("button", { name: "Desa i prova" }).click();
  await expect(tmdb.getByText("Desat ••••")).toBeVisible();

  await openTab(page, "Integracions");
  await expect(tmdb.getByText("Desat ••••")).toBeVisible();
  await expect(page.getByText("tmdb-e2e-key")).toHaveCount(0);
});

test("values set by environment variables are read-only, and the rest of the card still saves", async ({
  signedInPage: page,
}) => {
  await setBackendEnv(page.request, {
    TELEARR_TMDB_KEY: "tmdb-from-the-environment",
    PLEX_URL: "http://plex.env.test:32400",
    TELEARR_PROXY: "socks5://user:hunter2@proxy.env.test:1080",
  });
  await openTab(page, "Integracions");

  const tmdb = page.locator('[data-slot="card"]', { hasText: "Imatges (TMDB)" });
  await expect(tmdb.getByText("Definit per variable d’entorn")).toBeVisible();
  await expect(tmdb.getByRole("button", { name: /^Esborra|^Substitueix/ })).toHaveCount(0);

  const telegram = page.locator('[data-slot="card"]', { hasText: "Compte de Telegram" });
  await expect(telegram.getByText("socks5://proxy.env.test:1080")).toBeVisible();
  await expect(telegram.getByRole("button", { name: "Connecta", exact: true })).toHaveCount(0);
  await expect(page.getByText("hunter2")).toHaveCount(0);

  const plex = page.locator('[data-slot="card"]', { hasText: "Plex" }).last();
  await expect(plex.getByLabel("URL del servidor")).not.toBeEditable();
  await plex.getByLabel("Testimoni").fill("plex-e2e-token");
  await plex.getByRole("button", { name: "Desa i prova" }).click();
  await expect(plex.getByText("Desat ••••")).toBeVisible();
});

test("autonomous mode only changes once its dialog is confirmed", async ({ signedInPage: page }) => {
  await openTab(page, "Baixades");
  const toggle = panel(page).getByRole("switch", { name: "Mode autònom" });

  await toggle.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Sonarr i Radarr deixaran de decidir");
  await dialog.getByRole("button", { name: "Cancel·la" }).click();
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await dialog.getByRole("button", { name: "Activa" }).click();
  await expect(toggle).toBeChecked();

  await page.reload();
  await page.getByRole("tab", { name: "Baixades" }).click();
  await expect(toggle).toBeChecked();
});

test("a wrong password keeps the username dialog open with the reason", async ({ signedInPage: page }) => {
  await page.goto("/ui/settings");

  await page.getByRole("button", { name: "Canvia el nom d’usuari" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Nom d’usuari/).fill("someone-else");
  await dialog.getByLabel(/^Confirma la contrasenya/).fill("not-the-password");
  await dialog.getByRole("button", { name: "Desa" }).click();

  await expect(dialog.getByRole("alert")).toHaveText(/La contrasenya actual no és correcta/);
});
