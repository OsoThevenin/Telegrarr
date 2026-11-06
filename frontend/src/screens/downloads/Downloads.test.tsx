import { screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { Download } from "@/lib/downloads";
import { emitSnapshot } from "@/test/event-stream";
import { renderApp } from "@/test/render";
import { server, STATUS } from "@/test/server";

const ROUTE = "/downloads";

function download(fields: Partial<Download> = {}): Download {
  return {
    id: 1,
    channel_id: 1,
    file_name: "Merli.S01E01.mkv",
    file_size: 2_000_000_000,
    save_path: null,
    status: "queued",
    progress: 0,
    speed_mbs: 0,
    channel_title: "Cinema Club",
    topic_title: null,
    created_at: 1_000,
    finished_at: null,
    ...fields,
  };
}

function serveDownloads(rows: readonly Download[]) {
  server.use(http.get("/api/downloads", () => HttpResponse.json(rows)));
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest("li") as HTMLElement;

const TABS = [
  { label: "A la cua / Actives", status: "queued", empty: "No hi ha res a la cua ni baixant." },
  { label: "Completades", status: "completed", empty: "Encara no s’ha baixat res." },
  { label: "Fallides", status: "failed", empty: "No hi ha res." },
  { label: "Cancel·lades", status: "cancelled", empty: "No hi ha res." },
] as const;

const tab = (label: string) => screen.findByRole("tab", { name: new RegExp(`^${label}`) });

type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function openTab(user: User, label: string) {
  await user.click(await tab(label));
}

const visibleNames = () =>
  screen.getAllByRole("listitem").flatMap((row) => row.querySelector("p")?.textContent ?? []);

const filterBox = () => screen.findByRole("searchbox", { name: "Filtra…" });

beforeEach(() => localStorage.clear());

describe("Downloads, Queued / Active tab", () => {
  it("shows a running transfer with its progress, speed and channel", async () => {
    serveDownloads([download({ status: "downloading", progress: 0.42, speed_mbs: 3.5 })]);

    await renderApp({ route: ROUTE });

    const row = within(await rowOf("Merli.S01E01.mkv"));
    expect(row.getByText(/42%/)).toBeVisible();
    expect(row.getByText(/3\.5 MB\/s/)).toBeVisible();
    expect(row.getByText(/Cinema Club/)).toBeVisible();
    expect(row.getByText(/2\.00 GB/)).toBeVisible();
    expect(row.getByText("baixant")).toBeVisible();
    expect(row.getByRole("progressbar", { name: "Merli.S01E01.mkv" })).toBeVisible();
  });

  it("follows progress from the live stream, with no reload", async () => {
    const row = download({ status: "downloading", progress: 0.1 });
    serveDownloads([row]);
    await renderApp({ route: ROUTE });
    await screen.findByText(/10%/);

    emitSnapshot({ active: [{ ...row, progress: 0.75 }] });

    expect(await screen.findByText(/75%/)).toBeVisible();
  });

  it("puts what is running first and keeps rows paused on their own in view", async () => {
    serveDownloads([
      download({ id: 3, status: "paused", file_name: "held.mkv" }),
      download({ id: 2, status: "queued", file_name: "waiting.mkv" }),
      download({ id: 1, status: "downloading", file_name: "running.mkv" }),
    ]);

    await renderApp({ route: ROUTE });

    await screen.findByText("running.mkv");
    expect(visibleNames()).toEqual(["running.mkv", "waiting.mkv", "held.mkv"]);
    expect(await tab("A la cua / Actives")).toHaveAccessibleName("A la cua / Actives 3");
  });
});

describe.each(TABS)("Downloads, $label tab", ({ label, status, empty }) => {
  it("says it is loading", async () => {
    server.use(
      http.get("/api/downloads", async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    );
    const { user } = await renderApp({ route: ROUTE });

    await openTab(user, label);

    expect(await screen.findByRole("status", { name: "S’està carregant…" })).toBeVisible();
  });

  it("says when there is nothing in it", async () => {
    serveDownloads([]);
    const { user } = await renderApp({ route: ROUTE });

    await openTab(user, label);

    expect(await screen.findByText(empty)).toBeVisible();
  });

  it("says why the list failed, and fetches it again on request", async () => {
    server.use(
      http.get("/api/downloads", () =>
        HttpResponse.json({ detail: { key: "err.settings.budget" } }, { status: 500 }),
      ),
    );
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, label);

    expect(await screen.findByRole("alert")).toHaveTextContent("El pressupost diari ha de ser 0");

    serveDownloads([download({ status })]);
    await user.click(screen.getByRole("button", { name: "Actualitza" }));

    expect(await screen.findByText(/Cinema Club/)).toBeVisible();
    expect(await tab(label)).toHaveAccessibleName(`${label} 1`);
  });

  it("shows only its own rows, and counts them", async () => {
    serveDownloads(TABS.map((other, index) => download({ id: index, status: other.status, file_name: other.status })));
    const { user } = await renderApp({ route: ROUTE });

    await openTab(user, label);

    expect(await tab(label)).toHaveAccessibleName(`${label} 1`);
    expect(await screen.findByText(new RegExp(status === "completed" ? "Cinema Club" : `^${status}$`))).toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(1);
  });

  it("narrows to what the filter matches", async () => {
    serveDownloads([
      download({ id: 1, status, file_name: "Merli.mkv" }),
      download({ id: 2, status, file_name: "Plats.bruts.mkv" }),
    ]);
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, label);

    await user.type(await filterBox(), "plats");

    expect(await screen.findByText("Plats.bruts.mkv")).toBeVisible();
    expect(screen.queryByText("Merli.mkv")).not.toBeInTheDocument();
    expect(await tab(label)).toHaveAccessibleName(`${label} 1`);
  });

  it("says when the filter matches nothing", async () => {
    serveDownloads([download({ status })]);
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, label);

    await user.type(await filterBox(), "nothing like this");

    expect(await screen.findByText("Cap coincidència.")).toBeVisible();
  });
});

