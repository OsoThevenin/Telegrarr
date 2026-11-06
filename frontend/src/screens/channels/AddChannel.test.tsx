import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { Channel } from "@/screens/channels/channel";
import { channel } from "@/screens/channels/test-data";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";

const MERLI = { chat_id: -1001, title: "Merlí 1080p", username: "merlicat", kind: "channel", members: 10 };
const AMICS = { chat_id: -1002, title: "Amics del cinema", username: "", kind: "group", members: 5 };
const DIALOG_NAME = "Afegeix un canal";
const SEARCH_LABEL = "Canal de Telegram";

/** The backend of the Add channel flow, keeping what the form sends. */
function serveAccount({ dialogs = [MERLI, AMICS] as unknown[], existing = [] as Channel[] } = {}) {
  const posted: Record<string, unknown>[] = [];
  const rows = [...existing];
  server.use(
    http.get("/api/channels", () => HttpResponse.json(rows)),
    http.post("/api/channels", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posted.push(body);
      const row = channel({
        id: 100 + posted.length,
        chat_id: Number(body.chat_id),
        title: String(body.title),
        kind: String(body.kind),
      });
      rows.push(row);
      return HttpResponse.json(row);
    }),
    http.get("/api/telegram/dialogs", () => HttpResponse.json(dialogs)),
    http.get("/api/telegram/topics", () => HttpResponse.json({ forum: false, topics: [] })),
    http.get("/api/settings", () => HttpResponse.json({ settings: { tmdb_key_set: true } })),
    http.get("/api/tmdb/search", () => HttpResponse.json([])),
  );
  return { posted };
}

const openDialog = async (route = "/channels?add=true") => {
  const app = await renderApp({ route });
  const dialog = await screen.findByRole("dialog", { name: DIALOG_NAME });
  return { ...app, dialog };
};

const save = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Desa" });

