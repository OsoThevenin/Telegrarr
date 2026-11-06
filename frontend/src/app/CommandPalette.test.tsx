import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { goToLogout } from "@/lib/browser";
import { renderApp } from "@/test/render";
import { server, STATUS } from "@/test/server";

vi.mock("@/lib/browser", () => ({ goToLogin: vi.fn(), goToLogout: vi.fn() }));

const PALETTE = "Paleta d’ordres";
const OPEN_SHORTCUT = "{Control>}k{/Control}";

const palette = () => screen.findByRole("dialog", { name: PALETTE });

async function openPalette(user: UserEvent) {
  await user.keyboard(OPEN_SHORTCUT);
  await palette();
}

/** Finds a command and runs it with the keyboard alone. */
async function runCommand(user: UserEvent, name: string) {
  await openPalette(user);
  await user.keyboard(name);
  await screen.findByRole("option", { name });
  await user.keyboard("{Enter}");
}

function servePosts(...paths: string[]) {
  const posted: string[] = [];
  server.use(
    ...paths.map((path) =>
      http.post(path, () => {
        posted.push(path);
        return HttpResponse.json({ ok: true, message: { key: "scan.all_started", params: { n: 2 } } });
      }),
    ),
  );
  return posted;
}

const serveChannels = (...ids: number[]) =>
  server.use(http.get("/api/channels", () => HttpResponse.json(ids.map((id) => ({ id })))));

describe("command palette", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    localStorage.clear();
    vi.clearAllMocks();
  });

  it.each([
    ["Ctrl+K", "{Control>}k{/Control}"],
    ["Cmd+K", "{Meta>}k{/Meta}"],
  ])("opens with %s, ready to type in", async (_, shortcut) => {
    const { user } = await renderApp();

    await user.keyboard(shortcut);

    await palette();
    expect(screen.getByRole("combobox", { name: PALETTE })).toHaveFocus();
  });

  it("closes with the same shortcut and with Escape", async () => {
    const { user } = await renderApp();
    await openPalette(user);

    await user.keyboard(OPEN_SHORTCUT);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await openPalette(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens from a labelled button in the header", async () => {
    const { user } = await renderApp();

    await user.click(screen.getByRole("button", { name: "Obre la paleta d’ordres (Ctrl/Cmd K)" }));

    expect(await palette()).toBeVisible();
  });

  it("leaves nothing behind for screen readers while it is closed", async () => {
    await renderApp();

    expect(screen.queryByText(PALETTE)).not.toBeInTheDocument();
  });

  it.each([
    ["Tauler", "/settings"],
    ["Canals", "/"],
    ["Baixades", "/"],
    ["Activitat", "/"],
    ["Revisió", "/"],
    ["Connexió", "/"],
    ["Sistema", "/"],
    ["Configuració", "/"],
  ])("goes to %s", async (screenName, startingFrom) => {
    const { user } = await renderApp({ route: startingFrom });

    await runCommand(user, `Ves a ${screenName}`);

    expect(await screen.findByRole("heading", { level: 1, name: screenName })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves through the commands with the arrow keys", async () => {
    const { user } = await renderApp();
    await openPalette(user);

    await screen.findByRole("option", { name: "Ves a Tauler", selected: true });

    await user.keyboard("{ArrowDown}");

    expect(await screen.findByRole("option", { name: "Ves a Canals", selected: true })).toBeVisible();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "Canals" })).toBeVisible();
  });

  it("says so when no command matches", async () => {
    const { user } = await renderApp();
    await openPalette(user);

    await user.keyboard("zzz");

    expect(await screen.findByText("Cap ordre coincident")).toBeVisible();
  });

  it("opens the Add channel form on the Channels screen, ready to search", async () => {
    server.use(
      http.get("/api/channels", () => HttpResponse.json([])),
      http.get("/api/telegram/dialogs", () => HttpResponse.json([])),
    );
    const { user } = await renderApp();

    await runCommand(user, "Afegeix un canal");

    expect(await screen.findByRole("dialog", { name: "Afegeix un canal" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Canal de Telegram" })).toHaveFocus());
  });

  it("pauses the queue", async () => {
    const posted = servePosts("/api/queue/pause");
    const { user } = await renderApp();
    await screen.findByRole("button", { name: "Posa en pausa les baixades" });

    await runCommand(user, "Posa en pausa les baixades");

    await waitFor(() => expect(posted).toEqual(["/api/queue/pause"]));
  });

  it("offers Resume while the queue is paused", async () => {
    server.use(http.get("/api/status", () => HttpResponse.json({ ...STATUS, paused: true })));
    const { user } = await renderApp();
    await within(await screen.findByRole("complementary")).findByRole("button", { name: "Reprèn les baixades" });

    await openPalette(user);

    expect(await screen.findByRole("option", { name: "Reprèn les baixades" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Posa en pausa les baixades" })).not.toBeInTheDocument();
  });

  it("scans every channel and reports the server's answer", async () => {
    const posted = servePosts("/api/system/tasks/scan_all");
    const { user } = await renderApp();

    await runCommand(user, "Escaneja tots els canals");

    expect(await screen.findByText("S’estan escanejant 2 canals")).toBeVisible();
    expect(posted).toEqual(["/api/system/tasks/scan_all"]);
  });

  it("reports a scan the server refuses", async () => {
    server.use(
      http.post("/api/system/tasks/scan_all", () => HttpResponse.json({ detail: "Flood wait" }, { status: 429 })),
    );
    const { user } = await renderApp();

    await runCommand(user, "Escaneja tots els canals");

    expect(await screen.findByText("Flood wait")).toBeVisible();
  });

  it("backfills every channel", async () => {
    serveChannels(1, 2);
    const posted = servePosts("/api/channels/1/backfill", "/api/channels/2/backfill");
    const { user } = await renderApp();

    await runCommand(user, "Recupera l’historial de tots els canals");

    expect(await screen.findByText("S’ha començat a recuperar l’historial")).toBeVisible();
    expect(posted.toSorted()).toEqual(["/api/channels/1/backfill", "/api/channels/2/backfill"]);
  });

  it("still backfills the other channels when one fails, and says so", async () => {
    serveChannels(1, 2);
    const posted = servePosts("/api/channels/2/backfill");
    server.use(
      http.post("/api/channels/1/backfill", () => HttpResponse.json({ detail: "Canal perdut" }, { status: 502 })),
    );
    const { user } = await renderApp();

    await runCommand(user, "Recupera l’historial de tots els canals");

    expect(await screen.findByText("Canal perdut")).toBeVisible();
    expect(posted).toEqual(["/api/channels/2/backfill"]);
    expect(screen.queryByText("S’ha començat a recuperar l’historial")).not.toBeInTheDocument();
  });

  it("toggles the theme", async () => {
    const { user } = await renderApp();

    await runCommand(user, "Canvia el tema");

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("signs out", async () => {
    const { user } = await renderApp();

    await runCommand(user, "Tanca la sessió");

    expect(goToLogout).toHaveBeenCalledOnce();
  });
});