describe("Downloads tab in the URL", () => {
  it("opens the tab a link names", async () => {
    serveDownloads([download({ status: "failed" })]);
    await renderApp({ route: "/downloads?tab=failed" });

    expect(await tab("Fallides")).toHaveAttribute("aria-selected", "true");
  });

  it("opens on the Active tab for a tab that does not exist", async () => {
    serveDownloads([]);
    await renderApp({ route: "/downloads?tab=nonsense" });

    expect(await tab("A la cua / Actives")).toHaveAttribute("aria-selected", "true");
  });

  it("remembers the chosen tab in the URL", async () => {
    serveDownloads([]);
    const { router, user } = await renderApp({ route: "/downloads" });

    await openTab(user, "Completades");

    expect(await tab("Completades")).toHaveAttribute("aria-selected", "true");
    expect(router.history.location.search).toBe("?tab=completed");
  });
});

describe("Downloads filters", () => {
  it("sit above the tabs and the lists", async () => {
    serveDownloads([download()]);
    await renderApp({ route: ROUTE });

    const filter = await filterBox();
    const tabs = await screen.findByRole("tablist");
    await screen.findByText("Merli.S01E01.mkv");

    expect(filter.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("match the channel as well as the file, whatever the case", async () => {
    serveDownloads([
      download({ id: 1, file_name: "one.mkv", channel_title: "Cinema Club", topic_title: "Clàssics" }),
      download({ id: 2, file_name: "two.mkv", channel_title: "Sèries" }),
    ]);
    const { user } = await renderApp({ route: ROUTE });

    await user.type(await filterBox(), "CLÀSSICS");

    expect(await screen.findByText("one.mkv")).toBeVisible();
    expect(screen.queryByText("two.mkv")).not.toBeInTheDocument();
  });

  it("carry over from tab to tab", async () => {
    serveDownloads([
      download({ id: 1, status: "failed", file_name: "Merli.mkv" }),
      download({ id: 2, status: "failed", file_name: "Plats.bruts.mkv" }),
    ]);
    const { user } = await renderApp({ route: ROUTE });
    await user.type(await filterBox(), "merli");

    await openTab(user, "Fallides");

    expect(await screen.findByText("Merli.mkv")).toBeVisible();
    expect(screen.queryByText("Plats.bruts.mkv")).not.toBeInTheDocument();
  });

  it("sort the list and remember the order", async () => {
    serveDownloads([
      download({ id: 1, status: "failed", file_name: "small.mkv", file_size: 1 }),
      download({ id: 2, status: "failed", file_name: "large.mkv", file_size: 9 }),
    ]);
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, "Fallides");

    await user.selectOptions(await screen.findByRole("combobox", { name: "Ordena" }), "Més grans");

    await screen.findByText("large.mkv");
    expect(visibleNames()).toEqual(["large.mkv", "small.mkv"]);
    expect(localStorage.getItem("dl_sort")).toBe("big");
  });

  it("start from the order chosen before", async () => {
    localStorage.setItem("dl_sort", "name");
    serveDownloads([]);

    await renderApp({ route: ROUTE });

    expect(await screen.findByRole("combobox", { name: "Ordena" })).toHaveValue("name");
  });

  it("fall back to the newest first from an order they don't know", async () => {
    localStorage.setItem("dl_sort", "sideways");
    serveDownloads([]);

    await renderApp({ route: ROUTE });

    expect(await screen.findByRole("combobox", { name: "Ordena" })).toHaveValue("new");
  });

  it("remember the row density", async () => {
    serveDownloads([]);
    const { user } = await renderApp({ route: ROUTE });
    const toggle = await screen.findByRole("button", { name: "Canvia la densitat de les files" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("density")).toBe("1");
  });
});

describe("Pause all", () => {
  const PAUSE_ALL = "Posa-ho tot en pausa";
  const RESUME_ALL = "Reprèn-ho tot";

  beforeEach(() => serveDownloads([]));

  it("pauses the global queue from the top of the page", async () => {
    const calls: string[] = [];
    server.use(
      http.post("/api/queue/pause", () => {
        calls.push("pause");
        return HttpResponse.json({ ok: true, paused: true });
      }),
    );
    const { user } = await renderApp({ route: ROUTE });

    await user.click(await screen.findByRole("button", { name: PAUSE_ALL }));

    expect(await screen.findByRole("button", { name: RESUME_ALL })).toBeEnabled();
    expect(calls).toEqual(["pause"]);
    expect(screen.getByRole("button", { name: "Reprèn les baixades" })).toBeEnabled();
  });

  it("resumes a queue the backend reports as paused", async () => {
    const calls: string[] = [];
    server.use(
      http.get("/api/status", () => HttpResponse.json({ ...STATUS, paused: true })),
      http.post("/api/queue/resume", () => {
        calls.push("resume");
        return HttpResponse.json({ ok: true, paused: false });
      }),
    );
    const { user } = await renderApp({ route: ROUTE });

    await user.click(await screen.findByRole("button", { name: RESUME_ALL }));

    expect(await screen.findByRole("button", { name: PAUSE_ALL })).toBeEnabled();
    expect(calls).toEqual(["resume"]);
  });

  it("follows a pause made elsewhere, from the live stream", async () => {
    await renderApp({ route: ROUTE });
    await screen.findByRole("button", { name: PAUSE_ALL });

    emitSnapshot({ paused: true });

    expect(await screen.findByRole("button", { name: RESUME_ALL })).toBeEnabled();
  });
});

describe("Row actions", () => {
  const CANCEL = "/api/downloads/:id/cancel";
  const RETRY = "/api/downloads/:id/retry";

  function serveThenMove(path: string, answer: object, before: Download, after: Download) {
    const calls: string[] = [];
    let rows = [before];
    server.use(
      http.get("/api/downloads", () => HttpResponse.json(rows)),
      http.post(path, ({ params }) => {
        calls.push(String(params.id));
        rows = [after];
        return HttpResponse.json(answer);
      }),
    );
    return calls;
  }

  it.each(["queued", "downloading", "paused"] as const)("stops a %s row and moves it to Cancelled", async (status) => {
    const row = download({ id: 7, status });
    const calls = serveThenMove(CANCEL, { ok: true }, row, { ...row, status: "cancelled" });
    const { user } = await renderApp({ route: ROUTE });

    await user.click(within(await rowOf("Merli.S01E01.mkv")).getByRole("button", { name: "Atura" }));

    expect(await screen.findByRole("tab", { name: "Cancel·lades 1" })).toBeVisible();
    expect(calls).toEqual(["7"]);
  });

  it("says so when there was nothing left to stop", async () => {
    const row = download({ status: "queued" });
    serveThenMove(CANCEL, { ok: false }, row, row);
    const { user } = await renderApp({ route: ROUTE });

    await user.click(within(await rowOf("Merli.S01E01.mkv")).getByRole("button", { name: "Atura" }));

    expect(await screen.findByText("No hi ha res a cancel·lar: aquesta baixada no s’està executant")).toBeVisible();
  });

  it("says why a Stop failed", async () => {
    serveDownloads([download()]);
    server.use(http.post(CANCEL, () => HttpResponse.json({ detail: { key: "err.settings.budget" } }, { status: 500 })));
    const { user } = await renderApp({ route: ROUTE });

    await user.click(within(await rowOf("Merli.S01E01.mkv")).getByRole("button", { name: "Atura" }));

    expect(await screen.findByText(/El pressupost diari ha de ser 0/)).toBeVisible();
  });

  it.each([
    ["failed", "Fallides"],
    ["cancelled", "Cancel·lades"],
  ] as const)("retries a %s row and confirms it", async (status, label) => {
    const row = download({ id: 9, status });
    const calls = serveThenMove(RETRY, { ok: true }, row, { ...row, status: "queued" });
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, label);

    await user.click(within(await rowOf("Merli.S01E01.mkv")).getByRole("button", { name: "Torna-ho a provar" }));

    expect(await screen.findByText("S’ha tornat a posar a la cua")).toBeVisible();
    expect(await screen.findByRole("tab", { name: "A la cua / Actives 1" })).toBeVisible();
    expect(calls).toEqual(["9"]);
  });

  it.each([
    [{ ok: false, reason: "dl.err.message_gone" }, "El missatge de Telegram ja no existeix"],
    [{ ok: false }, /No s’ha tornat a posar res a la cua/],
  ])("says why a Retry was refused: %j", async (answer, message) => {
    const row = download({ status: "failed" });
    serveThenMove(RETRY, answer, row, row);
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, "Fallides");

    await user.click(within(await rowOf("Merli.S01E01.mkv")).getByRole("button", { name: "Torna-ho a provar" }));

    expect(await screen.findByText(message)).toBeVisible();
  });

  it("deletes a finished record from the list", async () => {
    const calls: string[] = [];
    let rows = [download({ id: 4, status: "failed" })];
    server.use(
      http.get("/api/downloads", () => HttpResponse.json(rows)),
      http.delete("/api/downloads/:id", ({ params }) => {
        calls.push(String(params.id));
        rows = [];
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, "Fallides");

    await user.click(within(await rowOf("Merli.S01E01.mkv")).getByRole("button", { name: "Suprimeix el registre" }));

    expect(await screen.findByText("No hi ha res.")).toBeVisible();
    expect(calls).toEqual(["4"]);
  });

  it("offers only what a row in that state can do", async () => {
    serveDownloads([
      download({ id: 1, status: "queued", file_name: "running.mkv" }),
      download({ id: 2, status: "failed", file_name: "broken.mkv" }),
    ]);
    const { user } = await renderApp({ route: ROUTE });

    const running = within(await rowOf("running.mkv"));
    expect(running.queryByRole("button", { name: "Torna-ho a provar" })).not.toBeInTheDocument();
    expect(running.queryByRole("button", { name: "Suprimeix el registre" })).not.toBeInTheDocument();

    await openTab(user, "Fallides");
    expect(within(await rowOf("broken.mkv")).queryByRole("button", { name: "Atura" })).not.toBeInTheDocument();
  });
});

describe("Pause and resume a row", () => {
  type RowAnswer = { ok: boolean; reason?: string };

  /** The backend for one row: the pause or resume moves it, and the list then says so. */
  function serveRow(path: "pause" | "resume", statusAfter: Download["status"], answer: RowAnswer = { ok: true }) {
    const calls: string[] = [];
    let row = download({ id: 7, status: path === "pause" ? "downloading" : "paused", progress: 0.4 });
    server.use(
      http.get("/api/downloads", () => HttpResponse.json([row])),
      http.post(`/api/downloads/7/${path}`, ({ request }) => {
        calls.push(new URL(request.url).pathname);
        if (answer.ok) row = { ...row, status: statusAfter, progress: 0, speed_mbs: 0 };
        return HttpResponse.json(answer);
      }),
    );
    return calls;
  }

  it("pauses a running transfer and labels the row paused", async () => {
    const calls = serveRow("pause", "paused");
    const { user } = await renderApp({ route: ROUTE });
    const row = within(await rowOf("Merli.S01E01.mkv"));

    await user.click(row.getByRole("button", { name: "Pausa" }));

    expect(await row.findByText("en pausa")).toBeVisible();
    expect(calls).toEqual(["/api/downloads/7/pause"]);
    expect(row.getByRole("button", { name: "Reprèn" })).toBeEnabled();
    expect(row.queryByRole("button", { name: "Pausa" })).not.toBeInTheDocument();
    expect(await screen.findByText("En pausa: s’ha descartat el fitxer parcial")).toBeVisible();
  });

  it("resumes a paused row and says the file starts again", async () => {
    const calls = serveRow("resume", "queued");
    const { user } = await renderApp({ route: ROUTE });
    const row = within(await rowOf("Merli.S01E01.mkv"));

    await user.click(row.getByRole("button", { name: "Reprèn" }));

    expect(await row.findByText("a la cua")).toBeVisible();
    expect(calls).toEqual(["/api/downloads/7/resume"]);
    expect(row.queryByText("en pausa")).not.toBeInTheDocument();
    expect(await screen.findByText("Torna a ser a la cua: començarà des del principi")).toBeVisible();
  });

  it("says so when there was nothing left to pause", async () => {
    serveRow("pause", "paused", { ok: false });
    const { user } = await renderApp({ route: ROUTE });
    const row = within(await rowOf("Merli.S01E01.mkv"));

    await user.click(row.getByRole("button", { name: "Pausa" }));

    expect(await screen.findByText(/No s’ha posat res en pausa/)).toBeVisible();
  });

  it("shows the server's reason when a row can't be resumed", async () => {
    serveRow("resume", "queued", { ok: false, reason: "dl.err.message_gone" });
    const { user } = await renderApp({ route: ROUTE });
    const row = within(await rowOf("Merli.S01E01.mkv"));

    await user.click(row.getByRole("button", { name: "Reprèn" }));

    expect(await screen.findByText("El missatge de Telegram ja no existeix")).toBeVisible();
    expect(row.getByText("en pausa")).toBeVisible();
  });

  it("offers Pause on queued rows too, and nothing of the kind on finished ones", async () => {
    serveDownloads([
      download({ id: 1, status: "queued", file_name: "waiting.mkv" }),
      download({ id: 2, status: "completed", file_name: "done.mkv" }),
    ]);
    const { user } = await renderApp({ route: ROUTE });

    const waiting = within(await rowOf("waiting.mkv"));
    expect(waiting.getByRole("button", { name: "Pausa" })).toBeEnabled();

    await openTab(user, "Completades");
    await user.click(await screen.findByRole("button", { name: /^Cinema Club/ }));
    const done = within(await rowOf("done.mkv"));
    expect(done.queryByRole("button", { name: "Pausa" })).not.toBeInTheDocument();
    expect(done.queryByRole("button", { name: "Reprèn" })).not.toBeInTheDocument();
  });

  it("warns before pausing that the partial file goes", async () => {
    serveDownloads([download({ status: "downloading" })]);
    await renderApp({ route: ROUTE });

    const pause = within(await rowOf("Merli.S01E01.mkv")).getByRole("button", { name: "Pausa" });

    expect(pause).toHaveAccessibleDescription(/Descarta el fitxer parcial/);
  });

  it("shows no stale figures on a paused row, and that it will start over", async () => {
    serveDownloads([download({ status: "paused", speed_mbs: 3.5 })]);
    await renderApp({ route: ROUTE });

    const row = within(await rowOf("Merli.S01E01.mkv"));

    expect(row.getByText("Tornarà a començar des del principi quan el reprenguis")).toBeVisible();
    expect(row.getByText(/Cinema Club · 2\.00 GB/)).toBeVisible();
    expect(row.queryByText(/%/)).not.toBeInTheDocument();
    expect(row.queryByText(/MB\/s/)).not.toBeInTheDocument();
    expect(row.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("can still Stop a paused row", async () => {
    serveDownloads([download({ status: "paused" })]);
    await renderApp({ route: ROUTE });

    const row = within(await rowOf("Merli.S01E01.mkv"));

    expect(row.getByRole("button", { name: "Atura" })).toBeEnabled();
    expect(row.queryByRole("button", { name: "Suprimeix el registre" })).not.toBeInTheDocument();
  });
});

const BULK_BAR = "Accions sobre les baixades seleccionades";
const SELECT_ALL = "Selecciona-ho tot";

const bulkBar = async () => within(await screen.findByRole("group", { name: BULK_BAR }));
const pick = (name: string) => screen.findByRole("checkbox", { name: `Selecciona ${name}` });

/** Answers the bulk endpoint, and keeps what each request asked for. */
function serveBulk(count: number | (() => Response) = 1) {
  const bodies: unknown[] = [];
  server.use(
    http.post("/api/downloads/bulk", async ({ request }) => {
      bodies.push(await request.json());
      return typeof count === "number" ? HttpResponse.json({ ok: true, count }) : count();
    }),
  );
  return bodies;
}

describe("Selecting downloads", () => {
  const ROWS = [
    download({ id: 1, status: "downloading", file_name: "running.mkv" }),
    download({ id: 2, status: "queued", file_name: "waiting.mkv" }),
    download({ id: 3, status: "paused", file_name: "held.mkv" }),
  ];

  it("selects every row in view, then none", async () => {
    serveDownloads(ROWS);
    const { user } = await renderApp({ route: ROUTE });
    await pick("running.mkv");

    await user.click(await screen.findByRole("checkbox", { name: SELECT_ALL }));

    expect(await pick("held.mkv")).toBeChecked();
    expect(await pick("running.mkv")).toBeChecked();
    expect((await bulkBar()).getByText("3 seleccionades")).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: SELECT_ALL }));

    expect(await pick("held.mkv")).not.toBeChecked();
    expect((await bulkBar()).queryByRole("button", { name: "Pausa" })).not.toBeInTheDocument();
  });

  it("shows a partial selection on Select all", async () => {
    serveDownloads(ROWS);
    const { user } = await renderApp({ route: ROUTE });

    await user.click(await pick("waiting.mkv"));

    expect(screen.getByRole("checkbox", { name: SELECT_ALL })).toBePartiallyChecked();
    expect((await bulkBar()).getByText("1 seleccionada")).toBeVisible();
  });

  it("works from the keyboard", async () => {
    serveDownloads([download({ id: 1, status: "queued", file_name: "waiting.mkv" })]);
    const bodies = serveBulk();
    const { user } = await renderApp({ route: ROUTE });
    const checkbox = await pick("waiting.mkv");

    checkbox.focus();
    await user.keyboard(" ");
    expect(checkbox).toBeChecked();

    const bar = await bulkBar();
    bar.getByRole("button", { name: "Pausa" }).focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(bodies).toEqual([{ action: "pause", ids: [1] }]));
  });

  it("gives focus back to Select all when the actions go away", async () => {
    serveDownloads(ROWS);
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("waiting.mkv"));

    await user.click((await bulkBar()).getByRole("button", { name: "Esborra la selecció" }));

    expect(screen.getByRole("checkbox", { name: SELECT_ALL })).toHaveFocus();
    expect(await pick("waiting.mkv")).not.toBeChecked();
  });

  it("forgets the selection on another tab", async () => {
    serveDownloads([...ROWS, download({ id: 4, status: "failed", file_name: "broken.mkv" })]);
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("waiting.mkv"));

    await openTab(user, "Fallides");
    await pick("broken.mkv");
    await openTab(user, "A la cua / Actives");

    expect(await pick("waiting.mkv")).not.toBeChecked();
  });

  it("drops a selected row that leaves the tab", async () => {
    const rows = [...ROWS];
    server.use(http.get("/api/downloads", () => HttpResponse.json(rows)));
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("waiting.mkv"));
    await user.click(await pick("running.mkv"));
    await screen.findByText("2 seleccionades");

    rows[0] = { ...rows[0], status: "completed" };
    emitSnapshot({ stats: { ...STATUS.stats, completed: STATUS.stats.completed + 1 } });
    emitSnapshot({ stats: { ...STATUS.stats, completed: STATUS.stats.completed + 2 } });

    expect(await screen.findByText("1 seleccionada")).toBeVisible();
  });
});

