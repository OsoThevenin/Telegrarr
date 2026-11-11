import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyCatalog } from "@/screens/channels/catalog/test-data";
import type { Channel } from "@/screens/channels/channel";
import { HISTORY_REFRESH_MS } from "@/screens/channels/queries";
import { channel } from "@/screens/channels/test-data";
import { emitSnapshot } from "@/test/event-stream";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";

const serveChannels = (rows: unknown[]) => server.use(http.get("/api/channels", () => HttpResponse.json(rows)));

const openChannels = async (route = "/channels") => {
  const app = await renderApp({ route });
  await screen.findByRole("list", { name: "Canals" });
  return app;
};

/** The button that opens a card: its name runs on past the title, into the card's meta line. */
const cardName = (title: string) => new RegExp(`${title}\\s*\\S`);
const cardButton = (title: string) => screen.getByRole("button", { name: cardName(title) });
const queryCardButton = (title: string) => screen.queryByRole("button", { name: cardName(title) });

describe("grid", () => {
  const cardTitles = () =>
    within(screen.getByRole("list", { name: "Canals" }))
      .getAllByRole("article")
      .map((card) => card.querySelector("[title]")?.textContent);

  it("lists series and movies together, in alphabetical order", async () => {
    serveChannels([
      channel({ id: 1, title: "Sèries CAT", kind: "tv" }),
      channel({ id: 2, title: "cinema Club", kind: "movie" }),
      channel({ id: 3, title: "Àlbum", kind: "tv" }),
      channel({ id: 4, title: "Bones", kind: "movie" }),
    ]);

    await openChannels();

    expect(cardTitles()).toEqual(["Àlbum", "Bones", "cinema Club", "Sèries CAT"]);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("says on each card whether it is a series or a movie, and leaves the kind out of its meta line", async () => {
    serveChannels([
      channel({ id: 1, title: "Sèries CAT", kind: "tv", weekdays: "0,1,2,3,4,5,6", poll_minutes: 30 }),
      channel({ id: 2, title: "Cinema Club", kind: "movie" }),
    ]);

    await openChannels();

    const series = within(cardButton("Sèries CAT"));
    expect(series.getByText("Sèrie")).toBeVisible();
    expect(series.getByText("cada dia · 30 min")).toBeVisible();
    expect(within(cardButton("Cinema Club")).getByText("Pel·lícula")).toBeVisible();
    expect(screen.getAllByText("Sèrie")).toHaveLength(1);
  });

  it("counts a show fed by several sources as one card", async () => {
    serveChannels([
      channel({ id: 1, title: "Font A", imdb_id: "tt1", imdb_title: "Dark" }),
      channel({ id: 2, title: "Font B", imdb_id: "tt1", imdb_title: "Dark", poll_minutes: 90 }),
    ]);
    server.use(http.get("/api/art", () => HttpResponse.json({})));

    await openChannels();

    expect(screen.getAllByRole("article")).toHaveLength(1);
    const card = within(cardButton("Dark"));
    expect(card.getByText("2 canals")).toBeVisible();
    expect(card.getByText("Horaris diversos")).toBeVisible();
  });

  it("keeps a channel of an unknown kind reachable, under its own kind", async () => {
    serveChannels([channel({ id: 1, title: "Antic", kind: "other" })]);

    await openChannels();

    expect(within(cardButton("Antic")).getByText("other")).toBeVisible();
  });

  it("marks a card whose every source is off", async () => {
    serveChannels([channel({ id: 1, title: "Apagat", enabled: 0 }), channel({ id: 2, title: "Encès" })]);

    await openChannels();

    expect(within(cardButton("Apagat")).getByText("Desactivat")).toBeVisible();
    expect(within(cardButton("Encès")).queryByText("Desactivat")).not.toBeInTheDocument();
  });

  it("still opens from an old link to the movies tab, with every channel", async () => {
    serveChannels([channel({ id: 1, title: "Sèries CAT", kind: "tv" }), channel({ id: 2, title: "Cinema Club", kind: "movie" })]);

    await openChannels("/channels?tab=movies");

    expect(cardButton("Sèries CAT")).toBeVisible();
    expect(cardButton("Cinema Club")).toBeVisible();
  });
});

describe("card image", () => {
  const POSTER = "https://image.tmdb.org/poster.jpg";
  const PHOTO = "/api/channels/1/photo";
  const posterOf = (title: string) => cardButton(title).querySelector("img");
  /** What the backend answers for a channel with no photo: the browser reports a failed image. */
  const photoIsMissing = (title: string) => fireEvent.error(posterOf(title) as HTMLImageElement);

  it("prefers the channel's Telegram photo over the TMDB poster", async () => {
    serveChannels([channel({ id: 1, imdb_id: "tt1", imdb_title: "Dark" })]);
    const art = vi.fn(() => HttpResponse.json({ poster: POSTER }));
    server.use(http.get("/api/art", art));

    await openChannels();
    await waitFor(() => expect(art).toHaveBeenCalled());

    await waitFor(() => expect(posterOf("Dark")).toHaveAttribute("src", PHOTO));
  });

  it("falls back to the TMDB poster, then to initials, when the images fail", async () => {
    serveChannels([channel({ id: 1, imdb_id: "tt1", imdb_title: "Dark" })]);
    server.use(http.get("/api/art", () => HttpResponse.json({ poster: POSTER })));

    await openChannels();
    photoIsMissing("Dark");

    await waitFor(() => expect(posterOf("Dark")).toHaveAttribute("src", POSTER));

    fireEvent.error(posterOf("Dark") as HTMLImageElement);

    expect(posterOf("Dark")).toBeNull();
    expect(within(screen.getByRole("article")).getByText("D")).toBeInTheDocument();
  });

  it("shows the Telegram photo in the Sheet too", async () => {
    serveChannels([channel({ id: 1, title: "Sèries CAT" })]);
    server.use(http.get("/api/downloads", () => HttpResponse.json([])));

    const { user } = await openChannels();
    await user.click(cardButton("Sèries CAT"));

    const sheet = await screen.findByRole("dialog");
    expect(sheet.querySelector("img")).toHaveAttribute("src", PHOTO);
  });

  it("shows the TMDB poster of the mapping when there is no photo", async () => {
    serveChannels([channel({ id: 1, imdb_id: "tt1", imdb_title: "Dark" })]);
    server.use(
      http.get("/api/art", ({ request }) =>
        HttpResponse.json({ poster: new URL(request.url).searchParams.get("imdb") === "tt1" ? POSTER : null }),
      ),
    );

    await openChannels();
    photoIsMissing("Dark");

    await waitFor(() => expect(posterOf("Dark")).toHaveAttribute("src", POSTER));
  });

  it("shows the first Catalog poster of a movie channel", async () => {
    serveChannels([channel({ id: 7, title: "Cinema Club", kind: "movie" })]);
    server.use(
      http.get("/api/channels/7/catalog", () =>
        HttpResponse.json({ rows: [{ tmdb_id: 11 }, { title: "sense identificar" }, { tmdb_id: 22 }] }),
      ),
      http.get("/api/channels/7/catalog/posters", ({ request }) =>
        new URL(request.url).searchParams.getAll("ids").join() === "11,22"
          ? HttpResponse.json({ posters: { 11: null, 22: POSTER } })
          : HttpResponse.json({ posters: {} }),
      ),
    );

    await openChannels();
    photoIsMissing("Cinema Club");

    await waitFor(() => expect(posterOf("Cinema Club")).toHaveAttribute("src", POSTER));
  });

  it("falls back to initials for a channel with no art", async () => {
    serveChannels([channel({ id: 1, title: "Sèries Clàssiques" })]);

    await openChannels();
    photoIsMissing("Sèries Clàssiques");

    expect(within(screen.getByRole("article")).getByText("SC")).toBeInTheDocument();
    expect(posterOf("Sèries Clàssiques")).toBeNull();
  });

  it("falls back to initials when the art lookup fails", async () => {
    serveChannels([channel({ id: 1, imdb_id: "tt1", imdb_title: "Dark" })]);
    const lookedUp = vi.fn(() => HttpResponse.json({ detail: "boom" }, { status: 502 }));
    server.use(http.get("/api/art", lookedUp));

    await openChannels();

    await waitFor(() => expect(lookedUp).toHaveBeenCalled());
    photoIsMissing("Dark");

    expect(within(screen.getByRole("article")).getByText("D")).toBeInTheDocument();
    expect(posterOf("Dark")).toBeNull();
  });

});

describe("card actions", () => {
  const DARK = { imdb_id: "tt1", imdb_title: "Dark" };
  const OK = { ok: true };

  const noArt = () => server.use(http.get("/api/art", () => HttpResponse.json({})));

  it("scans every source, one by one, from a button that is always on the card", async () => {
    serveChannels([channel({ id: 1, title: "Font A", ...DARK }), channel({ id: 2, title: "Font B", ...DARK })]);
    noArt();
    const scanned: unknown[] = [];
    server.use(
      http.post("/api/channels/:id/scan", ({ params }) => {
        scanned.push(params.id);
        return HttpResponse.json(OK);
      }),
    );

    const { user } = await openChannels();
    await user.click(screen.getByRole("button", { name: "Escaneja Dark" }));

    expect(await screen.findByText("S’estan escanejant 2 canals")).toBeVisible();
    expect(scanned).toEqual(["1", "2"]);
  });

  it("reports a refused scan by source, after trying the others", async () => {
    serveChannels([channel({ id: 1, title: "Font A", ...DARK }), channel({ id: 2, title: "Font B", ...DARK })]);
    noArt();
    const secondScan = vi.fn(() => HttpResponse.json(OK));
    server.use(
      http.post("/api/channels/1/scan", () =>
        HttpResponse.json({ detail: { key: "err.channel.scanning_off" } }, { status: 409 }),
      ),
      http.post("/api/channels/2/scan", secondScan),
    );

    const { user } = await openChannels();
    await user.click(screen.getByRole("button", { name: "Escaneja Dark" }));

    expect(await screen.findByText(/^Font A: L’escaneig d’aquest canal està desactivat/)).toBeVisible();
    expect(secondScan).toHaveBeenCalled();
  });

  it("has no menu: the card opens its Sheet, and scans", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club" })]);

    await openChannels();

    const card = within(screen.getByRole("article"));
    expect(card.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? "card")).toEqual([
      "card",
      "Escaneja Cinema Club",
    ]);
    expect(screen.queryByRole("button", { name: /^Accions/ })).not.toBeInTheDocument();
  });
});

