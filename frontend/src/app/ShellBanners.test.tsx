import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { renderApp } from "@/test/render";
import { server, STATUS } from "@/test/server";

const ANY_SCREEN = "/no-such-screen";
const GB = 1024 ** 3;
const SIGNED_OUT_TEXT = "Telegram no està connectat";
const BUDGET_TEXT = "límit diari de 20 GB";

function serveStatus(fields: Partial<typeof STATUS>) {
  server.use(http.get("/api/status", () => HttpResponse.json({ ...STATUS, ...fields })));
}

function serveTelegramAuth(apiReady: boolean) {
  server.use(http.get("/api/telegram/auth", () => HttpResponse.json({ authorized: false, api_ready: apiReady })));
}

describe("the Telegram banner", () => {
  it("opens the sign-in from any screen once the API credentials are saved", async () => {
    serveStatus({ authorized: false });
    serveTelegramAuth(true);
    const { user } = await renderApp({ route: ANY_SCREEN });

    await screen.findByText(new RegExp(SIGNED_OUT_TEXT));
    await user.click(await screen.findByRole("button", { name: "Connecta Telegram" }));

    expect(await screen.findByRole("textbox", { name: "Número de telèfon" })).toBeVisible();
  });

  it("sends to Settings when there are no API credentials to sign in with", async () => {
    serveStatus({ authorized: false });
    serveTelegramAuth(false);
    await renderApp({ route: ANY_SCREEN });

    const link = await screen.findByRole("link", { name: "Connecta Telegram" });

    expect(link).toHaveAttribute("href", "/settings");
  });

  it("goes away after a sign-in, and the dialog stays to say it worked", async () => {
    let authorized = false;
    server.use(
      http.get("/api/status", () => HttpResponse.json({ ...STATUS, authorized })),
      http.get("/api/telegram/auth", () => HttpResponse.json({ authorized, api_ready: true })),
      http.post("/api/telegram/auth/send_code", () => HttpResponse.json({ ok: true })),
      http.post("/api/telegram/auth/sign_in", () => {
        authorized = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = await renderApp({ route: ANY_SCREEN });

    await user.click(await screen.findByRole("button", { name: "Connecta Telegram" }));
    await user.type(await screen.findByRole("textbox", { name: "Número de telèfon" }), "+34600000000{Enter}");
    await user.type(await screen.findByRole("textbox", { name: "Codi d’inici de sessió" }), "12345{Enter}");

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: "Telegram connectat" })).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Fet" }));
    expect(screen.queryByText(new RegExp(SIGNED_OUT_TEXT))).not.toBeInTheDocument();
  });

  it("leaves the Dashboard to its own status line", async () => {
    serveStatus({ authorized: false });
    serveTelegramAuth(true);
    server.use(
      http.get("/api/downloads", () => HttpResponse.json([])),
      http.get("/api/channels", () => HttpResponse.json([])),
      http.get("/api/activity", () => HttpResponse.json([])),
    );
    await renderApp({ route: "/" });

    expect(await screen.findByRole("heading", { level: 1, name: "Tauler" })).toBeVisible();
    await screen.findAllByRole("status");

    expect(screen.queryByText(new RegExp(SIGNED_OUT_TEXT))).not.toBeInTheDocument();
  });
});

describe("the budget banner", () => {
  it("says when the downloads resume", async () => {
    const resetsAt = new Date(2026, 10, 7, 9, 5).getTime() / 1000;
    serveStatus({ budget: { limit_gb: 20, used_bytes: 20 * GB, exhausted: true, resets_at: resetsAt } });
    await renderApp({ route: ANY_SCREEN });

    const message = await screen.findByText(new RegExp(BUDGET_TEXT));

    expect(message).toHaveTextContent("09:05");
  });

  it("stays away while there is budget left", async () => {
    await renderApp({ route: ANY_SCREEN });

    expect(await screen.findByText("Telegram connectat")).toBeVisible();
    expect(screen.queryByText(new RegExp(BUDGET_TEXT))).not.toBeInTheDocument();
  });
});

describe("the Telegram state in the sidebar", () => {
  it("says it is connected", async () => {
    await renderApp({ route: ANY_SCREEN });

    expect(await screen.findByText("Telegram connectat")).toBeVisible();
  });

  it("says it is not", async () => {
    serveStatus({ authorized: false });
    serveTelegramAuth(true);
    await renderApp({ route: ANY_SCREEN });

    expect(await screen.findByText("Telegram desconnectat")).toBeVisible();
  });

  it("says nothing before the first answer", async () => {
    server.use(http.get("/api/status", () => HttpResponse.error()));
    await renderApp({ route: ANY_SCREEN });

    await screen.findByRole("heading", { level: 1 });

    expect(screen.queryByText(/^Telegram (connectat|desconnectat)$/)).not.toBeInTheDocument();
  });
});
