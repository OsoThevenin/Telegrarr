import { screen, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderApp } from "@/test/render";
import { server } from "@/test/server";

const NOW = Math.floor(Date.now() / 1000);

const answerLogs = (rows: unknown[]) => server.use(http.get("/api/logs", () => HttpResponse.json(rows)));

const row = (id: number, level: string, message: string, ts = NOW - 120, msg: unknown = null) => ({
  id,
  level,
  message,
  msg,
  ts,
  channel_id: null,
});

describe("Activity", () => {
  it("shows a loading state until the log arrives", async () => {
    server.use(
      http.get("/api/logs", async () => {
        await delay("infinite");
        return HttpResponse.json([]);
      }),
    );

    await renderApp({ route: "/ui/activity" });

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

    await renderApp({ route: "/ui/activity" });

    await screen.findByText("Cap entrada del registre coincident.");
    expect(new URL(url).searchParams.get("limit")).toBe("500");
  });

  it("says so when there is nothing to show", async () => {
    answerLogs([]);

    await renderApp({ route: "/ui/activity" });

    expect(await screen.findByText("Cap entrada del registre coincident.")).toBeVisible();
  });

  it("offers a retry when the log cannot be loaded", async () => {
    let failing = true;
    server.use(
      http.get("/api/logs", () =>
        failing ? HttpResponse.json({ detail: "Registre no disponible" }, { status: 500 }) : HttpResponse.json([]),
      ),
    );

    const { user } = await renderApp({ route: "/ui/activity" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Registre no disponible");
    failing = false;
    await user.click(screen.getByRole("button", { name: "Torna-ho a provar" }));

    expect(await screen.findByText("Cap entrada del registre coincident.")).toBeVisible();
  });

  it("shows a keyed entry in the UI language and an older entry as stored", async () => {
    answerLogs([
      row(2, "INFO", "Downloads paused", NOW - 120, { key: "event.downloads_paused", params: {} }),
      row(1, "WARN", "A line from an old version"),
    ]);

    await renderApp({ route: "/ui/activity" });

    expect(await screen.findByText("Descàrregues en pausa")).toBeVisible();
    expect(screen.getByText("A line from an old version")).toBeVisible();
    expect(screen.queryByText("Downloads paused")).not.toBeInTheDocument();
  });

  it("gives each entry its severity and a relative time", async () => {
    answerLogs([row(1, "ERROR", "Disk full", NOW - 120)]);

    await renderApp({ route: "/ui/activity" });

    const entry = (await screen.findByText("Disk full")).closest("li") as HTMLElement;
    expect(within(entry).getByText("ERROR")).toBeVisible();
    expect(within(entry).getByText("fa 2 min")).toBeVisible();
  });

  it("collapses consecutive identical entries into one with a count", async () => {
    answerLogs([
      row(4, "ERROR", "Flood wait"),
      row(3, "ERROR", "Flood wait"),
      row(2, "ERROR", "Flood wait"),
      row(1, "INFO", "Flood wait"),
    ]);

    await renderApp({ route: "/ui/activity" });

    const entries = await screen.findAllByRole("listitem");
    const logEntries = entries.filter((entry) => entry.textContent?.includes("Flood wait"));
    expect(logEntries).toHaveLength(2);
    expect(within(logEntries[0]).getByText("×3")).toBeVisible();
  });

  it("filters by search text", async () => {
    answerLogs([row(2, "INFO", "Scanned Cinema Club"), row(1, "INFO", "Scanned Sèries")]);

    const { user } = await renderApp({ route: "/ui/activity" });
    await screen.findByText("Scanned Sèries");

    await user.type(screen.getByRole("searchbox"), "cinema");

    expect(screen.getByText("Scanned Cinema Club")).toBeVisible();
    expect(screen.queryByText("Scanned Sèries")).not.toBeInTheDocument();
  });

  it("filters by level", async () => {
    answerLogs([row(2, "ERROR", "Disk full"), row(1, "INFO", "Scan finished")]);

    const { user } = await renderApp({ route: "/ui/activity" });
    await screen.findByText("Scan finished");

    await user.click(screen.getByRole("combobox", { name: "Nivell" }));
    await user.click(await screen.findByRole("option", { name: "Errors" }));

    expect(screen.getByText("Disk full")).toBeVisible();
    expect(screen.queryByText("Scan finished")).not.toBeInTheDocument();
  });

  it("shows new entries after Refresh", async () => {
    let rows = [row(1, "INFO", "First")];
    server.use(http.get("/api/logs", () => HttpResponse.json(rows)));

    const { user } = await renderApp({ route: "/ui/activity" });
    await screen.findByText("First");
    rows = [row(2, "INFO", "Second"), ...rows];

    await user.click(screen.getByRole("button", { name: "Actualitza" }));

    expect(await screen.findByText("Second")).toBeVisible();
  });
});
