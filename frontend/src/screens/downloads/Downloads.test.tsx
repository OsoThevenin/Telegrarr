import { screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { Download } from "@/lib/downloads";
import { emitSnapshot } from "@/test/event-stream";
import { renderApp } from "@/test/render";
import { server, STATUS } from "@/test/server";

const ROUTE = "/ui/downloads";

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

  // The backend discards a paused transfer's partial file, so progress is back at 0.
  it("treats a paused row as unfinished: it starts over from 0% and offers no Delete", async () => {
    serveDownloads([download({ status: "paused", progress: 0 })]);

    await renderApp({ route: ROUTE });

    const row = within(await rowOf("Merli.S01E01.mkv"));
    expect(row.getByRole("progressbar", { name: "Merli.S01E01.mkv" })).toBeVisible();
    expect(row.getByText(/0%/)).toBeVisible();
    expect(row.queryByRole("button", { name: "Suprimeix el registre" })).not.toBeInTheDocument();
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
