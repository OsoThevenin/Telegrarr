import { expect, test } from "./fixtures";

test("an app connects with a saved key, and Telegrarr registers in it", async ({ signedInPage: page }) => {
  await page.goto("/ui/connect");
  const sonarr = page.getByRole("group", { name: "Sonarr" });

  await sonarr.getByLabel(/^URL/).fill("http://sonarr.test");
  await sonarr.getByLabel(/^Clau de l’API/).fill("sonarr-secret-key");
  await sonarr.getByRole("button", { name: "Desa i prova" }).click();

  await expect(sonarr.getByText(/^Connectat · v4/)).toBeVisible();
  await expect(sonarr.getByText("Desat ••••")).toBeVisible();

  await page.reload();
  await expect(sonarr.getByText(/^Connectat · v4/)).toBeVisible();
  await expect(sonarr.getByText("Desat ••••")).toBeVisible();

  await page.getByLabel(/^URL de Telegrarr/).fill("http://telegrarr.test:8790");
  await page.getByRole("button", { name: "Registra Telegrarr" }).click();

  await expect(page.getByText("Registrat a 1 aplicació")).toBeVisible();
  await expect(page.getByText(/Sonarr · client de baixades: creat/)).toBeVisible();
});

test("a wrong key says so on the app's own card", async ({ signedInPage: page }) => {
  await page.goto("/ui/connect");
  const radarr = page.getByRole("group", { name: "Radarr" });

  await radarr.getByLabel(/^URL/).fill("http://radarr.test");
  await radarr.getByLabel(/^Clau de l’API/).fill("wrong-key");
  await radarr.getByRole("button", { name: "Desa i prova" }).click();

  await expect(radarr.getByRole("alert")).toBeVisible();
  await expect(radarr.getByText("Error", { exact: true })).toBeVisible();
});

test("fits a phone without sideways scrolling", async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/ui/connect");
  await expect(page.getByRole("group", { name: "Sonarr" })).toBeVisible();

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(hasOverflow).toBe(false);
});
