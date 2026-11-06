import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FilmStatus, RadarrFile } from "@/screens/channels/catalog/catalog";
import { CATALOG_REFRESH_MS } from "@/screens/channels/catalog/queries";
import { CHANNEL_ID, film, radarrFile, serveCatalog, unidentified } from "@/screens/channels/catalog/test-data";
import { channel } from "@/screens/channels/test-data";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";

const DOWNLOAD_URL = `/api/channels/${CHANNEL_ID}/catalog/:tmdbId/download`;
const manyFilms = (total: number) => Array.from({ length: total }, (_, index) => film(index + 1));

/** Opens the Sheet of a movie channel, on its Catalog. */
async function openCatalog(fields: Parameters<typeof channel>[0] = { id: CHANNEL_ID }) {
  server.use(
    http.get("/api/channels", () => HttpResponse.json([channel({ title: "Cinema Club", kind: "movie", ...fields })])),
  );
  const app = await renderApp({ route: "/channels" });
  await app.user.click(await screen.findByRole("tab", { name: /^Pel·lícules/ }));
  await app.user.click(screen.getByRole("button", { name: /Cinema Club\s*\S/ }));

  return { ...app, sheet: await screen.findByRole("dialog") };
}

/** A film's row, found by its accordion trigger, whose name runs on into the row's meta line. */
const rowTrigger = (sheet: HTMLElement, title: string) =>
  within(sheet).findByRole("button", { name: new RegExp(`^${title}\\b`) });
const pageLink = (sheet: HTMLElement, page: number) => within(sheet).getByRole("link", { name: `Pàgina ${page}` });
const chip = (sheet: HTMLElement, name: RegExp) => within(sheet).findByRole("button", { name });
const lastPageAsked = (asked: { pages: URLSearchParams[] }) => asked.pages.filter((p) => p.get("limit") === "25").at(-1);

