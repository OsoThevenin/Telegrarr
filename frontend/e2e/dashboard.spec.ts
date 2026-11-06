import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const SEEDED_CHAT_ID = -1001234567890;

const statusLine = (page: Page) => page.getByTestId("status-line");
const stat = (page: Page, name: RegExp) => page.getByRole("link", { name });

test("from first run to a live overview that leads to Downloads", async ({ signedInPage: page }) => {
  await page.goto("/ui/");
  await expect(page.getByRole("link", { name: "Afegeix un canal" })).toBeVisible();

  await page.request.post("/api/channels", { data: { chat_id: SEEDED_CHAT_ID } });

  await expect(stat(page, /1\s*Canals/)).toBeVisible();
  await expect(statusLine(page)).toContainText("Tot funciona");

  await page.request.post("/api/queue/pause");
  await expect(statusLine(page)).toContainText("Les baixades estan en pausa");

  await statusLine(page).getByRole("button", { name: "Reprèn les baixades" }).click();
  await expect(statusLine(page)).toContainText("Tot funciona");

  await page.getByRole("link", { name: "Ara mateix no s’està baixant res." }).click();
  await expect(page).toHaveURL("/ui/downloads");
});