describe("Bulk pause and resume", () => {
  const ROWS = [
    download({ id: 1, status: "downloading", file_name: "running.mkv" }),
    download({ id: 2, status: "queued", file_name: "waiting.mkv" }),
    download({ id: 3, status: "paused", file_name: "held.mkv" }),
    download({ id: 4, status: "paused", file_name: "kept.mkv" }),
  ];

  it("pauses the selected rows in one request", async () => {
    serveDownloads(ROWS);
    const bodies = serveBulk(2);
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("running.mkv"));
    await user.click(await pick("waiting.mkv"));

    await user.click((await bulkBar()).getByRole("button", { name: "Pausa" }));

    expect(await screen.findByText("Baixades en pausa: 2. S’han descartat els fitxers parcials")).toBeVisible();
    expect(bodies).toEqual([{ action: "pause", ids: [1, 2] }]);
    expect(await pick("running.mkv")).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: SELECT_ALL })).toHaveFocus();
  });

  it("resumes the selected rows in one request, saying they start again", async () => {
    serveDownloads(ROWS);
    const bodies = serveBulk(2);
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("held.mkv"));
    await user.click(await pick("kept.mkv"));

    await user.click((await bulkBar()).getByRole("button", { name: "Reprèn" }));

    expect(await screen.findByText("Tornen a ser a la cua: 2. Començaran des del principi")).toBeVisible();
    expect(bodies).toEqual([{ action: "resume", ids: [3, 4] }]);
  });

  it("sends each action only the rows it can act on", async () => {
    serveDownloads(ROWS);
    const bodies = serveBulk();
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("running.mkv"));
    await user.click(await pick("held.mkv"));

    await user.click((await bulkBar()).getByRole("button", { name: "Pausa" }));

    await waitFor(() => expect(bodies).toEqual([{ action: "pause", ids: [1] }]));
  });

  it("offers only what the selection allows", async () => {
    serveDownloads(ROWS);
    const { user } = await renderApp({ route: ROUTE });

    await user.click(await pick("held.mkv"));

    const bar = await bulkBar();
    expect(bar.getByRole("button", { name: "Reprèn" })).toBeEnabled();
    expect(bar.queryByRole("button", { name: "Pausa" })).not.toBeInTheDocument();
    expect(bar.queryByRole("button", { name: "Suprimeix" })).not.toBeInTheDocument();
    expect(bar.queryByRole("button", { name: "Torna-ho a provar" })).not.toBeInTheDocument();
  });

  it("leaves out rows the filter hides", async () => {
    serveDownloads(ROWS);
    const bodies = serveBulk();
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("running.mkv"));
    await user.click(await pick("waiting.mkv"));

    await user.type(await filterBox(), "waiting");
    await screen.findByText("1 seleccionada");
    await user.click((await bulkBar()).getByRole("button", { name: "Pausa" }));

    await waitFor(() => expect(bodies).toEqual([{ action: "pause", ids: [2] }]));
  });

  it("says when the server held nothing", async () => {
    serveDownloads(ROWS);
    serveBulk(0);
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("running.mkv"));

    await user.click((await bulkBar()).getByRole("button", { name: "Pausa" }));

    expect(await screen.findByText(/No s’ha posat res en pausa/)).toBeVisible();
  });

  it("keeps the selection when the request fails, to try again", async () => {
    serveDownloads(ROWS);
    serveBulk(() => HttpResponse.json({ detail: "boom" }, { status: 500 }));
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("running.mkv"));

    await user.click((await bulkBar()).getByRole("button", { name: "Pausa" }));

    await screen.findByText("boom");
    expect(await pick("running.mkv")).toBeChecked();
  });
});