describe("rows", () => {
  it("shows quality, size and language on the collapsed row", async () => {
    serveCatalog([film(1, { title: "Pa negre", quality: "720p", size: 1610612736, language: "CAT" })]);

    const { sheet } = await openCatalog();

    const trigger = await rowTrigger(sheet, "Pa negre");
    expect(trigger).toHaveTextContent("720p");
    expect(trigger).toHaveTextContent("1.5 GB");
    expect(trigger).toHaveTextContent("CAT");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("expands and collapses in place from the keyboard", async () => {
    serveCatalog([film(1, { title: "Pa negre", imdb_id: "tt1302067" })]);

    const { sheet, user } = await openCatalog();
    const trigger = await rowTrigger(sheet, "Pa negre");

    act(() => trigger.focus());
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).getByText("tt1302067")).toBeVisible();

    await user.keyboard(" ");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(within(sheet).queryByText("tt1302067")).not.toBeInTheDocument();
  });

  describe("the file Radarr holds", () => {
    const FILM = film(1, { title: "Pa negre" });
    const held = (file: RadarrFile) => ({
      1: { status: "downloaded" as const, radarr_quality: file.quality ?? undefined, file },
    });
    const detail = (section: HTMLElement, label: string) => within(section).getByText(label).nextSibling;

    it("sums it up on the collapsed row", async () => {
      serveCatalog([FILM], held(radarrFile()));

      const { sheet } = await openCatalog();

      await within(sheet).findByText("Fitxer: Bluray-1080p · 2.5 GB");
      expect(await rowTrigger(sheet, "Pa negre")).toHaveAttribute("aria-expanded", "false");
    });

    it("gives every detail on the expanded row, as Radarr reports them", async () => {
      serveCatalog([FILM], held(radarrFile()));

      const { sheet, user } = await openCatalog();
      await within(sheet).findByText("Fitxer: Bluray-1080p · 2.5 GB");
      await user.click(await rowTrigger(sheet, "Pa negre"));

      const section = within(sheet).getByRole("group", { name: "Fitxer a Radarr" });
      expect(detail(section, "Qualitat")).toHaveTextContent("Bluray-1080p");
      expect(detail(section, "Resolució")).toHaveTextContent("1920x1080");
      expect(detail(section, "Còdec de vídeo")).toHaveTextContent("x265");
      expect(detail(section, "Contenidor")).toHaveTextContent("mkv");
      expect(detail(section, "Àudio")).toHaveTextContent("Català, English");
      expect(detail(section, "Subtítols")).toHaveTextContent("Español");
      expect(detail(section, "Mida")).toHaveTextContent("2.5 GB");
    });

    it("leaves out what Radarr doesn't report", async () => {
      const file = radarrFile({ resolution: null, video_codec: null, subtitle_languages: [] });
      serveCatalog([FILM], held(file));

      const { sheet, user } = await openCatalog();
      await within(sheet).findByText("Fitxer: Bluray-1080p · 2.5 GB");
      await user.click(await rowTrigger(sheet, "Pa negre"));

      const section = within(sheet).getByRole("group", { name: "Fitxer a Radarr" });
      expect(within(section).queryByText("Resolució")).not.toBeInTheDocument();
      expect(within(section).queryByText("Còdec de vídeo")).not.toBeInTheDocument();
      expect(within(section).queryByText("Subtítols")).not.toBeInTheDocument();
    });

    it("also comes with the rows of a status filter", async () => {
      serveCatalog([FILM], held(radarrFile()));

      const { sheet, user } = await openCatalog();
      await user.click(await chip(sheet, /^Baixades/));

      expect(await within(sheet).findByText("Fitxer: Bluray-1080p · 2.5 GB")).toBeVisible();
    });

    it("shows nothing for a film with no file", async () => {
      serveCatalog([FILM], { 1: { status: "missing" } });

      const { sheet, user } = await openCatalog();
      await within(sheet).findByRole("button", { name: "Baixar Pa negre" });
      await user.click(await rowTrigger(sheet, "Pa negre"));

      expect(within(sheet).queryByText(/^Fitxer:/)).not.toBeInTheDocument();
      expect(within(sheet).queryByRole("group", { name: "Fitxer a Radarr" })).not.toBeInTheDocument();
    });
  });

  describe("Open in Radarr", () => {
    const LINK = "https://radarr.example/movie/1";

    it("opens the film in Radarr in a new tab", async () => {
      serveCatalog([film(1, { title: "Pa negre", radarr_link: LINK })]);

      const { sheet, user } = await openCatalog();
      await user.click(await rowTrigger(sheet, "Pa negre"));

      const link = within(sheet).getByRole("link", { name: "Obre Pa negre a Radarr" });
      expect(link).toHaveAttribute("href", LINK);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("is hidden with no Radarr URL set", async () => {
      serveCatalog([film(1, { title: "Pa negre" })]);

      const { sheet, user } = await openCatalog();
      await user.click(await rowTrigger(sheet, "Pa negre"));

      expect(within(sheet).queryByRole("link", { name: /a Radarr$/ })).not.toBeInTheDocument();
    });
  });

  it("offers Download outside the row's own button", async () => {
    serveCatalog([film(1, { title: "Pa negre" })]);

    const { sheet } = await openCatalog();

    const download = await within(sheet).findByRole("button", { name: "Baixar Pa negre" });
    expect((await rowTrigger(sheet, "Pa negre")).contains(download)).toBe(false);
  });

  it("links an unidentified message to Review, and asks no art or status for it", async () => {
    const { asked } = serveCatalog([film(1, { title: "Pa negre" }), unidentified(30, "Pelicula.rara.mkv")]);

    const { sheet, router, user } = await openCatalog();

    expect(await within(sheet).findByText("Pelicula.rara.mkv")).toBeVisible();
    expect(within(sheet).getByText("Cal identificar")).toBeVisible();
    await waitFor(() => expect(asked.posters.at(-1)).toEqual(["1"]));

    await user.click(within(sheet).getByRole("link", { name: "Revisa Pelicula.rara.mkv" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/review"));
  });

  it("drops unidentified messages under a status filter, and brings them back on All", async () => {
    serveCatalog([film(1, { title: "Pa negre" }), unidentified(30, "Pelicula.rara.mkv")]);

    const { sheet, user } = await openCatalog();
    await within(sheet).findByText("Pelicula.rara.mkv");

    await user.click(await chip(sheet, /^Per baixar/));

    await waitFor(() => expect(within(sheet).queryByText("Pelicula.rara.mkv")).not.toBeInTheDocument());
    expect(await rowTrigger(sheet, "Pa negre")).toBeVisible();

    await user.click(await chip(sheet, /^Totes/));

    expect(await within(sheet).findByText("Pelicula.rara.mkv")).toBeVisible();
  });

  it("uses Radarr's poster and asks TMDB only for the films without one", async () => {
    const { asked } = serveCatalog([film(1), film(2)], {
      1: { status: "missing", poster: "https://radarr/1.jpg" } as never,
    });

    const { sheet } = await openCatalog();

    await waitFor(() => expect(asked.posters.at(-1)).toEqual(["2"]));
    const images = (await rowTrigger(sheet, "Film 1")).querySelectorAll("img");
    expect(images[0]).toHaveAttribute("src", "https://radarr/1.jpg");
  });

  it("keeps the tiles when TMDB fails", async () => {
    serveCatalog([film(1)]);
    server.use(
      http.get(`/api/channels/${CHANNEL_ID}/catalog/posters`, () => new HttpResponse(null, { status: 500 })),
    );

    const { sheet } = await openCatalog();

    expect(await rowTrigger(sheet, "Film 1")).toBeVisible();
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Why not grabbed?", () => {
  const WHY_URL = `/api/channels/${CHANNEL_ID}/catalog/1/why-not-grabbed`;
  const BUTTON = "Per què no s’ha agafat?";
  const FILM = film(1, { title: "Pa negre" });
  const REJECTED = "Radarr ha rebutjat les versions del canal d’aquesta pel·lícula.";
  const WOULD_ACCEPT = "Radarr acceptaria la versió del canal: només està esperant, o ja és de camí.";
  const NO_RELEASES = "La cerca de Radarr no ha trobat cap versió de Telegrarr d’aquesta pel·lícula.";
  const REASON = "Quality profile does not allow 1080p";

  const answer = (verdict: string, releases: unknown[] = []) =>
    HttpResponse.json({ tmdb_id: 1, verdict, message: { key: `cat.why.${verdict}`, params: {} }, releases });

  /** Opens the film's row, with the channel's film Requested. */
  const openRow = async (status: FilmStatus = { status: "requested" }) => {
    serveCatalog([FILM], { 1: status });
    const app = await openCatalog();
    await within(app.sheet).findByText(status.status === "requested" ? "Sol·licitada" : "Baixada · 720p");
    await app.user.click(await rowTrigger(app.sheet, "Pa negre"));
    return app;
  };

  const ask = async ({ user, sheet }: Awaited<ReturnType<typeof openRow>>) => {
    await user.click(within(sheet).getByRole("button", { name: BUTTON }));
  };

  it("shows Radarr's rejections word for word, under each release", async () => {
    server.use(
      http.post(WHY_URL, () =>
        answer("rejected", [
          { title: "Pa.negre.2010.1080p", approved: false, rejections: [REASON, "Not an upgrade"] },
          { title: "Pa.negre.2010.720p", approved: false, rejections: ["Size too small"] },
        ]),
      ),
    );

    const app = await openRow();
    await ask(app);

    expect(await within(app.sheet).findByText(REJECTED)).toBeVisible();
    const release = (title: string) => within(within(app.sheet).getByText(title).closest("li") as HTMLElement);
    expect(release("Pa.negre.2010.1080p").getByText(REASON)).toBeVisible();
    expect(release("Pa.negre.2010.1080p").getByText("Not an upgrade")).toBeVisible();
    expect(release("Pa.negre.2010.720p").getByText("Size too small")).toBeVisible();
  });

  it("answers for a Quality upgrade too", async () => {
    server.use(http.post(WHY_URL, () => answer("would_accept")));

    const app = await openRow({ status: "upgrade", radarr_quality: "720p", best_quality: "1080p" });
    await ask(app);

    expect(await within(app.sheet).findByText(WOULD_ACCEPT)).toBeVisible();
  });

  it("says so when Radarr's search found nothing", async () => {
    server.use(http.post(WHY_URL, () => answer("no_releases")));

    const app = await openRow();
    await ask(app);

    expect(await within(app.sheet).findByText(NO_RELEASES)).toBeVisible();
  });

  it("says why it couldn't answer, and can be asked again", async () => {
    server.use(
      http.post(
        WHY_URL,
        () => HttpResponse.json({ detail: { key: "err.catalog.not_in_radarr", params: { tmdb_id: 1 } } }, { status: 404 }),
        { once: true },
      ),
      http.post(WHY_URL, () => answer("would_accept")),
    );

    const app = await openRow();
    await ask(app);

    expect(await within(app.sheet).findByRole("alert")).toHaveTextContent(
      "Radarr no té aquesta pel·lícula (TMDB 1). Primer baixa-la.",
    );

    await ask(app);

    expect(await within(app.sheet).findByText(WOULD_ACCEPT)).toBeVisible();
    expect(within(app.sheet).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows it is asking, and asks once", async () => {
    let answerNow = () => {};
    const isAnswering = new Promise<void>((resolve) => {
      answerNow = resolve;
    });
    const asked = vi.fn();
    server.use(
      http.post(WHY_URL, async () => {
        asked();
        await isAnswering;
        return answer("no_releases");
      }),
    );

    const app = await openRow();
    await ask(app);

    const pending = await within(app.sheet).findByRole("button", { name: "Consultant Radarr…" });
    expect(pending).toBeDisabled();

    answerNow();
    await within(app.sheet).findByText(NO_RELEASES);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["to download", { status: "missing" }],
    ["held in the best quality", { status: "downloaded", radarr_quality: "1080p" }],
  ] as const)("isn't offered for a film %s", async (_, status) => {
    serveCatalog([FILM], { 1: status });

    const { sheet, user } = await openCatalog();
    await user.click(await rowTrigger(sheet, "Pa negre"));

    await waitFor(() => expect(within(sheet).getByText("TMDB")).toBeVisible());
    expect(within(sheet).queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
  });
});

describe("pages", () => {
  it("fetches each numbered page of 25 from the server", async () => {
    const { asked } = serveCatalog(manyFilms(60));

    const { sheet, user } = await openCatalog();
    await rowTrigger(sheet, "Film 1");

    expect(lastPageAsked(asked)?.get("limit")).toBe("25");
    expect(pageLink(sheet, 1)).toHaveAttribute("aria-current", "page");
    expect(within(sheet).getByText("Mostrant 1–25 de 60")).toBeVisible();

    await user.click(pageLink(sheet, 3));

    expect(await rowTrigger(sheet, "Film 51")).toBeVisible();
    expect(lastPageAsked(asked)?.get("offset")).toBe("50");
    expect(pageLink(sheet, 3)).toHaveAttribute("aria-current", "page");
    expect(within(sheet).getByText("Mostrant 51–60 de 60")).toBeVisible();
    expect(within(sheet).queryByRole("button", { name: /^Film 1\b/ })).not.toBeInTheDocument();
  });

  it("goes to the next and previous page, and neither runs past the ends", async () => {
    serveCatalog(manyFilms(30));

    const { sheet, user } = await openCatalog();
    await rowTrigger(sheet, "Film 1");
    const previous = within(sheet).getByRole("link", { name: "Pàgina anterior" });
    const next = within(sheet).getByRole("link", { name: "Pàgina següent" });
    expect(previous).toHaveAttribute("aria-disabled", "true");

    await user.click(next);

    expect(await rowTrigger(sheet, "Film 26")).toBeVisible();
    expect(next).toHaveAttribute("aria-disabled", "true");

    await user.click(previous);

    expect(await rowTrigger(sheet, "Film 1")).toBeVisible();
  });

  it("offers no page numbers for a single page", async () => {
    serveCatalog(manyFilms(25));

    const { sheet } = await openCatalog();
    await rowTrigger(sheet, "Film 1");

    expect(within(sheet).queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("falls back to the last page when the one on screen stops existing", async () => {
    const { world } = serveCatalog(manyFilms(26));

    const { sheet, user } = await openCatalog();
    await rowTrigger(sheet, "Film 1");
    world.rows = manyFilms(25);
    await user.click(pageLink(sheet, 2));

    expect(await rowTrigger(sheet, "Film 1")).toBeVisible();
    await waitFor(() => expect(within(sheet).queryByRole("navigation")).not.toBeInTheDocument());
  });
});

describe("search and filters", () => {
  it("narrows the list as typing pauses and goes back to page 1", async () => {
    const { asked } = serveCatalog([...manyFilms(30), film(99, { title: "Pa negre" })]);

    const { sheet, user } = await openCatalog();
    await rowTrigger(sheet, "Film 1");
    await user.click(pageLink(sheet, 2));
    await rowTrigger(sheet, "Film 26");

    await user.type(within(sheet).getByRole("searchbox", { name: "Cerca per títol" }), "pa negre");

    expect(await within(sheet).findByText("1 resultat")).toBeVisible();
    expect(await rowTrigger(sheet, "Pa negre")).toBeVisible();
    expect(lastPageAsked(asked)?.get("q")).toBe("pa negre");
    expect(lastPageAsked(asked)?.has("offset")).toBe(false);
  });

  it("asks the server once for a burst of typing", async () => {
    const { asked } = serveCatalog(manyFilms(3));

    const { sheet, user } = await openCatalog();
    await rowTrigger(sheet, "Film 1");
    const before = asked.pages.length;

    await user.type(within(sheet).getByRole("searchbox"), "abc");

    await within(sheet).findByText("Cap pel·lícula coincideix amb «abc»");
    expect(asked.pages.length).toBe(before + 1);
  });

  it("clears a search that found nothing", async () => {
    serveCatalog(manyFilms(2));

    const { sheet, user } = await openCatalog();
    await rowTrigger(sheet, "Film 1");
    await user.type(within(sheet).getByRole("searchbox"), "zzz");

    await user.click(await within(sheet).findByRole("button", { name: "Esborra la cerca" }));

    expect(await rowTrigger(sheet, "Film 1")).toBeVisible();
    expect(within(sheet).getByRole("searchbox")).toHaveValue("");
  });

  it("narrows by a filter chip, reset to page 1, with the search still applied", async () => {
    const statuses = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [index + 1, { status: "downloaded", radarr_quality: "1080p" } as const]),
    );
    const { asked } = serveCatalog([...manyFilms(30), film(31), film(32)], statuses);

    const { sheet, user } = await openCatalog();
    await rowTrigger(sheet, "Film 1");
    await user.click(pageLink(sheet, 2));
    await rowTrigger(sheet, "Film 26");
    await user.type(within(sheet).getByRole("searchbox"), "film");
    await within(sheet).findByText("32 resultats");
    await user.click(pageLink(sheet, 2));
    await rowTrigger(sheet, "Film 26");

    const missing = await chip(sheet, /^Per baixar\s*2$/);
    await user.click(missing);

    expect(await rowTrigger(sheet, "Film 31")).toBeVisible();
    expect(missing).toHaveAttribute("aria-pressed", "true");
    expect(lastPageAsked(asked)?.get("filter")).toBe("missing");
    expect(lastPageAsked(asked)?.get("q")).toBe("film");
    expect(lastPageAsked(asked)?.has("offset")).toBe(false);
  });

  it("says so when a filter keeps nothing", async () => {
    serveCatalog([film(1)]);

    const { sheet, user } = await openCatalog();
    await rowTrigger(sheet, "Film 1");

    await user.click(await chip(sheet, /^Millora qualitat\s*0$/));

    expect(await within(sheet).findByText("Cap pel·lícula en aquest filtre")).toBeVisible();
  });
});

describe("Download", () => {
  it("marks the film Requested, without a page reload, and the chips recount", async () => {
    const { asked } = serveCatalog([film(1, { title: "Pa negre" })]);

    const { sheet, user } = await openCatalog();
    await chip(sheet, /^Per baixar\s*1$/);
    const pages = asked.pages.length;

    await user.click(await within(sheet).findByRole("button", { name: "Baixar Pa negre" }));

    expect(await within(sheet).findByRole("button", { name: "Sol·licitada" })).toBeDisabled();
    expect(await chip(sheet, /^Per baixar\s*0$/)).toBeVisible();
    expect(asked.status).toBe(2);
    expect(asked.pages.length).toBe(pages);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends one request for a double press", async () => {
    const { asked } = serveCatalog([film(1, { title: "Pa negre" })]);

    const { sheet, user } = await openCatalog();
    await user.dblClick(await within(sheet).findByRole("button", { name: "Baixar Pa negre" }));

    await within(sheet).findByRole("button", { name: "Sol·licitada" });
    expect(asked.downloads).toEqual([1]);
  });

  it("keeps what Radarr holds on a requested upgrade", async () => {
    serveCatalog([film(1, { title: "Pa negre" })], {
      1: { status: "upgrade", radarr_quality: "720p", best_quality: "1080p" },
    });

    const { sheet, user } = await openCatalog();
    const upgrade = await within(sheet).findByRole("button", { name: "Baixar millora de 720p a 1080p" });
    expect(upgrade).toHaveTextContent("Baixar 1080p");

    await user.click(upgrade);

    expect(await within(sheet).findByRole("button", { name: "Sol·licitada" })).toBeDisabled();
    expect(within(sheet).getByText("Baixada · 720p")).toBeVisible();
  });

  it("stays Requested across a change of page", async () => {
    serveCatalog(manyFilms(26));

    const { sheet, user } = await openCatalog();
    await user.click(await within(sheet).findByRole("button", { name: "Baixar Film 1" }));
    await within(sheet).findByRole("button", { name: "Sol·licitada" });

    await user.click(pageLink(sheet, 2));
    await rowTrigger(sheet, "Film 26");
    await user.click(pageLink(sheet, 1));
    await rowTrigger(sheet, "Film 1");

    expect(within(sheet).getByRole("button", { name: "Sol·licitada" })).toBeDisabled();
  });

  it("names the film and Radarr's reason on a refusal, and keeps the row as it was", async () => {
    serveCatalog([film(1, { title: "Pa negre" })]);
    server.use(
      http.post(DOWNLOAD_URL, () =>
        HttpResponse.json(
          { detail: { key: "err.arr.http", params: { app: "Radarr", status: 503, detail: "" } } },
          { status: 502 },
        ),
      ),
    );

    const { sheet, user } = await openCatalog();
    await user.click(await within(sheet).findByRole("button", { name: "Baixar Pa negre" }));

    const alert = await within(sheet).findByRole("alert");
    expect(alert).toHaveTextContent("No s’ha pogut demanar «Pa negre»");
    expect(alert).toHaveTextContent("Radarr");
    expect(alert).toHaveTextContent("503");
    expect(alert).toHaveTextContent("No s’ha afegit res a la llista.");
    expect(within(sheet).getByRole("button", { name: "Baixar Pa negre" })).toBeEnabled();
  });

  it("falls back to the status, then to a network error, when no reason came", async () => {
    serveCatalog([film(1, { title: "Pa negre" })]);
    server.use(http.post(DOWNLOAD_URL, () => new HttpResponse(null, { status: 500 })));

    const { sheet, user } = await openCatalog();
    await user.click(await within(sheet).findByRole("button", { name: "Baixar Pa negre" }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Error 500");

    server.use(http.post(DOWNLOAD_URL, () => HttpResponse.error()));
    await user.click(within(sheet).getByRole("button", { name: "Torna-ho a provar" }));

    await waitFor(() => expect(within(sheet).getByRole("alert")).toHaveTextContent("Error de xarxa"));
  });

  it("retries from the notice, which then goes away", async () => {
    serveCatalog([film(1, { title: "Pa negre" })]);
    server.use(http.post(DOWNLOAD_URL, () => new HttpResponse(null, { status: 500 }), { once: true }));

    const { sheet, user } = await openCatalog();
    await user.click(await within(sheet).findByRole("button", { name: "Baixar Pa negre" }));

    await user.click(await within(sheet).findByRole("button", { name: "Torna-ho a provar" }));

    await within(sheet).findByRole("button", { name: "Sol·licitada" });
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the notice until it is closed, and sheet close removes it", async () => {
    serveCatalog([film(1, { title: "Pa negre" })]);
    server.use(http.post(DOWNLOAD_URL, () => new HttpResponse(null, { status: 500 })));

    const { sheet, user } = await openCatalog();
    const download = await within(sheet).findByRole("button", { name: "Baixar Pa negre" });

    await user.click(download);
    await user.click(await within(sheet).findByRole("button", { name: "Tanca l’avís" }));
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();

    await user.click(download);
    await within(sheet).findByRole("alert");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("while Radarr is unavailable", () => {
  it("still lists the Catalog, says so, and disables what needs Radarr", async () => {
    serveCatalog([film(1, { title: "Pa negre" })], {}, false);

    const { sheet, router, user } = await openCatalog();

    expect(await within(sheet).findByText("Radarr sense connexió")).toBeVisible();
    expect(await rowTrigger(sheet, "Pa negre")).toBeVisible();
    expect(within(sheet).getByRole("button", { name: "Baixar Pa negre" })).toBeDisabled();
    expect(await chip(sheet, /^Per baixar\s*–$/)).toBeDisabled();

    await user.click(within(sheet).getByRole("link", { name: "Obre Connecta" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/connect"));
  });

  it("treats a failed status read the same way", async () => {
    serveCatalog([film(1, { title: "Pa negre" })]);
    server.use(
      http.get(`/api/channels/${CHANNEL_ID}/catalog/status`, () => new HttpResponse(null, { status: 500 })),
    );

    const { sheet } = await openCatalog();

    expect(await within(sheet).findByText("Radarr sense connexió")).toBeVisible();
    expect(within(sheet).getByRole("button", { name: "Baixar Pa negre" })).toBeDisabled();
  });
});

describe("loading and empty", () => {
  it("says the list failed, and retries", async () => {
    const { world } = serveCatalog([film(1)]);
    world.isListDown = true;

    const { sheet, user } = await openCatalog();

    const alert = await within(sheet).findByRole("alert");
    expect(alert).toHaveTextContent("No s’ha pogut carregar el catàleg");
    expect(alert).toHaveTextContent("Error 500");

    world.isListDown = false;
    await user.click(within(alert).getByRole("button", { name: "Torna-ho a provar" }));

    expect(await rowTrigger(sheet, "Film 1")).toBeVisible();
  });

  it("explains a refused status filter, and All still works", async () => {
    serveCatalog([film(1)]);

    const { sheet, user } = await openCatalog();
    await rowTrigger(sheet, "Film 1");
    server.use(
      http.get(`/api/channels/${CHANNEL_ID}/catalog`, ({ request }) =>
        new URL(request.url).searchParams.has("filter")
          ? HttpResponse.json({ detail: { key: "err.catalog.filter_needs_radarr" } }, { status: 502 })
          : undefined,
      ),
    );

    await user.click(await chip(sheet, /^Per baixar/));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent("No s’ha pogut carregar el catàleg");

    await user.click(await chip(sheet, /^Totes/));

    expect(await rowTrigger(sheet, "Film 1")).toBeVisible();
  });

  it("offers Scan now on an empty Catalog, with no toolbar", async () => {
    serveCatalog([]);
    let scans = 0;
    server.use(
      http.post(`/api/channels/${CHANNEL_ID}/scan`, () => {
        scans += 1;
        return HttpResponse.json({ ok: true });
      }),
    );

    const { sheet, user } = await openCatalog();

    expect(await within(sheet).findByText("Encara no hi ha pel·lícules")).toBeVisible();
    expect(within(sheet).getByText("Encara no s’ha escanejat")).toBeVisible();
    expect(within(sheet).queryByRole("searchbox")).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Escaneja ara" }));

    await waitFor(() => expect(scans).toBe(1));
  });

  it("says when an empty channel was last scanned", async () => {
    serveCatalog([]);

    const { sheet } = await openCatalog({ id: CHANNEL_ID, last_scanned_at: 1_700_000_000 });

    expect(await within(sheet).findByText(/^Darrer escaneig: /)).toBeVisible();
  });

  it("shows the backend's refusal when scanning is off", async () => {
    serveCatalog([]);
    server.use(
      http.post(`/api/channels/${CHANNEL_ID}/scan`, () =>
        HttpResponse.json({ detail: { key: "err.channel.scanning_off" } }, { status: 409 }),
      ),
    );

    const { sheet, user } = await openCatalog({ id: CHANNEL_ID, scanning: 0 });
    await user.click(await within(sheet).findByRole("button", { name: "Escaneja ara" }));

    expect(await screen.findByText(/L’escaneig d’aquest canal està desactivat/)).toBeVisible();
  });
});

describe("new releases", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const openWithFakeClock = async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    return openCatalog();
  };

  it("shows a film posted while the Catalog is open, with its status, keeping rows expanded", async () => {
    const { world, asked } = serveCatalog([film(1, { title: "Pa negre" })]);

    const { sheet, user } = await openWithFakeClock();
    await user.click(await rowTrigger(sheet, "Pa negre"));
    await within(sheet).findByRole("button", { name: "Baixar Pa negre" });

    world.rows = [film(2, { title: "Alcarràs" }), ...world.rows];
    await act(() => vi.advanceTimersByTimeAsync(CATALOG_REFRESH_MS));

    expect(await within(sheet).findByRole("button", { name: "Baixar Alcarràs" })).toBeVisible();
    expect(await rowTrigger(sheet, "Pa negre")).toHaveAttribute("aria-expanded", "true");
    expect(asked.status).toBe(2);
  });

  it("does not read Radarr on a timer, whatever the filter", async () => {
    const { asked } = serveCatalog([film(1, { title: "Pa negre" })]);

    const { sheet, user } = await openWithFakeClock();
    await user.click(await chip(sheet, /^Per baixar\s*1$/));
    await waitFor(() => expect(lastPageAsked(asked)?.get("filter")).toBe("missing"));
    const reads = asked.pages.length;

    await act(() => vi.advanceTimersByTimeAsync(CATALOG_REFRESH_MS * 2));

    expect(asked.pages.length).toBe(reads);
    expect(asked.status).toBe(1);
  });
});
