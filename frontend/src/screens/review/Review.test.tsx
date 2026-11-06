import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PENDING_REFRESH_MS } from "@/screens/review/review-api";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";

const CINEMA_CLUB = -1;
const PEL_LIS = -2;

type Release = {
  channel_id: number;
  message_id: number;
  file_name: string | null;
  caption: string | null;
  parsed_title: string | null;
  year: number | null;
  size: number | null;
  reason: string;
  channel_title: string;
  topic_title: string | null;
};

const release = (overrides: Partial<Release> & { message_id: number }): Release => ({
  channel_id: CINEMA_CLUB,
  file_name: null,
  caption: null,
  parsed_title: null,
  year: null,
  size: null,
  reason: "review.reason.no_match",
  channel_title: "Cinema Club",
  topic_title: null,
  ...overrides,
});

const AVATAR = release({
  message_id: 1,
  file_name: "Avatar.2022.1080p.mkv",
  caption: "Doblatge en català",
  parsed_title: "Avatar",
  year: 2022,
  size: 1_610_612_736,
});
const PIRATES = release({
  message_id: 2,
  channel_id: PEL_LIS,
  channel_title: "Pel·lis",
  file_name: "Els.Pirates.CAT.mkv",
  parsed_title: "Els Pirates",
  reason: "review.reason.no_year",
});
const MOSCA = release({
  message_id: 3,
  file_name: "fly.mkv",
  caption: "Una pel·lícula de Cronenberg",
  parsed_title: "La Mosca",
  reason: "review.reason.lookup_failed",
});

const AVATAR_FILM = { tmdb_id: 19995, title: "Avatar", original_title: "Avatar", year: 2009 };
const AVATAR_2_FILM = { tmdb_id: 76600, title: "Avatar: El sentit de l'aigua", original_title: "Avatar: The Way of Water", year: 2022 };

type Posts = { assigned: unknown[]; discarded: string[]; searched: (string | null)[] };

function serveReleases(initial: Release[]): Posts {
  let pending = initial;
  const posts: Posts = { assigned: [], discarded: [], searched: [] };
  const remove = (mid: unknown) => {
    pending = pending.filter((r) => String(r.message_id) !== mid);
  };
  server.use(
    http.get("/api/review", () => HttpResponse.json(pending)),
    http.post("/api/review/:cid/:mid/discard", ({ params }) => {
      posts.discarded.push(String(params.mid));
      remove(params.mid);
      return HttpResponse.json({ ok: true });
    }),
    http.post("/api/review/:cid/:mid/assign", async ({ params, request }) => {
      posts.assigned.push(await request.json());
      remove(params.mid);
      return HttpResponse.json({ title: "Avatar" });
    }),
    http.get("/api/tmdb/movies", ({ request }) => {
      posts.searched.push(new URL(request.url).searchParams.get("q"));
      return HttpResponse.json([AVATAR_FILM, AVATAR_2_FILM]);
    }),
  );
  return posts;
}

const NOT_PENDING = { detail: { key: "err.review.not_pending" } };

const ALL_NAMES = ["Avatar.2022.1080p.mkv", "Els.Pirates.CAT.mkv", "fly.mkv"];
const shownNames = () => ALL_NAMES.filter((name) => screen.queryByText(name));
const rowOf = async (name: string) => (await screen.findByText(name)).closest("li") as HTMLElement;

const toast = (text: string) => screen.findByText((content) => content.includes(text));

