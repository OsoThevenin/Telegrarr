import { screen, within } from "@testing-library/react";
import { delay, http, HttpResponse, type JsonBodyType } from "msw";
import { describe, expect, it } from "vitest";

import { EMPTY_SNAPSHOT, emitSnapshot } from "@/test/event-stream";
import { renderApp } from "@/test/render";
import { server, STATUS } from "@/test/server";

const NOW = Math.floor(Date.now() / 1000);
const GB = 1024 ** 3;
const LOADING = "S’està carregant…";

const STATS = { ...EMPTY_SNAPSHOT.stats, channels: 2, downloading: 1, queued: 5, completed: 12, failed: 0, total_size: GB };
const WORLD = { ...STATUS, stats: STATS, disk: { total: 100 * GB, used: 40 * GB, free: 60 * GB } };

const download = (id: number, overrides: Record<string, JsonBodyType> = {}) => ({
  id,
  channel_id: 1,
  file_name: `file-${id}.mkv`,
  file_size: GB,
  status: "completed",
  progress: 1,
  speed_mbs: 0,
  save_path: null,
  finished_at: NOW - id * 60,
  channel_title: "Cinema Club",
  topic_title: null,
  ...overrides,
});

const task = (title: string, nextRun: number | null, enabled = true) => ({
  title,
  poll_minutes: 30,
  weekdays: [0],
  enabled,
  last_run: null,
  next_run: nextRun,
  channel_id: 1,
});

type World = {
  status?: JsonBodyType;
  active?: JsonBodyType[];
  completed?: JsonBodyType[];
  tasks?: JsonBodyType[];
};

function answer({ status = WORLD, active = [], completed = [], tasks = [] }: World = {}) {
  server.use(
    http.get("/api/status", () => HttpResponse.json(status)),
    http.get("/api/system/tasks", () => HttpResponse.json(tasks)),
    http.get("/api/downloads", ({ request }) => {
      // The active rows come from the unfiltered list; Recently grabbed asks for completed ones.
      const wanted = new URL(request.url).searchParams.get("status");
      return HttpResponse.json(wanted ? completed : [...active, ...completed]);
    }),
  );
}

const statLink = (name: RegExp) => screen.findByRole("link", { name });

