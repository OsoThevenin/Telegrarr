import { expect, test } from "./fixtures";

test("a backup can be made, then deleted after confirming", async ({ signedInPage: page }) => {
  const backupRows = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Baixa" }) });

  await page.goto("/system");
  await page.getByRole("tab", { name: "Còpia de seguretat" }).click();
  await expect(page.getByText("Encara no hi ha cap còpia de seguretat.")).toBeVisible();

  await page.getByRole("button", { name: "Fes una còpia ara" }).click();
  await expect(backupRows).toHaveCount(1);

  await backupRows.getByRole("button", { name: "Suprimeix la còpia" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Suprimeix" }).click();

  await expect(page.getByText("Encara no hi ha cap còpia de seguretat.")).toBeVisible();
  await expect(backupRows).toHaveCount(0);
});