describe("Sheet", () => {
  const DARK = { imdb_id: "tt1", imdb_title: "Dark", tmdb_id: 70523, tvdb_id: 334824 };
  const ART = { overview: "Una ciutat alemanya.", year: "2017", rating: 8.7 };
  const OK = { ok: true };

  const serveArt = () => server.use(http.get("/api/art", () => HttpResponse.json(ART)));
  const serveDownloads = (rows: unknown[]) =>
    server.use(http.get("/api/downloads", () => HttpResponse.json(rows)));
  const download = (id: number, channelId: number, fields: object) => ({
    id,
    channel_id: channelId,
    status: "completed",
    save_path: "",
    file_name: `fitxer-${id}.mkv`,
    file_size: 0,
    finished_at: id,
    ...fields,
  });

  const openSheet = async (title: string) => {
    const app = await openChannels();
    await app.user.click(cardButton(title));
    return { ...app, sheet: await screen.findByRole("dialog") };
  };

  it("shows the details of a series channel", async () => {
    serveChannels([channel({ id: 1, title: "Font A", ...DARK })]);
    serveArt();
    serveDownloads([]);

    const { sheet } = await openSheet("Dark");

    expect(within(sheet).getByRole("heading", { name: "Dark" })).toBeVisible();
    expect(await within(sheet).findByText("Una ciutat alemanya.")).toBeVisible();
    expect(within(sheet).getByText(/2017 · Sèrie · ★ 8.7 · tt1/)).toBeVisible();
    expect(within(sheet).getByText("Actual: Dark (TVDB 334824 · TMDB 70523 · IMDb tt1)")).toBeVisible();
    expect(within(sheet).getByRole("listitem")).toHaveTextContent("Font A");
  });

  it("opens a movie channel with room for its Catalog, and asks for no downloads", async () => {
    serveChannels([channel({ id: 7, title: "Cinema Club", kind: "movie" })]);
    server.use(...emptyCatalog(7));
    const downloads = vi.fn(() => HttpResponse.json([]));
    server.use(http.get("/api/downloads", downloads));

    const { user } = await openChannels();
    await user.click(cardButton("Cinema Club"));

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Catàleg" })).toBeVisible();
    expect(downloads).not.toHaveBeenCalled();
  });

  it("closes on Escape and gives focus back to the card", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club" })]);
    serveDownloads([]);

    const { user } = await openSheet("Cinema Club");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(cardButton("Cinema Club")).toHaveFocus());
  });

  it("closes from its own button", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club" })]);
    serveDownloads([]);

    const { user, sheet } = await openSheet("Cinema Club");
    await user.click(within(sheet).getByRole("button", { name: "Tanca" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps focus inside while it is open", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club" })]);
    serveDownloads([]);

    const { user, sheet } = await openSheet("Cinema Club");

    await waitFor(() => expect(sheet).toContainElement(document.activeElement as HTMLElement));
    for (const _ of Array.from({ length: 10 })) {
      await user.tab();
      expect(sheet).toContainElement(document.activeElement as HTMLElement);
    }
  });

  describe("actions", () => {
    const buttonNames = (element: HTMLElement) =>
      within(element)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    const sourceRow = (sheet: HTMLElement, label: string) =>
      within(sheet)
        .getAllByRole("listitem")
        .find((row) => row.textContent?.includes(label)) as HTMLElement;

    it("offers every action of a single-channel show", async () => {
      serveChannels([channel({ id: 1, title: "Cinema Club" })]);
      serveDownloads([]);

      const { sheet } = await openSheet("Cinema Club");

      expect(within(sheet).getByRole("button", { name: "Escaneja" })).toBeVisible();
      expect(within(sheet).getByRole("button", { name: "Recupera l’historial" })).toBeVisible();
      expect(buttonNames(sourceRow(sheet, "Cinema Club"))).toEqual(["Desactiva", "Edita", "Elimina el canal"]);
      expect(within(sheet).queryByRole("button", { name: "Desactiva tots els canals" })).not.toBeInTheDocument();
    });

    it("offers every action of a show with several sources, each source on its own row", async () => {
      serveChannels([channel({ id: 1, title: "Font A", ...DARK }), channel({ id: 2, title: "Font B", ...DARK })]);
      serveArt();
      serveDownloads([]);

      const { sheet } = await openSheet("Dark");

      expect(within(sheet).getByRole("button", { name: "Escaneja" })).toBeVisible();
      expect(within(sheet).getByRole("button", { name: "Recupera l’historial" })).toBeVisible();
      expect(within(sheet).getByRole("button", { name: "Desactiva tots els canals" })).toBeVisible();
      expect(within(sheet).getByRole("heading", { name: "2 canals" })).toBeVisible();
      for (const label of ["Font A", "Font B"]) {
        expect(buttonNames(sourceRow(sheet, label))).toEqual(["Desactiva", "Edita", "Elimina el canal"]);
      }
    });

    it("starts a history backfill of every source", async () => {
      serveChannels([channel({ id: 1, title: "Font A", ...DARK }), channel({ id: 2, title: "Font B", ...DARK })]);
      serveArt();
      serveDownloads([]);
      const backfilled: unknown[] = [];
      server.use(
        http.post("/api/channels/:id/backfill", ({ params }) => {
          backfilled.push(params.id);
          return HttpResponse.json(OK);
        }),
      );

      const { user, sheet } = await openSheet("Dark");
      await user.click(within(sheet).getByRole("button", { name: "Recupera l’historial" }));

      expect(await screen.findByText("S’ha començat a recuperar l’historial")).toBeVisible();
      expect(backfilled).toEqual(["1", "2"]);
    });

    it("disables every source of a show while any is on, and the card follows", async () => {
      let rows = [channel({ id: 1, enabled: 1, ...DARK }), channel({ id: 2, enabled: 0, ...DARK })];
      serveArt();
      serveDownloads([]);
      server.use(
        http.get("/api/channels", () => HttpResponse.json(rows)),
        http.patch("/api/channels/:id", async ({ params, request }) => {
          const { enabled } = (await request.json()) as { enabled: number };
          rows = rows.map((row) => (row.id === Number(params.id) ? { ...row, enabled } : row));
          return HttpResponse.json(OK);
        }),
      );

      const { user, sheet } = await openSheet("Dark");
      await user.click(within(sheet).getByRole("button", { name: "Desactiva tots els canals" }));

      expect(await within(sheet).findByRole("button", { name: "Activa tots els canals" })).toBeVisible();
      expect(rows.map(({ enabled }) => enabled)).toEqual([0, 0]);
      expect(within(screen.getByRole("article", { hidden: true })).getByText("Desactivat")).toBeInTheDocument();
    });

    it("removes a channel only after the AlertDialog agrees", async () => {
      let rows = [channel({ id: 1, title: "Cinema Club" }), channel({ id: 2, title: "Altres" })];
      const removed = vi.fn(() => {
        rows = rows.filter(({ id }) => id !== 1);
        return HttpResponse.json(OK);
      });
      serveDownloads([]);
      server.use(
        http.get("/api/channels", () => HttpResponse.json(rows)),
        http.delete("/api/channels/1", removed),
      );

      const { user, sheet } = await openSheet("Cinema Club");
      const askToRemove = async () => {
        await user.click(within(sheet).getByRole("button", { name: "Elimina el canal" }));
        return screen.findByRole("alertdialog");
      };

      await user.click(within(await askToRemove()).getByRole("button", { name: "Cancel·la" }));
      expect(removed).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

      const dialog = await askToRemove();
      expect(dialog).toHaveTextContent("Vols eliminar aquest canal?");
      await user.click(within(dialog).getByRole("button", { name: "Elimina" }));

      expect(await screen.findByText("S’ha eliminat el canal")).toBeVisible();
      await waitFor(() => expect(queryCardButton("Cinema Club")).not.toBeInTheDocument());
      expect(removed).toHaveBeenCalledOnce();
    });
  });

  it("lists the downloads it fetched itself: this show's only, newest first", async () => {
    serveChannels([
      channel({ id: 1, title: "Font A", ...DARK }),
      channel({ id: 2, title: "Font B", ...DARK }),
      channel({ id: 3, title: "Altre" }),
    ]);
    serveArt();
    let asked = "";
    server.use(
      http.get("/api/downloads", ({ request }) => {
        asked = new URL(request.url).search;
        return HttpResponse.json([
          download(1, 1, { save_path: "/media/Dark/S01E01.mkv", file_size: 1500000000, finished_at: 10 }),
          download(2, 2, { file_name: "S01E02.mkv", finished_at: 20 }),
          download(3, 3, { file_name: "d'un altre canal.mkv" }),
        ]);
      }),
    );

    const { sheet } = await openSheet("Dark");

    expect(await within(sheet).findByRole("heading", { name: "2 episodis baixats" })).toBeVisible();
    expect(asked).toContain("status=completed");
    const episodes = within(within(sheet).getByRole("list", { name: "2 episodis baixats" })).getAllByRole("listitem");
    expect(episodes.map((row) => row.textContent)).toEqual(["S01E02.mkv", "S01E01.mkv1.50 GB"]);
    expect(within(sheet).queryByText("d'un altre canal.mkv")).not.toBeInTheDocument();
  });

  it("says so when no episode has been downloaded", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club" })]);
    serveDownloads([]);

    const { sheet } = await openSheet("Cinema Club");

    expect(await within(sheet).findByText("Encara no hi ha cap baixada.")).toBeVisible();
  });

  it("does not pass a failed downloads request off as no downloads", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club" })]);
    server.use(http.get("/api/downloads", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    const { sheet } = await openSheet("Cinema Club");

    expect(await within(sheet).findByText("boom")).toBeVisible();
    expect(within(sheet).queryByText("Encara no hi ha cap baixada.")).not.toBeInTheDocument();
  });

  it("scans from inside and reports it there", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club" })]);
    serveDownloads([]);
    server.use(http.post("/api/channels/1/scan", () => HttpResponse.json(OK)));

    const { user, sheet } = await openSheet("Cinema Club");
    await user.click(within(sheet).getByRole("button", { name: "Escaneja" }));

    expect(await screen.findByText("S’està escanejant 1 canal")).toBeVisible();
  });

  it("turns one source off without touching the others", async () => {
    let rows = [channel({ id: 1, title: "Font A", ...DARK }), channel({ id: 2, title: "Font B", ...DARK })];
    serveArt();
    serveDownloads([]);
    server.use(
      http.get("/api/channels", () => HttpResponse.json(rows)),
      http.patch("/api/channels/2", () => {
        rows = rows.map((row) => (row.id === 2 ? { ...row, enabled: 0 } : row));
        return HttpResponse.json(OK);
      }),
    );

    const { user, sheet } = await openSheet("Dark");
    const row = within(sheet).getByText("Font B").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Desactiva" }));

    expect(await within(row).findByRole("button", { name: "Activa" })).toBeVisible();
    const other = within(sheet).getByText("Font A").closest("li") as HTMLElement;
    expect(within(other).getByRole("button", { name: "Desactiva" })).toBeVisible();
  });

  describe("scanning", () => {
    const STOPPED = "Escaneig aturat";
    const REFUSED = /^Canal 1: L’escaneig d’aquest canal està desactivat/;

    /** A channel list that keeps what a PATCH sends, and a record of those. */
    const serveScanning = (scanning: number) => {
      let row = channel({ id: 1, scanning });
      const sent: unknown[] = [];
      server.use(
        http.get("/api/channels", () => HttpResponse.json([row])),
        http.patch("/api/channels/1", async ({ request }) => {
          const body = (await request.json()) as { scanning: boolean };
          sent.push(body);
          row = { ...row, scanning: Number(body.scanning) };
          return HttpResponse.json(row);
        }),
      );
      serveDownloads([]);
      return sent;
    };

    const scanningRefused = (path: string) =>
      server.use(
        http.post(path, () => HttpResponse.json({ detail: { key: "err.channel.scanning_off" } }, { status: 409 })),
      );

    it("turns off with a real boolean, and the card and the Sheet follow", async () => {
      const sent = serveScanning(1);

      const { user, sheet } = await openSheet("Canal 1");
      const toggle = within(sheet).getByRole("switch", { name: "Escaneig" });
      expect(toggle).toBeChecked();
      expect(within(sheet).queryByText(STOPPED)).not.toBeInTheDocument();

      await user.click(toggle);

      expect(await within(sheet).findByText(STOPPED)).toBeVisible();
      expect(toggle).not.toBeChecked();
      expect(sent).toEqual([{ scanning: false }]);
      expect(within(screen.getByRole("article", { hidden: true })).getByText(STOPPED)).toBeInTheDocument();
    });

    it("turns back on from the keyboard", async () => {
      const sent = serveScanning(0);

      const { user, sheet } = await openSheet("Canal 1");
      const toggle = within(sheet).getByRole("switch", { name: "Escaneig" });
      act(() => toggle.focus());
      await user.keyboard(" ");

      await waitFor(() => expect(within(sheet).queryByText(STOPPED)).not.toBeInTheDocument());
      expect(toggle).toBeChecked();
      expect(sent).toEqual([{ scanning: true }]);
    });

    it("goes back and says why when the change is refused", async () => {
      serveChannels([channel({ id: 1 })]);
      serveDownloads([]);
      server.use(http.patch("/api/channels/1", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

      const { user, sheet } = await openSheet("Canal 1");
      const toggle = within(sheet).getByRole("switch", { name: "Escaneig" });
      await user.click(toggle);

      expect(await screen.findByText("Canal 1: boom")).toBeVisible();
      await waitFor(() => expect(toggle).toBeChecked());
    });

    it("explains a refused Scan, from the Sheet", async () => {
      serveScanning(0);
      scanningRefused("/api/channels/1/scan");

      const { user, sheet } = await openSheet("Canal 1");
      await user.click(within(sheet).getByRole("button", { name: "Escaneja" }));

      expect(await screen.findByText(REFUSED)).toBeVisible();
    });

    it("explains a refused history fetch, from the Sheet", async () => {
      serveScanning(0);
      scanningRefused("/api/channels/1/backfill");

      const { user, sheet } = await openSheet("Canal 1");
      await user.click(within(sheet).getByRole("button", { name: "Recupera l’historial" }));

      expect(await screen.findByText(REFUSED)).toBeVisible();
    });

    it("marks a show only when none of its sources is scanned", async () => {
      serveChannels([
        channel({ id: 1, title: "Font A", scanning: 0, ...DARK }),
        channel({ id: 2, title: "Font B", ...DARK }),
        channel({ id: 3, title: "Aturat", scanning: 0 }),
      ]);
      serveArt();

      await openChannels();

      expect(within(cardButton("Dark")).queryByText(STOPPED)).not.toBeInTheDocument();
      expect(within(cardButton("Aturat")).getByText(STOPPED)).toBeVisible();
    });
  });

  describe("history progress", () => {
    const history = (fields: Partial<Channel["history"]>) => ({
      read: 0,
      total_estimate: null,
      complete: false,
      next_batch_at: null,
      ...fields,
    });
    const inSeconds = (seconds: number) => Math.round(Date.now() / 1000) + seconds;
    const READ = 12345;
    const TOTAL = 50000;
    const QUARTER = 25;
    /** Under the live updates' silence limit, past which their watchdog refetches the list by itself. */
    const STREAM_BEAT_MS = 3000;

    /** Lets time pass with a healthy stream, which says nothing about history batches. */
    const passTimeOnALiveStream = async (ms: number) => {
      for (let passed = 0; passed < ms; passed += STREAM_BEAT_MS) {
        emitSnapshot();
        await act(() => vi.advanceTimersByTimeAsync(STREAM_BEAT_MS));
      }
    };

    const openWith = (fields: Partial<Channel["history"]>) => {
      serveChannels([channel({ id: 1, history: history(fields) })]);
      serveDownloads([]);
      return openSheet("Canal 1");
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows what was read, the estimate and when the next batch runs", async () => {
      const { sheet } = await openWith({ read: READ - 3000, total_estimate: TOTAL, next_batch_at: inSeconds(180) });

      expect(within(sheet).getByText("9.345 de ~50.000 missatges llegits")).toBeVisible();
      expect(within(sheet).getByText("Proper lot: d’aquí a 3 min")).toBeVisible();
      expect(within(sheet).getByRole("progressbar", { name: "Historial" })).toHaveAttribute(
        "aria-valuenow",
        String(19),
      );
    });

    it("says the next batch is due once its time has passed", async () => {
      const { sheet } = await openWith({ read: 200, next_batch_at: inSeconds(-5) });

      expect(within(sheet).getByText("Proper lot: imminent")).toBeVisible();
    });

    it("counts what was read while Telegram gave no estimate, with no bar", async () => {
      const { sheet } = await openWith({ read: 1, next_batch_at: inSeconds(180) });

      expect(within(sheet).getByText("1 missatge llegit")).toBeVisible();
      expect(within(sheet).queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("says a history is complete, with no next batch", async () => {
      const { sheet } = await openWith({ read: READ, total_estimate: READ, complete: true });

      expect(within(sheet).getByText("Complet")).toBeVisible();
      expect(within(sheet).getByText("12.345 missatges llegits")).toBeVisible();
      expect(within(sheet).queryByRole("progressbar")).not.toBeInTheDocument();
      expect(within(sheet).queryByText(/^Proper lot/)).not.toBeInTheDocument();
    });

    it("keeps what was read, with no next batch, while scanning is off", async () => {
      serveChannels([channel({ id: 1, scanning: 0, history: history({ read: READ, total_estimate: TOTAL }) })]);
      serveDownloads([]);

      const { sheet } = await openSheet("Canal 1");

      expect(within(sheet).getByText("12.345 de ~50.000 missatges llegits")).toBeVisible();
      expect(within(sheet).queryByText(/^Proper lot/)).not.toBeInTheDocument();
    });

    it("shows nothing before a history has started", async () => {
      const { sheet } = await openWith({});

      expect(within(sheet).queryByText("Historial")).not.toBeInTheDocument();
    });

    it("follows the batches while one is coming, and stops when the history ends", async () => {
      let progress = history({ read: QUARTER, total_estimate: 100, next_batch_at: inSeconds(60) });
      const read = vi.fn(() => HttpResponse.json([channel({ id: 1, history: progress })]));
      server.use(http.get("/api/channels", read));
      serveDownloads([]);
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const { sheet } = await openSheet("Canal 1");
      expect(within(sheet).getByText("25 de ~100 missatges llegits")).toBeVisible();

      progress = { ...progress, read: 50 };
      await passTimeOnALiveStream(HISTORY_REFRESH_MS);

      expect(await within(sheet).findByText("50 de ~100 missatges llegits")).toBeVisible();

      progress = { ...progress, read: 100, complete: true, next_batch_at: null };
      await passTimeOnALiveStream(HISTORY_REFRESH_MS);

      expect(await within(sheet).findByText("Complet")).toBeVisible();
      const reads = read.mock.calls.length;

      await passTimeOnALiveStream(2 * HISTORY_REFRESH_MS);

      expect(read).toHaveBeenCalledTimes(reads);
    });
  });

  it("removes one source of several through an AlertDialog and stays open", async () => {
    let rows = [channel({ id: 1, title: "Font A", ...DARK }), channel({ id: 2, title: "Font B", ...DARK })];
    serveArt();
    serveDownloads([]);
    server.use(
      http.get("/api/channels", () => HttpResponse.json(rows)),
      http.delete("/api/channels/2", () => {
        rows = rows.filter(({ id }) => id !== 2);
        return HttpResponse.json(OK);
      }),
    );

    const { user, sheet } = await openSheet("Dark");
    const row = within(sheet).getByText("Font B").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Elimina el canal" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Vols eliminar aquest canal?");
    await user.click(within(dialog).getByRole("button", { name: "Elimina" }));

    expect(await screen.findByText("S’ha eliminat el canal")).toBeVisible();
    await waitFor(() => expect(within(sheet).queryByText("Font B")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("closes when its only source is removed, and leaves focus on the page", async () => {
    let rows = [channel({ id: 1, title: "Cinema Club" }), channel({ id: 2, title: "Altres" })];
    serveDownloads([]);
    server.use(
      http.get("/api/channels", () => HttpResponse.json(rows)),
      http.delete("/api/channels/1", () => {
        rows = rows.filter(({ id }) => id !== 1);
        return HttpResponse.json(OK);
      }),
    );

    const { user, sheet } = await openSheet("Cinema Club");
    await user.click(within(sheet).getByRole("button", { name: "Elimina el canal" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Elimina" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.body).not.toHaveFocus());
    expect(queryCardButton("Cinema Club")).not.toBeInTheDocument();
  });
});

describe("edit dialog", () => {
  const SHEET_EDIT = "Edita";

  beforeEach(() => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ settings: { tmdb_key_set: true } })),
      http.get("/api/downloads", () => HttpResponse.json([])),
      http.get("/api/art", () => HttpResponse.json({})),
    );
  });

  const servePatch =(reply: () => Response = () => HttpResponse.json({ ok: true })) => {
    const bodies: unknown[] = [];
    server.use(
      http.patch("/api/channels/:id", async ({ request }) => {
        bodies.push(await request.json());
        return reply();
      }),
    );
    return bodies;
  };

  /** Through the Sheet of the show's card, which is how an edit is reached. */
  const openEdit = async (title = "Cinema Club") => {
    const app = await openChannels();
    await app.user.click(cardButton(title));
    const sheet = await screen.findByRole("dialog");
    await app.user.click(within(sheet).getByRole("button", { name: SHEET_EDIT }));
    return { ...app, dialog: await screen.findByRole("dialog", { name: "Edita el canal" }) };
  };

  const saveButton = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Desa" });

  it("shows the channel's current settings", async () => {
    serveChannels([
      channel({
        id: 1,
        title: "Cinema Club",
        language: "es",
        fallback_quality: "720p",
        weekdays: "0,6",
        poll_minutes: 45,
      }),
    ]);

    const { dialog } = await openEdit();

    expect(within(dialog).getByLabelText("Canal de Telegram")).toHaveValue("Cinema Club");
    expect(within(dialog).getByLabelText("Canal de Telegram")).toBeDisabled();
    expect(within(dialog).getByLabelText("Tipus")).toHaveValue("tv");
    expect(within(dialog).getByLabelText("Idioma de l’àudio")).toHaveValue("es");
    expect(within(dialog).getByLabelText(/^Qualitat per defecte/)).toHaveValue("720p");
    expect(within(dialog).getByLabelText("Interval de consulta (minuts)")).toHaveValue(45);
    expect(within(dialog).getByRole("button", { name: "Dl" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "Dt" })).toHaveAttribute("aria-pressed", "false");
    expect(within(dialog).getByRole("button", { name: "Dg" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves the changes, says so and goes back to the Sheet's Edit button", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club", weekdays: "0,1" })]);
    const bodies = servePatch();

    const { user, dialog } = await openEdit();
    await user.selectOptions(within(dialog).getByLabelText("Idioma de l’àudio"), "en");
    await user.selectOptions(within(dialog).getByLabelText("Tipus"), "movie");
    await user.click(within(dialog).getByRole("button", { name: "Dt" }));
    await user.click(within(dialog).getByRole("button", { name: "Dv" }));
    await user.clear(within(dialog).getByLabelText("Interval de consulta (minuts)"));
    await user.type(within(dialog).getByLabelText("Interval de consulta (minuts)"), "60");
    await user.click(saveButton(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edita el canal" })).not.toBeInTheDocument());
    expect(bodies).toEqual([
      { kind: "movie", language: "en", fallback_quality: "1080p", weekdays: "0,4", poll_minutes: 60 },
    ]);
    expect(await screen.findByText("S’ha actualitzat el canal")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: SHEET_EDIT })).toHaveFocus());
  });

  it("reads a channel with every day turned off as every day", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club", weekdays: "2" })]);
    const bodies = servePatch();

    const { user, dialog } = await openEdit();
    await user.click(within(dialog).getByRole("button", { name: "Dc" }));
    await user.click(saveButton(dialog));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ weekdays: "0,1,2,3,4,5,6" });
  });

  it("keeps a kind this release does not know", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club", kind: "other" })]);
    const bodies = servePatch();

    const { user, dialog } = await openEdit();
    await user.click(saveButton(dialog));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ kind: "other" });
  });

  it("stays open with the reason when saving fails", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club" })]);
    servePatch(() => HttpResponse.json({ detail: "boom" }, { status: 500 }));

    const { user, dialog } = await openEdit();
    await user.click(saveButton(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("dialog", { name: "Edita el canal" })).toBeVisible();
  });

  it("sends nothing on cancel and goes back to the Sheet's Edit button", async () => {
    serveChannels([channel({ id: 1, title: "Cinema Club" })]);
    const bodies = servePatch();

    const { user, dialog } = await openEdit();
    await user.click(within(dialog).getByRole("button", { name: "Cancel·la" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edita el canal" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: SHEET_EDIT })).toHaveFocus());
    expect(bodies).toEqual([]);
  });

  it("keeps the Sheet with the channel when an edit turns it into a movie channel", async () => {
    const rows = (kind: string) => [channel({ id: 1, title: "Cinema Club", kind })];
    let kind = "tv";
    server.use(
      http.get("/api/channels", () => HttpResponse.json(rows(kind))),
      http.get("/api/downloads", () => HttpResponse.json([])),
      ...emptyCatalog(1),
      http.patch("/api/channels/1", () => {
        kind = "movie";
        return HttpResponse.json({ ok: true });
      }),
    );

    const { user } = await openChannels();
    await user.click(cardButton("Cinema Club"));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Edita" }));
    const dialog = await screen.findByRole("dialog", { name: "Edita el canal" });
    await user.selectOptions(within(dialog).getByLabelText("Tipus"), "movie");
    await user.click(saveButton(dialog));

    expect(await within(sheet).findByRole("heading", { name: "Catàleg" })).toBeVisible();
  });

  it("edits one source from the Sheet and goes back to it", async () => {
    const DARK = { imdb_id: "tt1", imdb_title: "Dark" };
    serveChannels([channel({ id: 1, title: "Font A", ...DARK }), channel({ id: 2, title: "Font B", ...DARK })]);
    server.use(
      http.get("/api/art", () => HttpResponse.json({})),
      http.get("/api/downloads", () => HttpResponse.json([])),
    );
    const bodies = servePatch();

    const { user } = await openChannels();
    await user.click(cardButton("Dark"));
    const sheet = await screen.findByRole("dialog");
    const secondEdit = within(sheet).getAllByRole("button", { name: "Edita" })[1];
    await user.click(secondEdit);
    const dialog = await screen.findByRole("dialog", { name: "Edita el canal" });
    expect(within(dialog).getByLabelText("Canal de Telegram")).toHaveValue("Font B");
    await user.click(saveButton(dialog));

    await waitFor(() => expect(bodies).toHaveLength(1));
    await waitFor(() => expect(secondEdit).toHaveFocus());
    expect(screen.getByRole("dialog", { name: /Dark/ })).toBeVisible();
    expect(await screen.findByText("S’ha actualitzat el canal")).toBeVisible();
  });

  describe("series mapping", () => {
    const SERIES_LABEL = "Sèrie (cerca a TMDB)";
    const HIT = { tmdb_id: 1001, title: "Merlí", year: "2015" };

    const serveMapping = (reply: () => Response = () => HttpResponse.json(channel({ id: 1 }))) => {
      const mapped: unknown[] = [];
      server.use(
        http.get("/api/tmdb/search", () => HttpResponse.json([HIT])),
        http.put("/api/channels/1/series", async ({ request }) => {
          mapped.push(await request.json());
          return reply();
        }),
      );
      return mapped;
    };

    const chooseMerli = async ({ user, dialog }: Awaited<ReturnType<typeof openEdit>>) => {
      await user.type(within(dialog).getByLabelText(SERIES_LABEL), "Merlí");
      await user.click(await within(dialog).findByRole("button", { name: /^Merlí \(2015\)/ }));
    };

    it("shows what the source is mapped to", async () => {
      serveChannels([
        channel({ id: 1, title: "Cinema Club", imdb_id: "tt1", imdb_title: "Dark", tmdb_id: 70523, tvdb_id: 334824 }),
      ]);

      const { dialog } = await openEdit("Dark");

      expect(within(dialog).getByLabelText(SERIES_LABEL)).toHaveValue("Dark");
      expect(within(dialog).getByLabelText("Identificador de TVDB")).toHaveValue("334824");
      expect(within(dialog).getByText("Actual: Dark (TVDB 334824 · TMDB 70523 · IMDb tt1)")).toBeVisible();
    });

    it("maps the source to the chosen series as it saves", async () => {
      serveChannels([channel({ id: 1, title: "Cinema Club" })]);
      const bodies = servePatch();
      const mapped = serveMapping();
      const opened = await openEdit();

      await chooseMerli(opened);
      await opened.user.click(saveButton(opened.dialog));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edita el canal" })).not.toBeInTheDocument());
      expect(bodies).toHaveLength(1);
      expect(mapped).toEqual([{ tmdb_id: 1001, tvdb_id: null, title: "Merlí (2015)" }]);
    });

    it("leaves the mapping alone when the series was not touched", async () => {
      serveChannels([channel({ id: 1, title: "Cinema Club", imdb_title: "Dark", tvdb_id: 334824 })]);
      servePatch();
      const mapped = serveMapping();
      const { user, dialog } = await openEdit("Dark");

      await user.click(saveButton(dialog));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edita el canal" })).not.toBeInTheDocument());
      expect(mapped).toEqual([]);
    });

    it("corrects the TVDB id alone", async () => {
      serveChannels([channel({ id: 1, title: "Cinema Club", imdb_title: "Dark", tvdb_id: 334824 })]);
      servePatch();
      const mapped = serveMapping();
      const { user, dialog } = await openEdit("Dark");
      const tvdb = within(dialog).getByLabelText("Identificador de TVDB");

      await user.clear(tvdb);
      await user.type(tvdb, "999");
      await user.click(saveButton(dialog));

      await waitFor(() => expect(mapped).toEqual([{ tmdb_id: null, tvdb_id: "999", title: "" }]));
    });

    it("stays open with the reason when the mapping fails, the settings saved", async () => {
      serveChannels([channel({ id: 1, title: "Cinema Club" })]);
      const bodies = servePatch();
      serveMapping(() => HttpResponse.json({ detail: "Sèrie desconeguda" }, { status: 400 }));
      const opened = await openEdit();

      await chooseMerli(opened);
      await opened.user.click(saveButton(opened.dialog));

      expect(await within(opened.dialog).findByRole("alert")).toHaveTextContent("Sèrie desconeguda");
      expect(bodies).toHaveLength(1);
      expect(screen.queryByText("S’ha actualitzat el canal")).not.toBeInTheDocument();
    });

    it("explains movies instead, and sends them no mapping", async () => {
      serveChannels([channel({ id: 1, title: "Cinema Club" })]);
      servePatch();
      const mapped = serveMapping();
      const opened = await openEdit();
      await chooseMerli(opened);

      await opened.user.selectOptions(within(opened.dialog).getByLabelText("Tipus"), "movie");

      expect(within(opened.dialog).getByText(/Els canals de pel·lícules/)).toBeVisible();
      await opened.user.click(saveButton(opened.dialog));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edita el canal" })).not.toBeInTheDocument());
      expect(mapped).toEqual([]);
    });

    it("offers neither to a kind this release does not know", async () => {
      serveChannels([channel({ id: 1, title: "Cinema Club", kind: "other" })]);

      const { dialog } = await openEdit();

      expect(within(dialog).queryByLabelText(SERIES_LABEL)).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/Els canals de pel·lícules/)).not.toBeInTheDocument();
    });

    it("keeps the Sheet open when the mapping regroups the source under a new show", async () => {
      let row = channel({ id: 1, title: "Cinema Club" });
      server.use(
        http.get("/api/channels", () => HttpResponse.json([row])),
        http.get("/api/downloads", () => HttpResponse.json([])),
        http.get("/api/art", () => HttpResponse.json({})),
      );
      servePatch();
      serveMapping(() => {
        row = channel({ id: 1, title: "Cinema Club", imdb_id: "tt4419684", imdb_title: "Merlí (2015)" });
        return HttpResponse.json(row);
      });

      const app = await openChannels();
      await app.user.click(cardButton("Cinema Club"));
      const sheet = await screen.findByRole("dialog");
      await app.user.click(within(sheet).getByRole("button", { name: "Edita" }));
      const dialog = await screen.findByRole("dialog", { name: "Edita el canal" });
      await chooseMerli({ ...app, dialog });
      await app.user.click(saveButton(dialog));

      expect(await screen.findByRole("dialog", { name: /Merlí \(2015\)/ })).toBeVisible();
    });
  });
});

describe("channel list", () => {
  it("explains an empty list", async () => {
    serveChannels([]);

    await renderApp({ route: "/channels" });

    expect(await screen.findByText("Encara no hi ha cap canal")).toBeVisible();
    expect(screen.queryByRole("list", { name: "Canals" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Afegeix un canal" })).toHaveLength(2);
  });

  it("reports a list that failed to load", async () => {
    server.use(http.get("/api/channels", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    await renderApp({ route: "/channels" });

    expect(await screen.findByText(/boom/)).toBeVisible();
  });
});