describe("Dashboard", () => {
  it("shows a loading state until the status arrives", async () => {
    server.use(
      http.get("/api/status", async () => {
        await delay("infinite");
        return HttpResponse.json(WORLD);
      }),
    );

    await renderApp({ route: "/" });

    expect(await screen.findByRole("status", { name: LOADING })).toBeVisible();
  });

  it("offers a retry when the status cannot be loaded", async () => {
    let failing = true;
    answer();
    server.use(
      http.get("/api/status", () =>
        failing ? HttpResponse.json({ detail: "No disponible" }, { status: 500 }) : HttpResponse.json(WORLD),
      ),
    );

    const { user } = await renderApp({ route: "/" });

    expect(await screen.findByRole("alert")).toHaveTextContent("No disponible");
    failing = false;
    await user.click(screen.getByRole("button", { name: "Torna-ho a provar" }));

    expect(await statLink(/12\s*Completades/)).toBeVisible();
  });

  it("links every count to where it can be acted on", async () => {
    answer();

    await renderApp({ route: "/" });

    expect(await statLink(/2\s*Canals/)).toHaveAttribute("href", "/channels");
    expect(await statLink(/1\s*Baixant/)).toHaveAttribute("href", "/downloads#en-curs");
    expect(await statLink(/5\s*A la cua/)).toHaveAttribute("href", "/downloads#en-curs");
    expect(await statLink(/12\s*Completades/)).toHaveAttribute("href", "/downloads?tab=completed");
    expect(await statLink(/0\s*Fallides/)).toHaveAttribute("href", "/downloads?tab=failed");
  });

  it("keeps the counts live", async () => {
    answer();
    await renderApp({ route: "/" });
    await statLink(/12\s*Completades/);

    emitSnapshot({ stats: { ...STATS, completed: 13 }, disk: WORLD.disk });

    expect(await statLink(/13\s*Completades/)).toBeVisible();
  });

  it("invites a first Channel in place of empty sections", async () => {
    answer({ status: STATUS });

    await renderApp({ route: "/" });

    expect(await screen.findByRole("link", { name: "Afegeix un canal" })).toHaveAttribute("href", "/channels");
    expect(screen.queryByText("Properament")).not.toBeInTheDocument();
    expect(screen.queryByText("Tot funciona")).not.toBeInTheDocument();
  });

  describe("status line", () => {
    const line = () => screen.findByTestId("status-line");

    it("says all is well when it is", async () => {
      answer();

      await renderApp({ route: "/" });

      expect(await line()).toHaveTextContent("Tot funciona");
    });

    it("offers to resume a paused queue", async () => {
      let resumed = false;
      answer({ status: { ...WORLD, paused: true } });
      server.use(
        http.post("/api/queue/resume", () => {
          resumed = true;
          return HttpResponse.json({ paused: false });
        }),
      );

      const { user } = await renderApp({ route: "/" });
      const status = await line();
      expect(status).toHaveTextContent("Les baixades estan en pausa");

      await user.click(within(status).getByRole("button", { name: "Reprèn les baixades" }));

      expect(await line()).toHaveTextContent("Tot funciona");
      expect(resumed).toBe(true);
    });

    it("says when the budget runs out and when it comes back", async () => {
      const resetsAt = new Date(2026, 10, 7, 9, 5).getTime() / 1000;
      answer({
        status: { ...WORLD, budget: { limit_gb: 20, used_bytes: 20 * GB, exhausted: true, resets_at: resetsAt } },
      });

      await renderApp({ route: "/" });

      expect(await line()).toHaveTextContent("límit diari de 20 GB");
      expect(await line()).toHaveTextContent("09:05");
    });

    it("warns when the disk is nearly full", async () => {
      answer({ status: { ...WORLD, disk: { total: 100 * GB, used: 96 * GB, free: 4 * GB } } });

      await renderApp({ route: "/" });

      expect(await line()).toHaveTextContent("Disc gairebé ple: 4.0 GB lliures");
    });

    it("points failures to Downloads", async () => {
      answer({ status: { ...WORLD, stats: { ...STATS, failed: 3 } } });

      await renderApp({ route: "/" });

      const status = await line();
      expect(status).toHaveTextContent("3 baixades han fallat");
      expect(within(status).getByRole("link", { name: "Baixades" })).toHaveAttribute("href", "/downloads");
    });

    it("puts a lost Telegram session before everything else", async () => {
      answer({ status: { ...WORLD, authorized: false, paused: true, stats: { ...STATS, failed: 3 } } });

      await renderApp({ route: "/" });

      const status = await line();
      expect(status).toHaveTextContent("Connecta");
      expect(status).not.toHaveTextContent("en pausa");
    });
  });

  describe("Active downloads", () => {
    const ACTIVE = download(9, {
      status: "downloading",
      progress: 0.47,
      speed_mbs: 3.5,
      save_path: "/media/movies/Pa Negre (2010).mkv",
      file_name: "pa.negre.mkv",
    });
    const QUEUED = download(4, { status: "queued", progress: 0, file_name: "merli.s01e01.mkv" });

    it("lists transfers first, then the queue, each with its state and a way to stop it", async () => {
      answer({ active: [QUEUED, ACTIVE] });
      await renderApp({ route: "/" });

      const list = await screen.findByRole("list", { name: "Actiu ara" });
      const rows = await within(list).findAllByRole("listitem");
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringMatching(/^Pa Negre \(2010\)\.mkv.*Baixant.*Atura.*Cinema Club · 1\.07 GB · 3\.5 MB\/s/),
        expect.stringMatching(/^merli\.s01e01\.mkv.*A la cua.*Atura.*en espera · 0%/),
      ]);
      expect(within(rows[0]).getByRole("meter", { name: "Pa Negre (2010).mkv" })).toHaveAttribute("aria-valuenow", "47");
    });

    it("follows the live progress and speed", async () => {
      answer({ active: [ACTIVE] });
      await renderApp({ route: "/" });
      await screen.findByRole("meter", { name: "Pa Negre (2010).mkv" });

      emitSnapshot({ stats: STATS, speed: 12.4, disk: WORLD.disk, active: [{ ...ACTIVE, progress: 0.8 }] as never });

      expect(await screen.findByRole("meter", { name: "Pa Negre (2010).mkv" })).toHaveAttribute("aria-valuenow", "80");
      expect(screen.getByText("12.4 MB/s")).toBeVisible();
    });

    it("stops a download from its row", async () => {
      const stopped: string[] = [];
      answer({ active: [ACTIVE] });
      server.use(
        http.post("/api/downloads/:id/cancel", ({ params }) => {
          stopped.push(String(params.id));
          return HttpResponse.json({ ok: true });
        }),
      );
      const { user } = await renderApp({ route: "/" });

      await user.click(await screen.findByRole("button", { name: "Atura" }));

      await expect.poll(() => stopped).toEqual(["9"]);
    });

    it("shows five rows and links to the rest", async () => {
      const queue = [1, 2, 3, 4, 5, 6, 7].map((id) => download(id, { status: "queued", progress: 0 }));
      answer({ active: queue });
      await renderApp({ route: "/" });

      const list = await screen.findByRole("list", { name: "Actiu ara" });
      expect(await within(list).findAllByRole("listitem")).toHaveLength(5);
      expect(screen.getByRole("link", { name: "2 més a Baixades" })).toHaveAttribute("href", "/downloads#en-curs");
    });

    it("is one quiet line when nothing is downloading", async () => {
      answer({ status: { ...WORLD, stats: { ...STATS, downloading: 0, queued: 0 } } });

      await renderApp({ route: "/" });

      expect(await screen.findByRole("link", { name: "Ara mateix no s’està baixant res." })).toHaveAttribute(
        "href",
        "/downloads",
      );
    });

    it("says so when the downloads cannot be loaded", async () => {
      answer();
      server.use(
        http.get("/api/downloads", ({ request }) =>
          new URL(request.url).searchParams.get("status")
            ? HttpResponse.json([])
            : HttpResponse.json({ detail: "Sense baixades" }, { status: 500 }),
        ),
      );

      await renderApp({ route: "/" });

      expect(await screen.findByRole("alert")).toHaveTextContent("Sense baixades");
    });
  });

  describe("Capacity", () => {
    it("meters the disk and states the Library size", async () => {
      answer();

      await renderApp({ route: "/" });

      expect(await screen.findByRole("meter", { name: "Disc" })).toHaveAttribute("aria-valuenow", "40");
      expect(screen.getByText("40.0 GB ocupats")).toBeVisible();
      expect(screen.getByText("60.0 GB lliures")).toBeVisible();
      expect(screen.getByText("Biblioteca")).toBeVisible();
      expect(screen.getByText("1.0 GB")).toBeVisible();
    });

    it("meters the budget when there is one", async () => {
      answer({
        status: { ...WORLD, budget: { limit_gb: 20, used_bytes: 5 * GB, exhausted: false, resets_at: NOW + 3600 } },
      });

      await renderApp({ route: "/" });

      expect(await screen.findByRole("meter", { name: "Límit diari" })).toHaveAttribute("aria-valuenow", "25");
      expect(screen.getByText("5.0 GB de 20 GB")).toBeVisible();
    });

    it("leaves the budget out when there is no limit", async () => {
      answer();

      await renderApp({ route: "/" });

      await screen.findByRole("meter", { name: "Disc" });
      expect(screen.queryByRole("meter", { name: "Límit diari" })).not.toBeInTheDocument();
    });
  });

  describe("Up next", () => {
    it("shows the three soonest enabled scans and links to System", async () => {
      answer({
        tasks: [
          task("Later", NOW + 4000),
          task("Soonest", NOW + 300),
          task("Off", null, false),
          task("Sooner", NOW + 600),
          task("Latest", NOW + 8000),
        ],
      });

      await renderApp({ route: "/" });

      const rows = await screen.findAllByTestId("up-next-row");
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("Soonest"),
        expect.stringContaining("Sooner"),
        expect.stringContaining("Later"),
      ]);
      const card = rows[0].closest<HTMLElement>("[data-slot=card]");
      expect(within(card as HTMLElement).getByRole("link", { name: "Sistema" })).toHaveAttribute("href", "/system");
    });

    it("says when nothing is scheduled", async () => {
      answer();

      await renderApp({ route: "/" });

      expect(await screen.findByText("No hi ha cap canal programat.")).toBeVisible();
    });

    it("offers a retry when the tasks cannot be loaded", async () => {
      answer();
      server.use(http.get("/api/system/tasks", () => HttpResponse.json({ detail: "Sense tasques" }, { status: 500 })));

      await renderApp({ route: "/" });

      expect(await screen.findByRole("alert")).toHaveTextContent("Sense tasques");
    });
  });

  describe("Recently grabbed", () => {
    it("lists the five latest with their source", async () => {
      answer({
        completed: [1, 2, 3, 4, 5, 6].map((id) =>
          download(id, id === 1 ? { save_path: "/media/tv/S01E01.mkv", topic_title: "Sèries" } : {}),
        ),
      });

      await renderApp({ route: "/" });

      const rows = await screen.findAllByTestId("recent-row");
      expect(rows).toHaveLength(5);
      expect(rows[0]).toHaveTextContent("S01E01.mkv");
      expect(rows[0]).toHaveTextContent("Cinema Club › Sèries");
    });

    it("is one line when nothing has been grabbed", async () => {
      answer();

      await renderApp({ route: "/" });

      expect(await screen.findByText("Encara no hi ha cap baixada.")).toBeVisible();
    });

    it("offers a retry when the list cannot be loaded", async () => {
      answer();
      server.use(
        http.get("/api/downloads", ({ request }) =>
          new URL(request.url).searchParams.get("status") === "completed"
            ? HttpResponse.json({ detail: "Sense historial" }, { status: 500 })
            : HttpResponse.json([]),
        ),
      );

      await renderApp({ route: "/" });

      expect(await screen.findByRole("alert")).toHaveTextContent("Sense historial");
    });
  });
});
