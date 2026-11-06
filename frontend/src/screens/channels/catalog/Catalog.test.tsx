import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CATALOG_REFRESH_MS } from "@/screens/channels/catalog/queries";
import { CHANNEL_ID, film, serveCatalog, unidentified } from "@/screens/channels/catalog/test-data";
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
  const app = await renderApp({ route: "/ui/channels" });
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

  it("says in the expanded row which file Radarr holds", async () => {
    serveCatalog([film(1, { title: "Pa negre", quality: "1080p" })], {
      1: { status: "upgrade", radarr_quality: "720p", best_quality: "1080p" },
    });

    const { sheet, user } = await openCatalog();
    await within(sheet).findByText("Baixada · 720p");
    await user.click(await rowTrigger(sheet, "Pa negre"));

    expect(within(sheet).getByText("Qualitat a Radarr").nextSibling).toHaveTextContent("720p");
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
