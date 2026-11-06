import { expect, setBackendEnv, test } from "./fixtures";

test("an app connects with a saved key, and Telegrarr registers in it", async ({ signedInPage: page }) => {
  await page.goto("/ui/connect");
  const sonarr = page.getByRole("group", { name: "Sonarr" });

  await sonarr.getByLabel("URL", { exact: true }).fill("http://sonarr.test");
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

  await radarr.getByLabel("URL", { exact: true }).fill("http://radarr.test");
  await radarr.getByLabel(/^Clau de l’API/).fill("wrong-key");
  await radarr.getByRole("button", { name: "Desa i prova" }).click();

  await expect(radarr.getByRole("alert")).toBeVisible();
  await expect(radarr.getByText("Error", { exact: true })).toBeVisible();
});

test("an app whose URL is set by an environment variable still saves its key and connects", async ({
  signedInPage: page,
}) => {
  await setBackendEnv(page.request, { TELEARR_SONARR_URL: "http://sonarr.test" });
  await page.goto("/ui/connect");
  const sonarr = page.getByRole("group", { name: "Sonarr" });
  const url = sonarr.getByLabel("URL", { exact: true });

  await expect(url).toHaveValue("http://sonarr.test");
  await expect(url).not.toBeEditable();
  await expect(sonarr.getByText("Definit per variable d’entorn")).toBeVisible();

  await sonarr.getByLabel(/^Clau de l’API/).fill("sonarr-secret-key");
  await sonarr.getByRole("button", { name: "Desa i prova" }).click();

  await expect(sonarr.getByText(/^Connectat · v4/)).toBeVisible();
  await expect(sonarr.getByText("Desat ••••")).toBeVisible();
});

test("an API key set by an environment variable is read-only", async ({ signedInPage: page }) => {
  await setBackendEnv(page.request, { TELEARR_RADARR_KEY: "from-the-environment" });
  await page.goto("/ui/connect");
  const radarr = page.getByRole("group", { name: "Radarr" });

  await expect(radarr.getByText("Definit per variable d’entorn")).toBeVisible();
  await expect(radarr.getByLabel(/^Clau de l’API/)).toHaveCount(0);
  await expect(radarr.getByRole("button", { name: /^Esborra|^Substitueix/ })).toHaveCount(0);
  await expect(page.getByText("from-the-environment")).toHaveCount(0);
});

test("an external URL is refused unless http, then saves and clears", async ({ signedInPage: page }) => {
  await page.goto("/ui/connect");
  const radarr = page.getByRole("group", { name: "Radarr" });
  const external = radarr.getByLabel("URL externa");
  const save = radarr.getByRole("button", { name: "Desa i prova" });

  await external.fill("ftp://radarr.example.com");
  await save.click();
  await expect(radarr.getByRole("alert")).toContainText("http://");

  await external.fill("https://radarr.example.com");
  await save.click();
  await expect(radarr.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(external).toHaveValue("https://radarr.example.com");

  await external.clear();
  await save.click();
  await expect(radarr.getByText(/Falta l’URL o la clau/)).toBeVisible();
  await page.reload();
  await expect(external).toHaveValue("");
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