describe("Paused rows and the live stream", () => {
  const HELD = download({ id: 1, status: "paused", file_name: "held.mkv" });
  const RUNNING = download({ id: 2, status: "downloading", file_name: "running.mkv", progress: 0.1 });

  it("keeps a paused row, its badge and its selection while others move", async () => {
    serveDownloads([HELD, RUNNING]);
    const { user } = await renderApp({ route: ROUTE });
    await user.click(await pick("held.mkv"));

    emitSnapshot({ active: [{ ...RUNNING, progress: 0.75 }] });

    await screen.findByText(/75%/);
    expect(within(await rowOf("held.mkv")).getByText("en pausa")).toBeVisible();
    expect(await pick("held.mkv")).toBeChecked();
  });

  it("keeps a paused row when nothing is active any more", async () => {
    serveDownloads([HELD]);
    await renderApp({ route: ROUTE });
    await rowOf("held.mkv");

    emitSnapshot({ active: [] });
    emitSnapshot({ active: [] });

    expect(within(await rowOf("held.mkv")).getByText("en pausa")).toBeVisible();
  });

  it("shows a row paused elsewhere, though the stream no longer lists it", async () => {
    let rows = [RUNNING];
    server.use(http.get("/api/downloads", () => HttpResponse.json(rows)));
    await renderApp({ route: ROUTE });
    const running = within(await rowOf("running.mkv"));
    emitSnapshot({ active: [RUNNING] });

    rows = [{ ...RUNNING, status: "paused", progress: 0, speed_mbs: 0 }];
    emitSnapshot({ active: [], stats: { ...STATUS.stats, paused: 1 } });

    expect(await running.findByText("en pausa")).toBeVisible();
    expect(running.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("leaves a paused row alone when Resume all runs", async () => {
    const rowCalls: string[] = [];
    server.use(
      http.get("/api/status", () => HttpResponse.json({ ...STATUS, paused: true })),
      http.get("/api/downloads", () => HttpResponse.json([HELD])),
      http.post("/api/queue/resume", () => HttpResponse.json({ ok: true, paused: false })),
      http.post("/api/downloads/:id/resume", ({ request }) => {
        rowCalls.push(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = await renderApp({ route: ROUTE });

    await user.click(await screen.findByRole("button", { name: "Reprèn-ho tot" }));

    await screen.findByRole("button", { name: "Posa-ho tot en pausa" });
    expect(within(await rowOf("held.mkv")).getByText("en pausa")).toBeVisible();
    expect(rowCalls).toEqual([]);
  });
});

describe("Bulk Retry, Delete and Clear selection", () => {
  const FAILED = [
    download({ id: 1, status: "failed", file_name: "Merli.mkv" }),
    download({ id: 2, status: "failed", file_name: "Plats.bruts.mkv" }),
    download({ id: 3, status: "failed", file_name: "Polseres.mkv" }),
  ];

  async function selectFailed(...names: string[]) {
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, "Fallides");
    for (const name of names) await user.click(await pick(name));
    return user;
  }

  it("retries the selected rows in one request and counts them", async () => {
    serveDownloads(FAILED);
    const bodies = serveBulk(2);
    const user = await selectFailed("Merli.mkv", "Polseres.mkv");

    await user.click((await bulkBar()).getByRole("button", { name: "Torna-ho a provar" }));

    expect(await screen.findByText("Baixades tornades a la cua: 2")).toBeVisible();
    expect(bodies).toEqual([{ action: "retry", ids: [1, 3] }]);
    expect(await pick("Merli.mkv")).not.toBeChecked();
  });

  it("says when a bulk Retry re-queued nothing", async () => {
    serveDownloads(FAILED);
    serveBulk(0);
    const user = await selectFailed("Merli.mkv");

    await user.click((await bulkBar()).getByRole("button", { name: "Torna-ho a provar" }));

    expect(await screen.findByText(/No s’ha tornat a posar res a la cua/)).toBeVisible();
  });

  it("deletes the selected records once confirmed", async () => {
    serveDownloads(FAILED);
    const bodies = serveBulk(2);
    const user = await selectFailed("Merli.mkv", "Plats.bruts.mkv");

    await user.click((await bulkBar()).getByRole("button", { name: "Suprimeix" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Vols suprimir 2 registre(s) seleccionat(s)? Els fitxers del disc es conserven.")).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Suprimeix" }));

    await waitFor(() => expect(bodies).toEqual([{ action: "delete", ids: [1, 2] }]));
    expect(await pick("Merli.mkv")).not.toBeChecked();
  });

  it("deletes nothing if the confirmation is cancelled", async () => {
    serveDownloads(FAILED);
    const bodies = serveBulk();
    const user = await selectFailed("Merli.mkv");

    await user.click((await bulkBar()).getByRole("button", { name: "Suprimeix" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel·la" }));

    expect(bodies).toEqual([]);
    expect(await pick("Merli.mkv")).toBeChecked();
  });

  it("offers Delete but not Retry on completed rows, inside their show", async () => {
    serveDownloads([download({ id: 5, status: "completed", file_name: "Done.mkv", save_path: "/tv/Merli/Season 1/Done.mkv" })]);
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, "Completades");
    await user.click(await screen.findByRole("button", { name: /^Merli/ }));

    await user.click(await pick("Done.mkv"));

    const bar = await bulkBar();
    expect(bar.getByRole("button", { name: "Suprimeix" })).toBeEnabled();
    expect(bar.queryByRole("button", { name: "Torna-ho a provar" })).not.toBeInTheDocument();
  });

  it("clears the selection without calling the backend", async () => {
    serveDownloads(FAILED);
    const bodies = serveBulk();
    const user = await selectFailed("Merli.mkv", "Polseres.mkv");

    await user.click((await bulkBar()).getByRole("button", { name: "Esborra la selecció" }));

    expect(await pick("Polseres.mkv")).not.toBeChecked();
    expect(bodies).toEqual([]);
  });

  it("keeps Clear failed in reach beside the selection", async () => {
    serveDownloads(FAILED);
    await selectFailed("Merli.mkv");

    expect(await screen.findByRole("button", { name: "Esborra les 3 fallides" })).toBeEnabled();
  });
});

describe("Row details", () => {
  it.each([
    [{ progress: 0.5, speed_mbs: 1 }, /falten 15 min 53 s/],
    [{ file_size: 10_485_760, speed_mbs: 1 }, /falten 10 s/],
  ])("tells how long a transfer has left: %j", async (fields, remaining) => {
    serveDownloads([download({ status: "downloading", ...fields })]);

    await renderApp({ route: ROUTE });

    expect(await screen.findByText(remaining)).toBeVisible();
  });

  it.each([
    [{ episode: 3, parsed_episode: 3, episode_source: "channel" }, "Part mantinguda com a E03"],
    [{ episode: 3, parsed_episode: 3, episode_source: "tmdb-ca" }, "Part comprovada: E03 via TMDB (català)"],
    [{ episode: 12, parsed_episode: 3, episode_source: "sonarr" }, "Part resolta: canal E03 → E12 via Sonarr"],
    [{ episode: 3, parsed_episode: 3, episode_source: "mystery" }, "Part comprovada: E03 via mystery"],
  ])("says how the episode number was settled: %j", async (fields, note) => {
    serveDownloads([download(fields)]);

    await renderApp({ route: ROUTE });

    expect(await screen.findByText(note)).toBeVisible();
  });

  it("explains a number kept from the channel", async () => {
    serveDownloads([download({ episode: 3, parsed_episode: 3, episode_source: "channel" })]);

    await renderApp({ route: ROUTE });

    expect(await screen.findByText("Part mantinguda com a E03")).toHaveAttribute(
      "title",
      "No hi ha cap coincidència fiable a TMDB ni a Sonarr; s’ha mantingut la numeració del canal",
    );
  });

  it.each([
    [{ error_msg: { key: "dl.err.failed", params: { error: "boom" } } }, "La descàrrega ha fallat: boom"],
    [{ error: "Disk full" }, "Disk full"],
  ])("says why a row failed: %j", async (fields, reason) => {
    serveDownloads([download({ status: "failed", ...fields })]);
    const { user } = await renderApp({ route: ROUTE });

    await openTab(user, "Fallides");

    expect(await screen.findByText(reason)).toBeVisible();
  });
});

describe("Completed tab", () => {
  const LIBRARY = [
    download({ id: 1, status: "completed", save_path: "/tv/Plats bruts/Season 1/a.mkv", file_size: 1_000_000_000 }),
    download({ id: 2, status: "completed", save_path: "/tv/Merli/Season 1/b.mkv", file_size: 1_000_000_000 }),
    download({ id: 3, status: "completed", save_path: "/tv/Merli/Season 2/c.mkv", file_size: 2_000_000_000 }),
  ];
  const MERLI = { name: /^Merli/ };

  async function openCompleted() {
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, "Completades");
    return user;
  }

  it("folds episodes into their show, in name order", async () => {
    serveDownloads(LIBRARY);

    await openCompleted();

    const merli = await screen.findByRole("button", MERLI);
    expect(merli).toHaveTextContent("2 episodis · 3.00 GB");
    expect(merli).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("listitem").map((row) => row.textContent?.slice(0, 5))).toEqual(["Merli", "Plats"]);
    expect(screen.queryByText("b.mkv")).not.toBeInTheDocument();
  });

  it("names a group after the channel, or says it is unknown, when the path has no show", async () => {
    serveDownloads([
      download({ id: 1, status: "completed" }),
      download({ id: 2, status: "completed", channel_title: null }),
    ]);

    await openCompleted();

    expect(await screen.findByRole("button", { name: /^Cinema Club/ })).toBeVisible();
    expect(await screen.findByRole("button", { name: /^Desconegut/ })).toBeVisible();
  });

  it("opens a group from the keyboard", async () => {
    serveDownloads(LIBRARY);
    const user = await openCompleted();
    const merli = await screen.findByRole("button", MERLI);

    merli.focus();
    await user.keyboard("{Enter}");

    expect(merli).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("b.mkv")).toBeVisible();
    expect(screen.getByText("c.mkv")).toBeVisible();
    expect(screen.queryByText("a.mkv")).not.toBeInTheDocument();
  });

  function serveBulkDelete(rows: readonly Download[]) {
    const bodies: unknown[] = [];
    server.use(
      http.get("/api/downloads", () => HttpResponse.json(rows)),
      http.post("/api/downloads/bulk", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true, count: 2 });
      }),
    );
    return bodies;
  }

  it("clears a whole group once confirmed, leaving the files alone", async () => {
    const bodies = serveBulkDelete(LIBRARY);
    const user = await openCompleted();

    await user.click(await screen.findByRole("button", { name: "Esborra Merli" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText(/Vols eliminar 2 registre\(s\) completat\(s\) de Merli\?/)).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Suprimeix" }));

    await waitFor(() => expect(bodies).toEqual([{ action: "delete", ids: [2, 3] }]));
  });

  it("clears nothing when the confirmation is dismissed", async () => {
    const bodies = serveBulkDelete(LIBRARY);
    const user = await openCompleted();

    await user.click(await screen.findByRole("button", { name: "Esborra Merli" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel·la" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(bodies).toEqual([]);
  });
});

describe("Clear failed", () => {
  const FAILED = [
    download({ id: 1, status: "failed", file_name: "Merli.mkv" }),
    download({ id: 2, status: "failed", file_name: "Plats.bruts.mkv" }),
  ];

  function serveClear() {
    const bodies: unknown[] = [];
    server.use(
      http.get("/api/downloads", () => HttpResponse.json(FAILED)),
      http.post("/api/downloads/bulk", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true, count: 1 });
      }),
    );
    return bodies;
  }

  it("removes every failed record once confirmed", async () => {
    const bodies = serveClear();
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, "Fallides");

    await user.click(await screen.findByRole("button", { name: "Esborra les 2 fallides" }));
    const dialog = within(await screen.findByRole("alertdialog"));
    expect(dialog.getByText("Vols suprimir 2 registre(s) fallit(s)?")).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Suprimeix" }));

    await waitFor(() => expect(bodies).toEqual([{ action: "delete", ids: [1, 2] }]));
  });

  it("touches only the rows the filter left in view", async () => {
    const bodies = serveClear();
    const { user } = await renderApp({ route: ROUTE });
    await openTab(user, "Fallides");
    await user.type(await filterBox(), "merli");

    await user.click(await screen.findByRole("button", { name: "Esborra les 1 fallides" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Suprimeix" }));

    await waitFor(() => expect(bodies).toEqual([{ action: "delete", ids: [1] }]));
  });

  it("is not offered on other tabs", async () => {
    serveDownloads([download({ status: "cancelled" })]);
    const { user } = await renderApp({ route: ROUTE });

    await openTab(user, "Cancel·lades");

    await screen.findByText("Merli.S01E01.mkv");
    expect(screen.queryByRole("button", { name: /fallides/ })).not.toBeInTheDocument();
  });
});
