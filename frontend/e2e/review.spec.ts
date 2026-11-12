import { expect, test } from "./fixtures";

test("assigns one release, then bulk-discards the rest", async ({ signedInPage: page }) => {
  await page.goto("/review");
  const pending = page.getByRole("list", { name: "Publicacions pendents" });
  const rows = pending.locator("> li");
  await expect(rows).toHaveCount(3);

  await page.getByRole("button", { name: /^Avatar\.2009/ }).click();
  const hit = page.getByRole("button", { name: /^Avatar \(2009\)/ });
  await expect(page.getByRole("link", { name: /Avatar \(2009\).*TMDB/ })).toHaveAttribute(
    "href",
    "https://www.themoviedb.org/movie/19995",
  );
  await hit.click();
  await expect(hit).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: /Avatar \(2009\).*IMDb/ })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: /^Assigna Avatar \(2009\)/ }).click();

  await expect(page.getByText("S’ha ofert a Radarr")).toBeVisible();
  await expect(rows).toHaveCount(2);

  await page.getByRole("checkbox", { name: "Selecciona totes les visibles" }).click();
  await page.getByRole("button", { name: "Descarta les seleccionades" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Vols descartar 2 publicacions?");
  await dialog.getByRole("button", { name: "Descarta" }).click();

  await expect(page.getByText("No hi ha res per revisar")).toBeVisible();
  await page.reload();
  await expect(page.getByText("No hi ha res per revisar")).toBeVisible();
});