describe("the list", () => {
  it("says there is nothing to review when no release is pending", async () => {
    serveReleases([]);

    await renderApp({ route: "/review" });

    expect(await screen.findByText("No hi ha res per revisar")).toBeVisible();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("shows each release as one compact row", async () => {
    serveReleases([AVATAR]);

    await renderApp({ route: "/review" });

    const row = await rowOf("Avatar.2022.1080p.mkv");
    expect(within(row).getByText(/Cinema Club/)).toBeVisible();
    expect(within(row).getByText(/llegit com a «Avatar \(2022\)»/)).toBeVisible();
    expect(within(row).getByText("1.5 GB")).toBeVisible();
    expect(within(row).getByText("No hi ha cap coincidència fiable a TMDB")).toBeVisible();
    expect(within(row).queryByText("Doblatge en català")).not.toBeInTheDocument();
  });

  it("names a topic's channel with its topic", async () => {
    serveReleases([{ ...AVATAR, topic_title: "Clàssics" }]);

    await renderApp({ route: "/review" });

    expect(await screen.findByText(/Cinema Club › Clàssics/)).toBeVisible();
  });

  it("names a release without a file name after its message", async () => {
    serveReleases([release({ message_id: 42 })]);

    await renderApp({ route: "/review" });

    expect(await screen.findByText("Missatge 42")).toBeVisible();
  });

  it("reports a list that cannot load", async () => {
    server.use(http.get("/api/review", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    await renderApp({ route: "/review" });

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});

describe("search", () => {
  it.each([
    ["file name", "fly.mkv", "fly.mkv"],
    ["caption", "cronenberg", "fly.mkv"],
    ["parsed title", "la mosca", "fly.mkv"],
    ["a file name's words, ignoring its dots", "els pirates cat", "Els.Pirates.CAT.mkv"],
    ["text without its accents", "catala", "Avatar.2022.1080p.mkv"],
  ])("matches %s", async (_, query, expected) => {
    serveReleases([AVATAR, PIRATES, MOSCA]);
    const { user } = await renderApp({ route: "/review" });

    await user.type(await screen.findByRole("searchbox"), query);

    expect(shownNames()).toEqual([expected]);
  });

  it("says when nothing matches, and clears back to the whole list", async () => {
    serveReleases([AVATAR, PIRATES]);
    const { user } = await renderApp({ route: "/review" });

    await user.type(await screen.findByRole("searchbox"), "zzz");
    expect(screen.getByText("Cap publicació coincideix amb els filtres")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Treu els filtres" }));

    expect(shownNames()).toHaveLength(2);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});

describe("filters", () => {
  it("counts each channel and reason", async () => {
    serveReleases([AVATAR, PIRATES, MOSCA]);

    await renderApp({ route: "/review" });

    const channel = await screen.findByRole("combobox", { name: "Canal" });
    expect(within(channel).getByRole("option", { name: "Tots els canals (3)" })).toBeInTheDocument();
    expect(within(channel).getByRole("option", { name: "Cinema Club (2)" })).toBeInTheDocument();
    expect(within(channel).getByRole("option", { name: "Pel·lis (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tots els motius 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "El títol no té any 1" })).toHaveAttribute("aria-pressed", "false");
  });

  it("filters by channel", async () => {
    serveReleases([AVATAR, PIRATES, MOSCA]);
    const { user } = await renderApp({ route: "/review" });

    await user.selectOptions(await screen.findByRole("combobox", { name: "Canal" }), "Pel·lis (1)");

    expect(shownNames()).toEqual(["Els.Pirates.CAT.mkv"]);
  });

  it("filters by reason", async () => {
    serveReleases([AVATAR, PIRATES, MOSCA]);
    const { user } = await renderApp({ route: "/review" });

    await user.click(await screen.findByRole("button", { name: "La cerca a TMDB ha fallat 1" }));

    expect(shownNames()).toEqual(["fly.mkv"]);
  });

  it("combines with search, and counts what each option would show", async () => {
    serveReleases([AVATAR, PIRATES, MOSCA]);
    const { user } = await renderApp({ route: "/review" });

    await user.selectOptions(await screen.findByRole("combobox", { name: "Canal" }), "Cinema Club (2)");
    await user.type(screen.getByRole("searchbox"), "mosca");

    expect(shownNames()).toEqual(["fly.mkv"]);
    expect(screen.getByRole("option", { name: "Pel·lis (0)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "La cerca a TMDB ha fallat 1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "El títol no té any 0" })).toBeVisible();
    expect(screen.getByText("1 de 3")).toBeVisible();
  });
});

describe("an expanded row", () => {
  const openRow = async (user: UserEvent, name: RegExp) =>
    user.click(await screen.findByRole("button", { name }));
  const filmSearch = () => screen.findByRole("searchbox", { name: /Cerca a TMDB/ });

  it("shows the caption and searches TMDB for the parsed title at once", async () => {
    const posts = serveReleases([AVATAR, MOSCA]);
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);

    expect(await screen.findByText("Doblatge en català")).toBeVisible();
    expect(await filmSearch()).toHaveValue("Avatar");
    expect(await screen.findByRole("button", { name: /Avatar \(2009\)/ })).toBeVisible();
    expect(posts.searched).toEqual(["Avatar"]);
  });

  it("names a film's original title when it differs", async () => {
    serveReleases([AVATAR]);
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);

    expect(
      await screen.findByRole("button", {
        name: "Avatar: El sentit de l'aigua (2022) · Avatar: The Way of Water",
      }),
    ).toBeVisible();
  });

  it("searches the caption's first line when no title was parsed", async () => {
    serveReleases([release({ message_id: 9, file_name: "x.mkv", caption: "Solaris\nTarkovski" })]);
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^x\.mkv/);

    expect(await filmSearch()).toHaveValue("Solaris");
  });

  it("keeps one row open at a time", async () => {
    serveReleases([AVATAR, MOSCA]);
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);
    await openRow(user, /^fly\.mkv/);

    expect(screen.queryByText("Doblatge en català")).not.toBeInTheDocument();
    expect(await screen.findByText("Una pel·lícula de Cronenberg")).toBeVisible();
  });

  it("says when TMDB finds nothing", async () => {
    serveReleases([AVATAR]);
    server.use(http.get("/api/tmdb/movies", () => HttpResponse.json([])));
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);

    expect(await screen.findByText(/No s’ha trobat cap pel·lícula a TMDB/)).toBeVisible();
  });

  it("reports a TMDB search that fails", async () => {
    serveReleases([AVATAR]);
    server.use(
      http.get("/api/tmdb/movies", () => HttpResponse.json({ detail: "TMDB down" }, { status: 502 })),
    );
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);

    expect(await screen.findByRole("alert")).toHaveTextContent("TMDB down");
  });

  it("assigns the film a click picks, then moves on to the next row", async () => {
    const posts = serveReleases([AVATAR, MOSCA]);
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);
    await user.click(await screen.findByRole("button", { name: /Avatar \(2009\)/ }));

    expect(await toast("S’ha ofert a Radarr com a Avatar")).toBeVisible();
    expect(posts.assigned).toEqual([{ tmdb_id: 19995 }]);
    expect(shownNames()).toEqual(["fly.mkv"]);
    expect(await filmSearch()).toHaveFocus();
    expect(await filmSearch()).toHaveValue("La Mosca");
  });

  it("assigns a typed id on Enter, and only once there is one", async () => {
    const posts = serveReleases([AVATAR]);
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);
    expect(screen.getByRole("button", { name: "Assigna" })).toBeDisabled();
    await user.type(screen.getByLabelText(/identificador o enllaç/), "tt0499549{Enter}");

    expect(await screen.findByText("No hi ha res per revisar")).toBeVisible();
    expect(posts.assigned).toEqual([{ typed_id: "tt0499549" }]);
  });

  it("keeps the row and reports a failed Assign in it", async () => {
    serveReleases([AVATAR, MOSCA]);
    server.use(
      http.post("/api/review/:cid/:mid/assign", () =>
        HttpResponse.json({ detail: { key: "err.review.pick_film" } }, { status: 400 }),
      ),
    );
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);
    await user.type(screen.getByLabelText(/identificador o enllaç/), "nope");
    await user.click(screen.getByRole("button", { name: "Assigna" }));

    const row = await rowOf("Avatar.2022.1080p.mkv");
    expect(await within(row).findByRole("alert")).toBeVisible();
    expect(screen.getByLabelText(/identificador o enllaç/)).toHaveValue("nope");
    expect(shownNames()).toHaveLength(2);
  });

  it("discards from the row, then moves on", async () => {
    const posts = serveReleases([AVATAR, MOSCA]);
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);
    await user.click(screen.getByRole("button", { name: "Descarta" }));

    expect(await toast("S’ha descartat")).toBeVisible();
    expect(posts.discarded).toEqual(["1"]);
    expect(shownNames()).toEqual(["fly.mkv"]);
    expect(await filmSearch()).toHaveFocus();
  });

  it("drops a release someone else resolved first", async () => {
    serveReleases([AVATAR, MOSCA]);
    server.use(
      http.post("/api/review/:cid/:mid/discard", () => {
        server.use(http.get("/api/review", () => HttpResponse.json([MOSCA])));
        return HttpResponse.json(NOT_PENDING, { status: 404 });
      }),
    );
    const { user } = await renderApp({ route: "/review" });

    await openRow(user, /^Avatar\.2022/);
    await user.click(screen.getByRole("button", { name: "Descarta" }));

    expect(await toast("1 ja no estava pendent")).toBeVisible();
    expect(shownNames()).toEqual(["fly.mkv"]);
  });
});

describe("bulk Discard", () => {
  const select = (user: UserEvent, name: string) =>
    user.click(screen.getByRole("checkbox", { name: `Selecciona ${name}` }));
  const bulkDiscard = async (user: UserEvent) => {
    await user.click(screen.getByRole("button", { name: "Descarta les seleccionades" }));
    return screen.findByRole("alertdialog");
  };
  const confirm = (user: UserEvent, dialog: HTMLElement) =>
    user.click(within(dialog).getByRole("button", { name: "Descarta" }));
  const isSelected = (name: string) =>
    screen.getByRole("checkbox", { name: `Selecciona ${name}` }).getAttribute("aria-checked") === "true";

  async function renderQueue(releases: Release[] = [AVATAR, PIRATES, MOSCA]) {
    const posts = serveReleases(releases);
    const { user } = await renderApp({ route: "/review" });
    await screen.findByText(releases[0].file_name as string);
    return { posts, user };
  }

  it("offers nothing until a release is selected", async () => {
    await renderQueue();

    expect(screen.queryByRole("button", { name: "Descarta les seleccionades" })).not.toBeInTheDocument();
  });

  it("selects every shown release, and only those", async () => {
    const { user } = await renderQueue();

    await user.type(screen.getByRole("searchbox"), "mosca");
    await user.click(screen.getByRole("checkbox", { name: "Selecciona totes les visibles" }));

    expect(screen.getByText("1 seleccionada")).toBeVisible();
    await user.clear(screen.getByRole("searchbox"));
    expect(isSelected("fly.mkv")).toBe(true);
    expect(isSelected("Avatar.2022.1080p.mkv")).toBe(false);
  });

  it("marks select-all as partial when only some shown releases are selected", async () => {
    const { user } = await renderQueue();

    await select(user, "fly.mkv");

    expect(screen.getByRole("checkbox", { name: "Selecciona totes les visibles" })).toHaveAttribute(
      "aria-checked",
      "mixed",
    );
  });

  it("says how many selected releases the filters hide, and still names them", async () => {
    const { user } = await renderQueue();

    await select(user, "fly.mkv");
    await select(user, "Els.Pirates.CAT.mkv");
    await user.type(screen.getByRole("searchbox"), "mosca");
    expect(screen.getByText("1 oculta pels filtres")).toBeVisible();

    const dialog = await bulkDiscard(user);

    expect(within(dialog).getByText("Vols descartar 2 publicacions?")).toBeVisible();
    expect(within(dialog).getByText("fly.mkv")).toBeVisible();
    expect(within(dialog).getByText("Els.Pirates.CAT.mkv")).toBeVisible();
  });

  it("discards nothing when the dialog is cancelled", async () => {
    const { posts, user } = await renderQueue();

    await select(user, "fly.mkv");
    const dialog = await bulkDiscard(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancel·la" }));

    expect(posts.discarded).toEqual([]);
    expect(shownNames()).toHaveLength(3);
    expect(isSelected("fly.mkv")).toBe(true);
  });

  it("removes every selected release after confirmation", async () => {
    const { posts, user } = await renderQueue();

    await select(user, "fly.mkv");
    await select(user, "Avatar.2022.1080p.mkv");
    await confirm(user, await bulkDiscard(user));

    expect(await toast("S’han descartat 2 publicacions")).toBeVisible();
    expect(posts.discarded.toSorted()).toEqual(["1", "3"]);
    await waitFor(() => expect(shownNames()).toEqual(["Els.Pirates.CAT.mkv"]));
    expect(screen.queryByRole("button", { name: "Descarta les seleccionades" })).not.toBeInTheDocument();
  });

  it("clears the selection", async () => {
    const { user } = await renderQueue();

    await select(user, "fly.mkv");
    await user.click(screen.getByRole("button", { name: "Treu la selecció" }));

    expect(isSelected("fly.mkv")).toBe(false);
  });

  it("names what failed and keeps it selected, while the rest are discarded", async () => {
    const { user } = await renderQueue();
    server.use(
      http.post("/api/review/:cid/2/discard", () =>
        HttpResponse.json({ detail: "Base de dades bloquejada" }, { status: 500 }),
      ),
    );

    await select(user, "fly.mkv");
    await select(user, "Els.Pirates.CAT.mkv");
    await confirm(user, await bulkDiscard(user));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No s’ha pogut descartar 1 publicació; continua seleccionada.");
    expect(alert).toHaveTextContent("Els.Pirates.CAT.mkv: Base de dades bloquejada");
    expect(await toast("S’ha descartat 1 publicació")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Selecciona fly.mkv" })).toBeNull());
    expect(isSelected("Els.Pirates.CAT.mkv")).toBe(true);
    expect(screen.getByText("1 seleccionada")).toBeVisible();
  });

  it("reports a network failure the same way", async () => {
    const { user } = await renderQueue();
    server.use(http.post("/api/review/:cid/2/discard", () => HttpResponse.error()));

    await select(user, "Els.Pirates.CAT.mkv");
    await confirm(user, await bulkDiscard(user));

    expect(await screen.findByRole("alert")).toHaveTextContent("Els.Pirates.CAT.mkv: Error de xarxa");
    expect(isSelected("Els.Pirates.CAT.mkv")).toBe(true);
  });

  it("clears the failure on a retry that works", async () => {
    const { user } = await renderQueue();
    server.use(
      http.post("/api/review/:cid/2/discard", () => HttpResponse.json({}, { status: 500 }), { once: true }),
    );

    await select(user, "Els.Pirates.CAT.mkv");
    await confirm(user, await bulkDiscard(user));
    await screen.findByRole("alert");
    await confirm(user, await bulkDiscard(user));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await toast("S’ha descartat 1 publicació")).toBeVisible();
  });

  it("counts a release already resolved elsewhere as gone, not failed", async () => {
    const { user } = await renderQueue();
    server.use(
      http.post("/api/review/:cid/2/discard", () => HttpResponse.json(NOT_PENDING, { status: 404 })),
    );

    await select(user, "fly.mkv");
    await select(user, "Els.Pirates.CAT.mkv");
    await confirm(user, await bulkDiscard(user));

    expect(await toast("S’ha descartat 1 publicació")).toBeVisible();
    expect(await toast("1 ja no estava pendent")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a proxy's bare 404 as a failure", async () => {
    const { user } = await renderQueue();
    server.use(http.post("/api/review/:cid/2/discard", () => new HttpResponse("nope", { status: 404 })));

    await select(user, "Els.Pirates.CAT.mkv");
    await confirm(user, await bulkDiscard(user));

    expect(await screen.findByRole("alert")).toHaveTextContent("Els.Pirates.CAT.mkv: Error 404");
    expect(isSelected("Els.Pirates.CAT.mkv")).toBe(true);
  });

  it("dismisses the failure report", async () => {
    const { user } = await renderQueue();
    server.use(http.post("/api/review/:cid/2/discard", () => HttpResponse.error()));

    await select(user, "Els.Pirates.CAT.mkv");
    await confirm(user, await bulkDiscard(user));
    await user.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Tanca" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(isSelected("Els.Pirates.CAT.mkv")).toBe(true);
  });
});

describe("while the screen is open", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a release that arrives, without reloading", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveReleases([AVATAR]);
    await renderApp({ route: "/review" });
    await screen.findByText("Avatar.2022.1080p.mkv");

    server.use(http.get("/api/review", () => HttpResponse.json([AVATAR, PIRATES])));
    await act(() => vi.advanceTimersByTimeAsync(PENDING_REFRESH_MS));

    expect(await screen.findByText("Els.Pirates.CAT.mkv")).toBeVisible();
  });
});
