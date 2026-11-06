import { expect, test } from "./fixtures";

const PAUSED = "Descàrregues en pausa";
const RESUMED = "Descàrregues represes";

test("the log can be searched and filtered, and picks up new entries on refresh", async ({ signedInPage: page }) => {
  await page.request.post("/api/queue/pause");
  await page.goto("/ui/activity");
  await expect(page.getByText(PAUSED)).toBeVisible();

  await page.request.post("/api/queue/resume");
  await page.getByRole("button", { name: "Actualitza" }).click();
  await expect(page.getByText(RESUMED)).toBeVisible();

  await page.getByRole("searchbox", { name: "Cerca al registre…" }).fill("represes");
  await expect(page.getByText(RESUMED)).toBeVisible();
  await expect(page.getByText(PAUSED)).toBeHidden();

  await page.getByRole("combobox", { name: "Nivell" }).click();
  await page.getByRole("option", { name: "Avisos" }).click();
  await expect(page.getByText("Cap entrada del registre coincident.")).toBeVisible();
});
