import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const statusLine = (page: Page) => page.getByTestId("status-line");

test("the overview follows the queue live and leads to Downloads", async ({ signedInPage: page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /2\s*Canals/ })).toBeVisible();
  await expect(statusLine(page)).toContainText("Tot funciona");

  await page.request.post("/api/queue/pause");
  await expect(statusLine(page)).toContainText("Les baixades estan en pausa");

  await statusLine(page).getByRole("button", { name: "Reprèn les baixades" }).click();
  await expect(statusLine(page)).toContainText("Tot funciona");

  await page.getByRole("link", { name: "Ara mateix no s’està baixant res." }).click();
  await expect(page).toHaveURL("/downloads");
});
