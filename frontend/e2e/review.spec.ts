import { expect, test } from "./fixtures";

test("assigns one release, then bulk-discards the rest", async ({ signedInPage: page }) => {
  await page.goto("/ui/review");
  const pending = page.getByRole("list", { name: "Publicacions pendents" });
  const rows = pending.locator("> li");
  await expect(rows).toHaveCount(3);

  await page.getByRole("button", { name: /^Avatar\.2009/ }).click();
  await page.getByRole("button", { name: /^Avatar \(2009\)/ }).click();

  await expect(page.getByRole("status")).toContainText("S’ha ofert a Radarr");
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
