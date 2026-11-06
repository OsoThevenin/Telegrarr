import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { channel } from "@/screens/channels/test-data";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";

const serveChannels = (rows: unknown[]) => server.use(http.get("/api/channels", () => HttpResponse.json(rows)));

const openChannels = async () => {
  const app = await renderApp({ route: "/ui/channels" });
  await screen.findByRole("tablist");
  return app;
};

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("tabs", () => {
  it("splits series and movie channels and counts each", async () => {
    serveChannels([
      channel({ id: 1, title: "Sèries CAT", kind: "tv" }),
      channel({ id: 2, title: "Anime CAT", kind: "tv" }),
      channel({ id: 3, title: "Cinema Club", kind: "movie" }),
    ]);

    const { user } = await openChannels();

    expect(tab(/^Sèries\s*2$/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Sèries CAT/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Cinema Club/ })).not.toBeInTheDocument();

    await user.click(tab(/^Pel·lícules\s*1$/));

    expect(screen.getByRole("button", { name: /Cinema Club/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Sèries CAT/ })).not.toBeInTheDocument();
  });

  it("counts a show fed by several sources as one card", async () => {
    serveChannels([
      channel({ id: 1, title: "Font A", imdb_id: "tt1", imdb_title: "Dark" }),
      channel({ id: 2, title: "Font B", imdb_id: "tt1", imdb_title: "Dark" }),
    ]);
    server.use(http.get("/api/art", () => HttpResponse.json({})));

    await openChannels();

    expect(tab(/^Sèries\s*1$/)).toBeVisible();
    const card = screen.getByRole("button", { name: /Dark/ });
    expect(within(card).getByText("2 fonts")).toBeVisible();
  });

  it("keeps a channel of an unknown kind reachable, on the series tab", async () => {
    serveChannels([channel({ id: 1, title: "Antic", kind: "other" })]);

    await openChannels();

    expect(tab(/^Sèries\s*1$/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Antic/ })).toBeVisible();
  });

  it("says so when a tab has no channels", async () => {
    serveChannels([channel({ id: 1, kind: "tv" })]);

    const { user } = await openChannels();
    await user.click(tab(/^Pel·lícules\s*0$/));

    expect(screen.getByText("Encara no hi ha cap canal de pel·lícules.")).toBeVisible();
  });
});

describe("card image", () => {
  const POSTER = "https://image.tmdb.org/poster.jpg";
  const posterOf = (name: RegExp) => screen.getByRole("button", { name }).querySelector("img");

  it("shows the TMDB poster of the mapping", async () => {
    serveChannels([channel({ id: 1, imdb_id: "tt1", imdb_title: "Dark" })]);
    server.use(
      http.get("/api/art", ({ request }) =>
        HttpResponse.json({ poster: new URL(request.url).searchParams.get("imdb") === "tt1" ? POSTER : null }),
      ),
    );

    await openChannels();

    await waitFor(() => expect(posterOf(/Dark/)).toHaveAttribute("src", POSTER));
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

    const { user } = await openChannels();
    await user.click(tab(/^Pel·lícules/));

    await waitFor(() => expect(posterOf(/Cinema Club/)).toHaveAttribute("src", POSTER));
  });

  it("falls back to initials for a channel with no art", async () => {
    serveChannels([channel({ id: 1, title: "Sèries Clàssiques" })]);

    await openChannels();

    expect(within(screen.getByRole("article")).getByText("SC")).toBeInTheDocument();
    expect(posterOf(/Sèries Clàssiques/)).toBeNull();
  });

  it("falls back to initials when the art lookup fails", async () => {
    serveChannels([channel({ id: 1, imdb_id: "tt1", imdb_title: "Dark" })]);
    const lookedUp = vi.fn(() => HttpResponse.json({ detail: "boom" }, { status: 502 }));
    server.use(http.get("/api/art", lookedUp));

    await openChannels();

    await waitFor(() => expect(lookedUp).toHaveBeenCalled());
    expect(within(screen.getByRole("article")).getByText("D")).toBeInTheDocument();
    expect(posterOf(/Dark/)).toBeNull();
  });

  it("falls back to initials when the poster does not load", async () => {
    serveChannels([channel({ id: 1, imdb_id: "tt1", imdb_title: "Dark" })]);
    server.use(http.get("/api/art", () => HttpResponse.json({ poster: POSTER })));

    await openChannels();
    await waitFor(() => expect(posterOf(/Dark/)).not.toBeNull());
    fireEvent.error(posterOf(/Dark/) as HTMLImageElement);

    expect(posterOf(/Dark/)).toBeNull();
  });
});

describe("channel list", () => {
  it("explains an empty list", async () => {
    serveChannels([]);

    await renderApp({ route: "/ui/channels" });

    expect(await screen.findByText("Encara no hi ha cap canal")).toBeVisible();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("reports a list that failed to load", async () => {
    server.use(http.get("/api/channels", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    await renderApp({ route: "/ui/channels" });

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});
