import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const RUNNING = "Merli.S01E01.mkv";
const WAITING = "Plats.bruts.S01E01.mkv";

async function addDownload(page: Page, fields: Record<string, string | number>): Promise<number> {
  const response = await page.request.post("/__e2e__/downloads", { data: fields });
  expect(response.ok()).toBe(true);
  return (await response.json()).id;
}

async function reportProgress(page: Page, id: number, progress: number) {
  const response = await page.request.post(`/__e2e__/downloads/${id}/progress?progress=${progress}`);
  expect(response.ok()).toBe(true);
}

const row = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });
const button = (page: Page, name: string) => page.getByRole("button", { name });

test("the tabs sit above the list and mark the open one, on a phone too", async ({ signedInPage: page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await addDownload(page, { file_name: WAITING, file_size: 1_000_000_000, status: "queued" });

  await page.goto("/ui/downloads");
  await expect(row(page, WAITING)).toBeVisible();

  const tabs = await page.getByRole("tablist").boundingBox();
  const lastTab = await page.getByRole("tab", { name: /^Cancel·lades/ }).boundingBox();
  const firstRow = await row(page, WAITING).boundingBox();
  expect(lastTab!.y + lastTab!.height).toBeLessThanOrEqual(tabs!.y + tabs!.height);
  expect(tabs!.y + tabs!.height).toBeLessThanOrEqual(firstRow!.y);

  const background = (name: RegExp) =>
    page.getByRole("tab", { name }).evaluate((tab) => getComputedStyle(tab).backgroundColor);
  expect(await background(/^A la cua/)).not.toBe(await background(/^Completades/));
});

test("the Downloads screen: filter, live progress, Stop, Retry and Pause all", async ({ signedInPage: page }) => {
  const running = await addDownload(page, {
    file_name: RUNNING,
    file_size: 2_000_000_000,
    status: "downloading",
    progress: 0.1,
    speed_mbs: 3.5,
  });
  await addDownload(page, { file_name: WAITING, file_size: 1_000_000_000, status: "queued" });

  await page.goto("/ui/downloads");
  await expect(row(page, RUNNING)).toContainText("10%");
  await expect(row(page, WAITING)).toBeVisible();

  const filter = page.getByRole("searchbox", { name: "Filtra…" });
  await filter.fill("plats");
  await expect(row(page, WAITING)).toBeVisible();
  await expect(row(page, RUNNING)).toBeHidden();
  await filter.clear();

  await reportProgress(page, running, 0.6);
  await expect(row(page, RUNNING)).toContainText("60%");

  await row(page, WAITING).getByRole("button", { name: "Atura" }).click();
  await page.getByRole("tab", { name: "Cancel·lades 1" }).click();

  // The fake Telegram has no such message, so the server refuses with its reason.
  await row(page, WAITING).getByRole("button", { name: "Torna-ho a provar" }).click();
  await expect(page.getByText("El missatge de Telegram ja no existeix")).toBeVisible();

  // Last: resuming re-drives the seeded rows, which have no transfer behind them.
  await button(page, "Posa-ho tot en pausa").click();
  await expect(button(page, "Reprèn-ho tot")).toBeEnabled();
  await expect(button(page, "Reprèn les baixades")).toBeEnabled();
  await button(page, "Reprèn-ho tot").click();
  await expect(button(page, "Posa-ho tot en pausa")).toBeEnabled();
});

test("the bulk bar pauses and resumes rows in one request, and Resume all leaves them paused", async ({
  signedInPage: page,
}) => {
  const names = [RUNNING, WAITING];
  for (const file_name of names) {
    const id = await addDownload(page, {
      file_name,
      file_size: 1_000_000_000,
      status: "queued",
      save_path: `/media/tv/${file_name}`,
    });
    const response = await page.request.post(`/__e2e__/downloads/${id}/message`);
    expect(response.ok()).toBe(true);
  }
  const bulkRequests: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/downloads/bulk")) bulkRequests.push(request.postDataJSON());
  });
  const pausedBadge = (name: string) => row(page, name).getByText("en pausa", { exact: true });
  const selectBoth = async () => {
    for (const name of names) await page.getByRole("checkbox", { name: `Selecciona ${name}` }).check();
    await expect(page.getByText("2 seleccionades")).toBeVisible();
  };
  const bar = page.getByRole("group", { name: "Accions sobre les baixades seleccionades" });

  await page.goto("/ui/downloads");
  await selectBoth();
  await bar.getByRole("button", { name: "Pausa" }).click();

  await expect(pausedBadge(RUNNING)).toBeVisible();
  await expect(pausedBadge(WAITING)).toBeVisible();
  expect(bulkRequests).toHaveLength(1);

  await button(page, "Posa-ho tot en pausa").click();
  await button(page, "Reprèn-ho tot").click();
  await expect(button(page, "Posa-ho tot en pausa")).toBeEnabled();
  await page.reload();
  await expect(pausedBadge(RUNNING)).toBeVisible();
  await expect(pausedBadge(WAITING)).toBeVisible();

  // Under the global pause the resumed rows wait in the queue, with no transfer behind them.
  await button(page, "Posa-ho tot en pausa").click();
  await expect(button(page, "Reprèn-ho tot")).toBeEnabled();
  await selectBoth();
  await bar.getByRole("button", { name: "Reprèn" }).click();

  await expect(pausedBadge(RUNNING)).toBeHidden();
  await expect(pausedBadge(WAITING)).toBeHidden();
  await expect(row(page, RUNNING)).toBeVisible();
  expect(bulkRequests).toHaveLength(2);
});