describe("opening Add channel", () => {
  it("opens from the top bar on the Channels screen", async () => {
    serveAccount({ existing: [channel({ id: 1 })] });
    const { user } = await renderApp({ route: "/channels" });

    await user.click(await screen.findByRole("button", { name: DIALOG_NAME }));

    expect(await screen.findByRole("dialog", { name: DIALOG_NAME })).toBeVisible();
  });

  it("is only in the top bar of the Channels screen", async () => {
    serveAccount();

    await renderApp({ route: "/review" });

    expect(await screen.findByRole("heading", { level: 1 })).toBeVisible();
    expect(screen.queryByRole("button", { name: DIALOG_NAME })).not.toBeInTheDocument();
  });

  it("is offered by an empty list", async () => {
    serveAccount();
    const { user } = await renderApp({ route: "/channels" });
    const emptyState = (await screen.findByRole("heading", { level: 2, name: /cap canal/ })).parentElement;

    await user.click(within(emptyState as HTMLElement).getByRole("button", { name: DIALOG_NAME }));

    expect(await screen.findByRole("dialog", { name: DIALOG_NAME })).toBeVisible();
  });

  it("closes without adding, back on what opened it and with a clean URL", async () => {
    const { posted } = serveAccount({ existing: [channel({ id: 1 })] });
    const { user, router } = await renderApp({ route: "/channels" });
    await screen.findByRole("tablist");
    const opener = screen.getByRole("button", { name: DIALOG_NAME });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: DIALOG_NAME });

    await user.click(within(dialog).getByRole("button", { name: "Cancel·la" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(router.state.location.search).toEqual({});
    expect(posted).toEqual([]);
  });

  it("starts blank each time", async () => {
    serveAccount({ existing: [channel({ id: 1 })] });
    const { user, dialog } = await openDialog();
    await user.click(await within(dialog).findByRole("option", { name: /Merlí/ }));
    await user.selectOptions(within(dialog).getByLabelText("Idioma de l’àudio"), "en");
    await user.click(within(dialog).getByRole("button", { name: "Cancel·la" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: DIALOG_NAME }));

    const reopened = await screen.findByRole("dialog", { name: DIALOG_NAME });
    expect(within(reopened).getByLabelText("Idioma de l’àudio")).toHaveValue("cat");
    expect(within(reopened).getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("saving", () => {
  const pickAndSave = async (dialog: HTMLElement, user: Awaited<ReturnType<typeof openDialog>>["user"]) => {
    await user.click(await within(dialog).findByRole("option", { name: /Merlí/ }));
    await user.click(save(dialog));
  };

  it("sends the settings chosen and shows the tab the channel landed on", async () => {
    const { posted } = serveAccount({ existing: [channel({ id: 1 })] });
    const { user, dialog } = await openDialog();

    await user.selectOptions(within(dialog).getByLabelText("Tipus"), "movie");
    await user.selectOptions(within(dialog).getByLabelText("Idioma de l’àudio"), "es");
    await pickAndSave(dialog, user);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posted[0]).toMatchObject({ kind: "movie", language: "es" });
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Pel·lícules/ })).toHaveAttribute("aria-selected", "true"));
  });

  it("stays open with the reason when adding fails", async () => {
    serveAccount();
    server.use(
      http.post("/api/channels", () => HttpResponse.json({ detail: "Límit assolit" }, { status: 400 })),
    );
    const { user, dialog } = await openDialog();

    await pickAndSave(dialog, user);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Límit assolit");
    expect(screen.getByRole("dialog", { name: DIALOG_NAME })).toBeVisible();
  });
});

describe("picking a chat", () => {
  it("says which chats are channels and which are groups", async () => {
    serveAccount();

    const { dialog } = await openDialog();

    expect(await within(dialog).findByRole("option", { name: /Merlí 1080p.*@merlicat.*canal/ })).toBeVisible();
    expect(within(dialog).getByRole("option", { name: /Amics del cinema.*grup/ })).toBeVisible();
  });

  it("adds the chat picked from the list with the default settings", async () => {
    const { posted } = serveAccount();
    const { user, dialog } = await openDialog();

    await user.click(await within(dialog).findByRole("option", { name: /Merlí/ }));
    await user.click(save(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posted).toEqual([
      {
        chat_id: MERLI.chat_id,
        title: MERLI.title,
        kind: "tv",
        language: "cat",
        fallback_quality: "1080p",
        weekdays: "0,1,2,3,4,5,6",
        poll_minutes: 15,
      },
    ]);
    expect(await screen.findByText("S’ha afegit el canal")).toBeVisible();
    expect(await screen.findByRole("button", { name: /^Merlí 1080p/ })).toBeVisible();
  });

  it("asks for a chat before saving", async () => {
    const { posted } = serveAccount();
    const { user, dialog } = await openDialog();

    await user.click(save(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Primer tria un canal o resol un enllaç");
    expect(posted).toEqual([]);
  });

  it("is labelled and works from the keyboard alone", async () => {
    const { posted } = serveAccount();
    const { user, dialog } = await openDialog();
    const search = within(dialog).getByRole("combobox", { name: SEARCH_LABEL });
    await within(dialog).findByRole("option", { name: /Merlí/ });

    expect(search).toHaveFocus();
    await user.keyboard("amics");
    await within(dialog).findByRole("option", { name: /Amics/ });
    expect(within(dialog).queryByRole("option", { name: /Merlí/ })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("Amics del cinema"));
    expect(posted).toEqual([]);
  });

  it("finds a chat by its username", async () => {
    serveAccount();
    const { user, dialog } = await openDialog();
    await within(dialog).findByRole("option", { name: /Amics/ });

    await user.type(within(dialog).getByRole("combobox", { name: SEARCH_LABEL }), "MERLICAT");

    const list = within(within(dialog).getByRole("listbox"));
    await waitFor(() => expect(list.getAllByRole("option")).toHaveLength(1));
    expect(list.getByRole("option", { name: /Merlí/ })).toBeVisible();
  });

  it("says when no chat matches", async () => {
    serveAccount();
    const { user, dialog } = await openDialog();
    await within(dialog).findByRole("option", { name: /Amics/ });

    await user.type(within(dialog).getByRole("combobox", { name: SEARCH_LABEL }), "zzz");

    expect(await within(dialog).findByText(/^Cap coincidència/)).toBeVisible();
  });

  it("says when the account has no chats", async () => {
    serveAccount({ dialogs: [] });

    const { dialog } = await openDialog();

    expect(await within(dialog).findByText(/^No s’ha trobat cap xat/)).toBeVisible();
  });
});

describe("forum groups", () => {
  const TOPICS = [
    { topic_id: 11, title: "Sèries HD" },
    { topic_id: 12, title: "Pel·lícules HD" },
  ];
  const serveTopics = (reply: () => Response = () => HttpResponse.json({ forum: true, topics: TOPICS })) =>
    server.use(http.get("/api/telegram/topics", reply));

  const pickForum = async () => {
    const opened = await openDialog();
    await opened.user.click(await within(opened.dialog).findByRole("option", { name: /Amics/ }));
    return opened;
  };

  it("replaces the chat-wide kind with one per topic", async () => {
    serveAccount();
    serveTopics();

    const { dialog } = await pickForum();

    const topic = await within(dialog).findByRole("checkbox", { name: "Sèries HD" });
    expect(topic).not.toBeChecked();
    expect(within(dialog).queryByLabelText("Tipus")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tipus per a Sèries HD")).toBeDisabled();
  });

  it("adds each ticked topic as its own source, with its own kind", async () => {
    const { posted } = serveAccount();
    serveTopics();
    const { user, dialog } = await pickForum();

    await user.click(await within(dialog).findByRole("checkbox", { name: "Sèries HD" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Pel·lícules HD" }));
    await user.selectOptions(within(dialog).getByLabelText("Tipus per a Pel·lícules HD"), "movie");
    await user.click(save(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posted).toEqual([
      expect.objectContaining({ chat_id: AMICS.chat_id, kind: "tv", topic_id: 11, topic_title: "Sèries HD" }),
      expect.objectContaining({ chat_id: AMICS.chat_id, kind: "movie", topic_id: 12, topic_title: "Pel·lícules HD" }),
    ]);
    expect(await screen.findByText("S’han afegit 2 fonts de tema")).toBeVisible();
  });

  it("asks for a topic before saving", async () => {
    const { posted } = serveAccount();
    serveTopics();
    const { user, dialog } = await pickForum();
    await within(dialog).findByRole("checkbox", { name: "Sèries HD" });

    await user.click(save(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Marca almenys un tema");
    expect(posted).toEqual([]);
  });

  it("says when the group has no topics", async () => {
    serveAccount();
    serveTopics(() => HttpResponse.json({ forum: true, topics: [] }));

    const { dialog } = await pickForum();

    expect(await within(dialog).findByText("Aquest grup amb fòrum no té cap tema")).toBeVisible();
  });

  it("keeps going past a failed topic, stays open and names it", async () => {
    const { posted } = serveAccount();
    serveTopics();
    const { user, dialog } = await pickForum();
    server.use(
      http.post("/api/channels", async ({ request }) => {
        const body = (await request.clone().json()) as { topic_id: number };
        if (body.topic_id !== 11) return undefined;
        return HttpResponse.json({ detail: "Límit assolit" }, { status: 400 });
      }),
    );

    await user.click(await within(dialog).findByRole("checkbox", { name: "Sèries HD" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Pel·lícules HD" }));
    await user.click(save(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Sèries HD: Límit assolit");
    expect(posted).toEqual([expect.objectContaining({ topic_id: 12 })]);
    expect(await screen.findByText("S’ha afegit 1 font de tema")).toBeVisible();
  });

  it("forgets the ticks when another chat is picked", async () => {
    const { posted } = serveAccount();
    server.use(
      http.get("/api/telegram/topics", ({ request }) => {
        const isForum = new URL(request.url).searchParams.get("chat_id") === String(AMICS.chat_id);
        return HttpResponse.json({ forum: isForum, topics: isForum ? TOPICS : [] });
      }),
    );
    const { user, dialog } = await pickForum();
    await user.click(await within(dialog).findByRole("checkbox", { name: "Sèries HD" }));

    await user.click(within(dialog).getByRole("option", { name: /Merlí/ }));
    await waitFor(() => expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument());
    await user.click(save(dialog));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ chat_id: MERLI.chat_id, kind: "tv" });
    expect(posted[0]).not.toHaveProperty("topic_id");
  });

  it("gives the reason when the topics cannot be read", async () => {
    serveAccount();
    serveTopics(() => HttpResponse.json({ detail: "Espera un minut" }, { status: 429 }));

    const { dialog } = await pickForum();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Espera un minut");
  });
});

describe("the series", () => {
  const SERIES_LABEL = "Sèrie (cerca a TMDB)";
  const HIT = { tmdb_id: 1001, title: "Merlí", year: "2015", original_title: "Merlí" };

  /** TMDB's search and the mapping endpoint, keeping what the form asks of them. */
  function serveSeries(reply: () => Response = () => HttpResponse.json([HIT])) {
    const searches: URLSearchParams[] = [];
    const mapped: { id: number; body: unknown }[] = [];
    server.use(
      http.get("/api/tmdb/search", ({ request }) => {
        searches.push(new URL(request.url).searchParams);
        return reply();
      }),
      http.put("/api/channels/:id/series", async ({ params, request }) => {
        const id = Number(params.id);
        mapped.push({ id, body: await request.json() });
        return HttpResponse.json(channel({ id }));
      }),
    );
    return { searches, mapped };
  }

  const pickMerli = async () => {
    const opened = await openDialog();
    await opened.user.click(await within(opened.dialog).findByRole("option", { name: /Merlí/ }));
    return opened;
  };

  const chooseHit = async ({ user, dialog }: Awaited<ReturnType<typeof openDialog>>) => {
    await user.click(await within(dialog).findByRole("button", { name: /^Merlí \(2015\)/ }));
    return within(dialog).findByText("(TMDB 1001)");
  };

  it("searches TMDB for the picked chat, leaving out its release words", async () => {
    serveAccount();
    const { searches } = serveSeries();

    const { dialog } = await pickMerli();

    expect(await within(dialog).findByRole("button", { name: /^Merlí \(2015\)/ })).toBeVisible();
    expect(within(dialog).getByLabelText(SERIES_LABEL)).toHaveValue("Merlí");
    expect(searches[0].get("q")).toBe("Merlí");
    expect(searches[0].get("digits_as_id")).toBe("false");
  });

  it("maps the new channel to the chosen series", async () => {
    serveAccount();
    const { mapped } = serveSeries();
    const opened = await pickMerli();

    await chooseHit(opened);
    await opened.user.click(save(opened.dialog));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mapped).toEqual([{ id: 101, body: { tmdb_id: 1001, tvdb_id: null, title: "Merlí (2015)" } }]);
  });

  it("leaves the channel unmapped when no series was chosen", async () => {
    serveAccount();
    const { mapped } = serveSeries();
    const { user, dialog } = await pickMerli();
    await within(dialog).findByRole("button", { name: /^Merlí \(2015\)/ });

    await user.click(save(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mapped).toEqual([]);
  });

  it("maps by a typed TVDB id alone", async () => {
    serveAccount();
    const { mapped } = serveSeries();
    const { user, dialog } = await pickMerli();

    await user.type(within(dialog).getByLabelText("Identificador de TVDB"), "2001");
    await user.click(save(dialog));

    await waitFor(() => expect(mapped).toEqual([{ id: 101, body: { tmdb_id: null, tvdb_id: "2001", title: "" } }]));
  });

  it("reads digits as a TMDB id on Enter, without saving the form", async () => {
    const { posted } = serveAccount();
    const { searches } = serveSeries(() => HttpResponse.json([{ ...HIT, exact: true }]));
    const { user, dialog } = await pickMerli();
    const input = within(dialog).getByLabelText(SERIES_LABEL);

    await user.clear(input);
    await user.type(input, "1001{Enter}");

    expect(await within(dialog).findByText("(TMDB 1001)")).toBeVisible();
    expect(searches.at(-1)?.get("q")).toBe("1001");
    expect(searches.at(-1)?.get("digits_as_id")).toBe("true");
    expect(posted).toEqual([]);
  });

  it("offers the id reading when digits are read as a title", async () => {
    serveAccount();
    serveSeries();
    const { user, dialog } = await pickMerli();
    const input = within(dialog).getByLabelText(SERIES_LABEL);

    await user.clear(input);
    await user.type(input, "1883");

    expect(await within(dialog).findByText(/Prem Retorn per fer servir 1883/)).toBeVisible();
  });

  it("says when TMDB finds nothing", async () => {
    serveAccount();
    serveSeries(() => HttpResponse.json([]));

    const { dialog } = await pickMerli();

    expect(await within(dialog).findByText(/No s’ha trobat cap sèrie/)).toBeVisible();
  });

  it("keeps a typed search when another chat is picked", async () => {
    serveAccount();
    serveSeries();
    const { user, dialog } = await pickMerli();
    const input = within(dialog).getByLabelText(SERIES_LABEL);

    await user.clear(input);
    await user.type(input, "Plats bruts");
    await user.click(within(dialog).getByRole("option", { name: /Amics/ }));

    expect(input).toHaveValue("Plats bruts");
  });

  it("asks for a TMDB key instead of searching without one", async () => {
    serveAccount();
    const { searches } = serveSeries();
    server.use(http.get("/api/settings", () => HttpResponse.json({ settings: { tmdb_key_set: false } })));
    const { user, dialog } = await openDialog();
    expect(await within(dialog).findByText(/Cal una clau de l’API de TMDB/)).toBeVisible();

    await user.click(await within(dialog).findByRole("option", { name: /Merlí/ }));

    expect(within(dialog).getByLabelText(SERIES_LABEL)).toHaveValue("Merlí");
    expect(searches).toEqual([]);
  });

  it("gives the reason when the search fails", async () => {
    serveAccount();
    serveSeries(() => HttpResponse.json({ detail: "TMDB no respon" }, { status: 502 }));

    const { dialog } = await pickMerli();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("TMDB no respon");
  });

  it("stays open with the reason when the mapping fails", async () => {
    const { posted } = serveAccount();
    serveSeries();
    server.use(
      http.put("/api/channels/:id/series", () => HttpResponse.json({ detail: "Sèrie desconeguda" }, { status: 400 })),
    );
    const opened = await pickMerli();

    await chooseHit(opened);
    await opened.user.click(save(opened.dialog));

    expect(await within(opened.dialog).findByRole("alert")).toHaveTextContent("Sèrie desconeguda");
    expect(posted).toHaveLength(1);
  });

  it("explains movies instead, and sends them no mapping", async () => {
    serveAccount();
    const { mapped } = serveSeries();
    const opened = await pickMerli();
    await chooseHit(opened);

    await opened.user.selectOptions(within(opened.dialog).getByLabelText("Tipus"), "movie");

    expect(within(opened.dialog).getByText(/Els canals de pel·lícules/)).toBeVisible();
    expect(within(opened.dialog).queryByLabelText(SERIES_LABEL)).not.toBeInTheDocument();

    await opened.user.click(save(opened.dialog));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mapped).toEqual([]);
  });

  describe("of a forum group", () => {
    const TOPICS = [
      { topic_id: 11, title: "Sèries HD" },
      { topic_id: 12, title: "Pel·lícules HD" },
    ];

    const pickForum = async () => {
      server.use(http.get("/api/telegram/topics", () => HttpResponse.json({ forum: true, topics: TOPICS })));
      const opened = await openDialog();
      await opened.user.click(await within(opened.dialog).findByRole("option", { name: /Amics/ }));
      await within(opened.dialog).findByRole("checkbox", { name: "Sèries HD" });
      return opened;
    };

    it("maps the one series topic that is ticked", async () => {
      const { posted } = serveAccount();
      const { mapped } = serveSeries();
      const opened = await pickForum();
      const { user, dialog } = opened;

      expect(within(dialog).queryByLabelText(SERIES_LABEL)).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole("checkbox", { name: "Sèries HD" }));
      await user.click(within(dialog).getByRole("checkbox", { name: "Pel·lícules HD" }));
      await user.selectOptions(within(dialog).getByLabelText("Tipus per a Pel·lícules HD"), "movie");
      expect(within(dialog).getByText("Sèrie associada a l’únic tema de sèries marcat:")).toBeVisible();
      await chooseHit(opened);
      await user.click(save(dialog));

      await waitFor(() => expect(mapped).toHaveLength(1));
      expect(posted[0]).toMatchObject({ topic_id: 11 });
      expect(mapped[0].id).toBe(101);
    });

    it("hides the series when two series topics are ticked", async () => {
      serveAccount();
      serveSeries();
      const { user, dialog } = await pickForum();

      await user.click(within(dialog).getByRole("checkbox", { name: "Sèries HD" }));
      await user.click(within(dialog).getByRole("checkbox", { name: "Pel·lícules HD" }));

      expect(within(dialog).queryByLabelText(SERIES_LABEL)).not.toBeInTheDocument();
    });
  });
});

describe("pasting a link", () => {
  const SECRET = { chat_id: -1003, title: "Canal Secret", username: "canalsecret" };

  const serveResolve = (reply: () => Response) => {
    const queries: unknown[] = [];
    server.use(
      http.post("/api/telegram/resolve", async ({ request }) => {
        queries.push(((await request.json()) as { query: string }).query);
        return reply();
      }),
    );
    return queries;
  };

  const paste = async (link: string) => {
    const opened = await openDialog();
    await within(opened.dialog).findByRole("option", { name: /Amics/ });
    await opened.user.type(within(opened.dialog).getByRole("combobox", { name: SEARCH_LABEL }), link);
    return opened;
  };

  it.each(["https://t.me/canalsecret", "@canalsecret", "t.me/+AbCdEf", "+AbCdEf"])(
    "resolves %s to the chat it names",
    async (link) => {
      const { posted } = serveAccount();
      const queries = serveResolve(() => HttpResponse.json(SECRET));
      const { user, dialog } = await paste(link);

      await user.keyboard("{Enter}");

      await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("Canal Secret"));
      expect(queries).toEqual([link]);
      await user.click(save(dialog));
      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({ chat_id: SECRET.chat_id, title: SECRET.title });
    },
  );

  it("does not offer to resolve a plain search", async () => {
    serveAccount();
    const { dialog } = await paste("amics");

    await within(dialog).findByRole("option", { name: /Amics/ });

    expect(within(dialog).queryByRole("option", { name: /Resol/ })).not.toBeInTheDocument();
  });

  it("gives the reason when a link does not resolve, and picks nothing", async () => {
    serveAccount();
    serveResolve(() => HttpResponse.json({ error: { key: "chm.resolve_failed" } }));
    const { user, dialog } = await paste("@noexisteix");

    await user.keyboard("{Enter}");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No s’ha pogut resoldre");
    expect(within(dialog).getByRole("status")).toBeEmptyDOMElement();
  });

  it("gives the reason when the server refuses", async () => {
    serveAccount();
    serveResolve(() => HttpResponse.json({ detail: "Telegram no respon" }, { status: 502 }));
    const { user, dialog } = await paste("@canalsecret");

    await user.keyboard("{Enter}");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Telegram no respon");
  });

  it("drops the failure once the link changes", async () => {
    serveAccount();
    serveResolve(() => HttpResponse.json({ error: { key: "chm.resolve_failed" } }));
    const { user, dialog } = await paste("@noexisteix");
    await user.keyboard("{Enter}");
    await within(dialog).findByRole("alert");

    await user.keyboard("2");

    await waitFor(() => expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument());
  });

  it("keeps pasting available when the chats cannot be listed", async () => {
    serveAccount();
    server.use(
      http.get("/api/telegram/dialogs", () => HttpResponse.json({ detail: "Telegram no respon" }, { status: 502 })),
    );
    serveResolve(() => HttpResponse.json(SECRET));
    const { user, dialog } = await openDialog();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Telegram no respon");
    await user.type(within(dialog).getByRole("combobox", { name: SEARCH_LABEL }), "@canalsecret{Enter}");

    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("Canal Secret"));
  });
});
