import { screen, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { LOG_REFRESH_MS, logQuery } from "@/screens/activity/log";
import { channel } from "@/screens/channels/test-data";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";

const NOW = Math.floor(Date.now() / 1000);

const answerLogs = (rows: unknown[]) => server.use(http.get("/api/logs", () => HttpResponse.json(rows)));

const row = (
  id: number,
  level: string,
  message: string,
  ts = NOW - 120,
  msg: unknown = null,
  channelId: number | null = null,
) => ({ id, level, message, msg, ts, channel_id: channelId });

const answerChannels = (channels: unknown[]) =>
  server.use(http.get("/api/channels", () => HttpResponse.json(channels)));

describe("Activity", () => {
  beforeEach(() => answerChannels([]));

  it("shows a loading state until the log arrives", async () => {
    server.use(
      http.get("/api/logs", async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    );

    await renderApp({ route: "/activity" });

    expect(await screen.findByRole("status", { name: "S’està carregant…" })).toBeVisible();
  });

  it("asks for the latest 500 entries", async () => {
    let url = "";
    server.use(
      http.get("/api/logs", ({ request }) => {
        url = request.url;
        return HttpResponse.json([]);
      }),
    );

    await renderApp({ route: "/activity" });

    await screen.findByText("Encara no hi ha res al registre.");
    expect(new URL(url).searchParams.get("limit")).toBe("500");
  });

  it("says so when the log is empty", async () => {
    answerLogs([]);

    await renderApp({ route: "/activity" });

    expect(await screen.findByText("Encara no hi ha res al registre.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Treu els filtres" })).not.toBeInTheDocument();
  });

  it("tells no matches apart from an empty log, and clears the filters", async () => {
    answerLogs([row(1, "INFO", "Scan finished")]);

    const { user } = await renderApp({ route: "/activity" });
    await screen.findByText("Scan finished");
    await user.type(screen.getByRole("searchbox"), "nothing like this");

    expect(screen.getByText("Cap entrada del registre coincident.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Treu els filtres" }));

    expect(screen.getByText("Scan finished")).toBeVisible();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("counts what the filters leave out of the whole", async () => {
    answerLogs([row(2, "INFO", "Scanned Cinema Club"), row(1, "INFO", "Scanned Sèries")]);

    const { user } = await renderApp({ route: "/activity" });
    await screen.findByText("Scanned Sèries");
    expect(screen.queryByText("1 de 2")).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox"), "cinema");

    expect(screen.getByText("1 de 2")).toBeVisible();
  });

  it("offers a retry when the log cannot be loaded", async () => {
    let failing = true;
    server.use(
      http.get("/api/logs", () =>
        failing ? HttpResponse.json({ detail: "Registre no disponible" }, { status: 500 }) : HttpResponse.json([]),
      ),
    );

    const { user } = await renderApp({ route: "/activity" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Registre no disponible");
    failing = false;
    await user.click(screen.getByRole("button", { name: "Torna-ho a provar" }));

    expect(await screen.findByText("Encara no hi ha res al registre.")).toBeVisible();
  });

  it("shows a keyed entry in the UI language and an older entry as stored", async () => {
    answerLogs([
      row(2, "INFO", "Downloads paused", NOW - 120, { key: "event.downloads_paused", params: {} }),
      row(1, "WARN", "A line from an old version"),
    ]);

    await renderApp({ route: "/activity" });

    expect(await screen.findByText("Descàrregues en pausa")).toBeVisible();
    expect(screen.getByText("A line from an old version")).toBeVisible();
    expect(screen.queryByText("Downloads paused")).not.toBeInTheDocument();
  });

  it("gives each entry its translated severity, its clock time and a relative time", async () => {
    answerLogs([row(1, "ERROR", "Disk full", NOW - 120)]);

    await renderApp({ route: "/activity" });

    const entry = (await screen.findByText("Disk full")).closest("li") as HTMLElement;
    expect(within(entry).getByText("Error")).toBeVisible();
    expect(within(entry).queryByText("ERROR")).not.toBeInTheDocument();
    const clock = within(entry).getByText(/^\d{2}:\d{2}:\d{2}$/);
    expect(clock.tagName).toBe("TIME");
    expect(clock).toHaveAttribute("dateTime", new Date((NOW - 120) * 1000).toISOString());
    expect(within(entry).getByText("fa 2 min")).toBeVisible();
  });

  it("names warnings and info in the UI language", async () => {
    answerLogs([row(2, "WARN", "Slow mirror"), row(1, "INFO", "Scan finished")]);

    await renderApp({ route: "/activity" });

    const warning = (await screen.findByText("Slow mirror")).closest("li") as HTMLElement;
    expect(within(warning).getByText("Avís")).toBeVisible();
    const info = screen.getByText("Scan finished").closest("li") as HTMLElement;
    expect(within(info).getByText("Info")).toBeVisible();
  });

  it("groups entries under today, yesterday and older dates", async () => {
    const noon = (daysAgo: number) => {
      const day = new Date();
      day.setDate(day.getDate() - daysAgo);
      day.setHours(12, 0, 0, 0);
      return Math.floor(day.getTime() / 1000);
    };
    const today = Math.min(noon(0), NOW - 60);
    answerLogs([row(3, "INFO", "Now", today), row(2, "INFO", "Before", noon(1)), row(1, "INFO", "Long ago", noon(5))]);

    await renderApp({ route: "/activity" });
    await screen.findByText("Now");

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings.slice(0, 2)).toEqual(["Avui", "Ahir"]);
    expect(headings).toHaveLength(3);
    const before = screen.getByText("Before").closest("li") as HTMLElement;
    expect(before.textContent).not.toMatch(/\d+\/\d+\/\d{4}/);
  });

  it("tones each entry by its severity", async () => {
    answerLogs([row(3, "ERROR", "Disk full"), row(2, "WARN", "Slow mirror"), row(1, "INFO", "Scan finished")]);

    await renderApp({ route: "/activity" });

    const toneOf = (text: string) => screen.getByText(text).closest("li")?.getAttribute("data-tone");
    await screen.findByText("Disk full");
    expect(toneOf("Disk full")).toBe("error");
    expect(toneOf("Slow mirror")).toBe("warning");
    expect(toneOf("Scan finished")).toBe("neutral");
  });

  it("collapses consecutive identical entries into one with a count", async () => {
    answerLogs([
      row(4, "ERROR", "Flood wait"),
      row(3, "ERROR", "Flood wait"),
      row(2, "ERROR", "Flood wait"),
      row(1, "INFO", "Flood wait"),
    ]);

    await renderApp({ route: "/activity" });

    const entries = await screen.findAllByRole("listitem");
    const logEntries = entries.filter((entry) => entry.textContent?.includes("Flood wait"));
    expect(logEntries).toHaveLength(2);
    expect(within(logEntries[0]).getByText("×3")).toBeVisible();
    expect(within(logEntries[0]).getByText("3 vegades")).toBeInTheDocument();
  });

  it("filters by search text", async () => {
    answerLogs([row(2, "INFO", "Scanned Cinema Club"), row(1, "INFO", "Scanned Sèries")]);

    const { user } = await renderApp({ route: "/activity" });
    await screen.findByText("Scanned Sèries");

    await user.type(screen.getByRole("searchbox"), "cinema");

    expect(screen.getByText("Scanned Cinema Club")).toBeVisible();
    expect(screen.queryByText("Scanned Sèries")).not.toBeInTheDocument();
  });

  it("filters by level", async () => {
    answerLogs([row(2, "ERROR", "Disk full"), row(1, "INFO", "Scan finished")]);

    const { user } = await renderApp({ route: "/activity" });
    await screen.findByText("Scan finished");

    await user.click(screen.getByRole("combobox", { name: "Nivell" }));
    await user.click(await screen.findByRole("option", { name: "Errors" }));

    expect(screen.getByText("Disk full")).toBeVisible();
    expect(screen.queryByText("Scan finished")).not.toBeInTheDocument();
  });

  it("shows new entries after Refresh", async () => {
    let rows = [row(1, "INFO", "First")];
    server.use(http.get("/api/logs", () => HttpResponse.json(rows)));

    const { user } = await renderApp({ route: "/activity" });
    await screen.findByText("First");
    rows = [row(2, "INFO", "Second"), ...rows];

    await user.click(screen.getByRole("button", { name: "Actualitza" }));

    expect(await screen.findByText("Second")).toBeVisible();
  });

  it("names the channel an entry came from, and nothing for an entry without one", async () => {
    answerChannels([channel({ id: 7, title: "Cinema Club" })]);
    answerLogs([row(2, "INFO", "Scanned 12 messages", NOW - 120, null, 7), row(1, "INFO", "Downloads paused")]);

    await renderApp({ route: "/activity" });

    const scanned = (await screen.findByText("Scanned 12 messages")).closest("li") as HTMLElement;
    expect(await within(scanned).findByText("Cinema Club")).toBeVisible();
    const paused = screen.getByText("Downloads paused").closest("li") as HTMLElement;
    expect(within(paused).queryByText("Cinema Club")).not.toBeInTheDocument();
  });

  it("filters by channel, counting each channel's entries", async () => {
    answerChannels([channel({ id: 7, title: "Cinema Club" }), channel({ id: 8, title: "Sèries" })]);
    answerLogs([
      row(3, "INFO", "Scanned films", NOW - 120, null, 7),
      row(2, "INFO", "Scanned episodes", NOW - 120, null, 8),
      row(1, "INFO", "Downloads paused"),
    ]);

    const { user } = await renderApp({ route: "/activity" });
    await screen.findByText("Scanned films");

    await user.click(await screen.findByRole("combobox", { name: "Canal" }));
    await user.click(await screen.findByRole("option", { name: "Cinema Club (1)" }));

    expect(screen.getByText("Scanned films")).toBeVisible();
    expect(screen.queryByText("Scanned episodes")).not.toBeInTheDocument();
    expect(screen.queryByText("Downloads paused")).not.toBeInTheDocument();
    expect(screen.getByText("1 de 3")).toBeVisible();
  });

  it("says when only the most recent entries are shown", async () => {
    answerLogs(Array.from({ length: 500 }, (_, index) => row(500 - index, "INFO", `Entry ${500 - index}`)));

    await renderApp({ route: "/activity" });

    expect(await screen.findByText("Es mostren les 500 entrades més recents")).toBeVisible();
  });

  it("does not mention the limit under it", async () => {
    answerLogs([row(1, "INFO", "Scan finished")]);

    await renderApp({ route: "/activity" });
    await screen.findByText("Scan finished");

    expect(screen.queryByText(/entrades més recents/)).not.toBeInTheDocument();
  });

  it("polls the log while the screen is open", () => {
    expect(logQuery.refetchInterval).toBe(LOG_REFRESH_MS);
  });

  it("disables Refresh while the log loads again", async () => {
    let isSlow = false;
    server.use(
      http.get("/api/logs", async () => {
        if (isSlow) await delay("infinite");
        return HttpResponse.json([row(1, "INFO", "First")]);
      }),
    );

    const { user } = await renderApp({ route: "/activity" });
    await screen.findByText("First");
    isSlow = true;

    await user.click(screen.getByRole("button", { name: "Actualitza" }));

    expect(screen.getByRole("button", { name: "Actualitza" })).toBeDisabled();
  });
});

