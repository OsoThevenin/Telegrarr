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

/** A card or queue line in En curs, or a history table row. */
const row = (page: Page, name: string) => page.locator("li, tr").filter({ hasText: name });
const button = (page: Page, name: string) => page.getByRole("button", { name });
const queueToggle = (page: Page) => page.getByRole("button", { name: /a la cua/ });

test("En curs sits above the tabs, which fit one line and mark the open one, on a phone", async ({
  signedInPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await addDownload(page, { file_name: RUNNING, file_size: 1_000_000_000, status: "downloading", progress: 0.2 });

  await page.goto("/downloads");
  await expect(row(page, RUNNING)).toBeVisible();

  const section = await page.getByRole("region", { name: "En curs" }).boundingBox();
  const tabs = await page.getByRole("tablist").boundingBox();
  const firstTab = await page.getByRole("tab", { name: /^Completades/ }).boundingBox();
  const lastTab = await page.getByRole("tab", { name: /^Cancel·lades/ }).boundingBox();
  expect(section!.y + section!.height).toBeLessThanOrEqual(tabs!.y);
  expect(Math.abs(lastTab!.y - firstTab!.y)).toBeLessThanOrEqual(1);
  expect(lastTab!.x + lastTab!.width).toBeLessThanOrEqual(390);

  const background = (name: RegExp) =>
    page.getByRole("tab", { name }).evaluate((tab) => getComputedStyle(tab).backgroundColor);
  expect(await background(/^Completades/)).not.toBe(await background(/^Fallides/));
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 760 },
]) {
  test(`Pause all sits at the right of En curs's Select all row, on ${viewport.name}`, async ({ signedInPage: page }) => {
    await page.setViewportSize(viewport);
    await addDownload(page, { file_name: RUNNING, file_size: 1_000_000_000, status: "downloading", progress: 0.2 });

    await page.goto("/downloads");
    await expect(row(page, RUNNING)).toBeVisible();

    const selectAll = await page.getByRole("checkbox", { name: "Selecciona-ho tot" }).boundingBox();
    const pauseAll = await button(page, "Posa-ho tot en pausa").boundingBox();
    const firstRow = await row(page, RUNNING).boundingBox();
    const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
    expect(Math.abs(middle(pauseAll!) - middle(selectAll!))).toBeLessThanOrEqual(4);
    expect(pauseAll!.x).toBeGreaterThan(selectAll!.x);
    expect(Math.abs(pauseAll!.x + pauseAll!.width - (firstRow!.x + firstRow!.width))).toBeLessThanOrEqual(2);
    expect(pauseAll!.y + pauseAll!.height).toBeLessThanOrEqual(firstRow!.y);
  });
}

test("the Downloads screen: filter, live progress, Stop, Retry and Pause all", async ({ signedInPage: page }) => {
  const running = await addDownload(page, {
    file_name: RUNNING,
    file_size: 2_000_000_000,
    status: "downloading",
    progress: 0.1,
    speed_mbs: 3.5,
  });
  await addDownload(page, { file_name: WAITING, file_size: 1_000_000_000, status: "queued" });

  await page.goto("/downloads");
  await expect(row(page, RUNNING)).toContainText("10%");
  await queueToggle(page).click();
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
  await expect(page.getByRole("table").getByRole("row").filter({ hasText: WAITING })).toBeVisible();

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
  const pausedBadge = (name: string) => row(page, name).getByText("En pausa", { exact: true });
  const selectBoth = async () => {
    for (const name of names) await page.getByRole("checkbox", { name: `Selecciona ${name}` }).check();
    await expect(page.getByText("2 seleccionades")).toBeVisible();
  };
  const bar = page.getByRole("group", { name: "Accions sobre les baixades seleccionades" });

  await page.goto("/downloads");
  await queueToggle(page).click();
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
  await expect(queueToggle(page)).toHaveAccessibleName("2 a la cua Mostra");
  expect(bulkRequests).toHaveLength(2);
});
