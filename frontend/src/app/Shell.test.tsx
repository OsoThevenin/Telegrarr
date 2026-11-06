import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { goToLogin } from "@/lib/browser";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";

vi.mock("@/lib/browser", () => ({ goToLogin: vi.fn() }));

const SCREENS = [
  ["Tauler", "/ui/"],
  ["Canals", "/ui/channels"],
  ["Baixades", "/ui/downloads"],
  ["Activitat", "/ui/activity"],
  ["Revisió", "/ui/review"],
  ["Connexió", "/ui/connect"],
  ["Sistema", "/ui/system"],
  ["Configuració", "/ui/settings"],
] as const;

describe("navigation", () => {
  it.each(SCREENS)("reaches %s from the sidebar", async (name, url) => {
    const { router, user } = await renderApp({ route: "/ui/review" });
    const sidebar = screen.getByRole("navigation", { name: "Navegació principal" });

    await user.click(within(sidebar).getByRole("link", { name }));

    expect(await screen.findByRole("heading", { level: 1, name })).toBeVisible();
    expect(router.history.location.pathname).toBe(url);
    expect(document.title).toBe(`${name} · Telegrarr`);
  });

  it.each(SCREENS)("reaches %s from the drawer, which then closes", async (name, url) => {
    const { router, user } = await renderApp({ route: "/ui/review" });

    await user.click(screen.getByRole("button", { name: "Obre el menú" }));
    const drawer = await screen.findByRole("dialog", { name: "Menú" });
    await user.click(within(drawer).getByRole("link", { name }));

    expect(await screen.findByRole("heading", { level: 1, name })).toBeVisible();
    expect(router.history.location.pathname).toBe(url);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("starts the keyboard at the first link when the drawer opens", async () => {
    const { user } = await renderApp({ route: "/ui/review" });

    await user.click(screen.getByRole("button", { name: "Obre el menú" }));
    const drawer = await screen.findByRole("dialog", { name: "Menú" });

    await waitFor(() => expect(within(drawer).getByRole("link", { name: "Tauler" })).toHaveFocus());
  });

  it("opens a deep link on its own screen", async () => {
    await renderApp({ route: "/ui/settings" });

    expect(screen.getByRole("heading", { level: 1, name: "Configuració" })).toBeVisible();
  });

  it("offers a way out of an unknown path, inside the shell", async () => {
    const { user } = await renderApp({ route: "/ui/no-such-screen" });

    expect(screen.getByText("Aquesta pàgina no existeix.")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "Torna al tauler" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Tauler" })).toBeVisible();
  });

  it("signs out through the server", async () => {
    await renderApp();

    expect(screen.getByRole("link", { name: "Tanca la sessió" })).toHaveAttribute("href", "/logout");
  });
});

describe("language switch", () => {
  const languageSelect = () => screen.getByRole("combobox", { name: "Idioma" });

  it("saves the language and changes the shell strings without a reload", async () => {
    const saved: unknown[] = [];
    server.use(
      http.patch("/api/settings", async ({ request }) => {
        saved.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    const { user } = await renderApp({ route: "/ui/channels" });

    await user.selectOptions(languageSelect(), "English");

    expect(await screen.findByRole("link", { name: "Downloads" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Channels" })).toBeVisible();
    expect(saved).toEqual([{ ui_lang: "en" }]);
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Channels · Telegrarr");
  });

  it("stays on the current language and says why when saving fails", async () => {
    server.use(
      http.patch("/api/settings", () =>
        HttpResponse.json({ detail: { key: "err.settings.budget" } }, { status: 400 }),
      ),
    );
    const { user } = await renderApp();

    await user.selectOptions(languageSelect(), "English");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El pressupost diari ha de ser 0 (il·limitat) o més GB",
    );
    expect(languageSelect()).toHaveValue("ca");
    expect(screen.getByRole("link", { name: "Baixades" })).toBeVisible();
  });

  it("reports an unreachable backend", async () => {
    server.use(http.patch("/api/settings", () => HttpResponse.error()));
    const { user } = await renderApp();

    await user.selectOptions(languageSelect(), "English");

    expect(await screen.findByRole("alert")).toHaveTextContent("Error de xarxa");
  });
});

describe("expired session", () => {
  it("sends the user to the login page when the API answers 401", async () => {
    server.use(
      http.patch("/api/settings", () =>
        HttpResponse.json({ detail: "login required" }, { status: 401 }),
      ),
    );
    const { user } = await renderApp();

    await user.selectOptions(screen.getByRole("combobox", { name: "Idioma" }), "English");

    await waitFor(() => expect(goToLogin).toHaveBeenCalled());
  });
});
