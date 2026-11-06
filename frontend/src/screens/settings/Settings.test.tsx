import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { goToLogin } from "@/lib/browser";
import { chooseTheme, cycleTheme } from "@/lib/theme";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";
import { FRESH_SETTINGS, settingsHandlers, settingsResponse } from "@/test/settings";

vi.mock("@/lib/browser", () => ({ goToLogin: vi.fn() }));

type Patch = Record<string, unknown>;

/** Answers PATCH /api/settings with `result` merged in, and records what was sent. */
function acceptPatches(result: Patch = {}) {
  const patches: Patch[] = [];
  server.use(
    http.patch("/api/settings", async ({ request }) => {
      const patch = (await request.json()) as Patch;
      patches.push(patch);
      return HttpResponse.json({ ok: true, settings: { ...FRESH_SETTINGS, ...patch, ...result } });
    }),
  );
  return patches;
}

async function openTab(name: "Compte" | "Baixades" | "Integracions") {
  const { user } = await renderApp({ route: "/ui/settings" });
  await user.click(await screen.findByRole("tab", { name }));
  return user;
}

async function card(title: string) {
  const heading = await screen.findByText(title, { selector: '[data-slot="card-title"]' });
  return heading.closest<HTMLElement>('[data-slot="card"]')!;
}

describe("loading", () => {
  it("offers a retry when the settings cannot be read", async () => {
    server.use(http.get("/api/settings", () => HttpResponse.json({}, { status: 500 })));

    await renderApp({ route: "/ui/settings" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Error 500");
    expect(screen.getByRole("button", { name: "Torna-ho a provar" })).toBeVisible();
  });
});

describe("account", () => {
  it("changes the username through its dialog", async () => {
    server.use(
      ...settingsHandlers(),
      http.post("/api/account/username", () => HttpResponse.json({ ok: true, username: "pere" })),
    );
    const user = await openTab("Compte");

    await user.click(await screen.findByRole("button", { name: "Canvia el nom d’usuari" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Nom d’usuari/), "pere");
    await user.type(within(dialog).getByLabelText(/^Confirma la contrasenya/), "secret");
    await user.click(within(dialog).getByRole("button", { name: "Desa" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/El nom d’usuari ara és pere/)).toBeVisible();
  });

  it("shows a refused username inside the dialog", async () => {
    server.use(
      ...settingsHandlers(),
      http.post("/api/account/username", () =>
        HttpResponse.json({ detail: { key: "err.account.username_taken" } }, { status: 400 }),
      ),
    );
    const user = await openTab("Compte");

    await user.click(await screen.findByRole("button", { name: "Canvia el nom d’usuari" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Nom d’usuari/), "pere");
    await user.type(within(dialog).getByLabelText(/^Confirma la contrasenya/), "secret");
    await user.click(within(dialog).getByRole("button", { name: "Desa" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Aquest nom d’usuari ja està agafat");
  });

  it("refuses a repeated password that does not match, without calling the server", async () => {
    const posts = vi.fn();
    server.use(
      ...settingsHandlers(),
      http.post("/api/account/password", () => {
        posts();
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = await openTab("Compte");

    await user.click(await screen.findByRole("button", { name: "Canvia la contrasenya" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Contrasenya actual"), "old-password");
    await user.type(within(dialog).getByLabelText(/^Contrasenya nova/), "new-password-1");
    await user.type(within(dialog).getByLabelText("Repeteix la contrasenya nova"), "new-password-2");
    await user.click(within(dialog).getByRole("button", { name: "Desa" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Les contrasenyes noves no coincideixen");
    expect(posts).not.toHaveBeenCalled();
  });

  it("sends the operator to sign in again after a password change, which ends the session", async () => {
    let body: unknown;
    server.use(
      ...settingsHandlers(),
      http.post("/api/account/password", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = await openTab("Compte");

    await user.click(await screen.findByRole("button", { name: "Canvia la contrasenya" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Contrasenya actual"), "old-password");
    await user.type(within(dialog).getByLabelText(/^Contrasenya nova/), "new-password-1");
    await user.type(within(dialog).getByLabelText("Repeteix la contrasenya nova"), "new-password-1");
    await user.click(within(dialog).getByRole("button", { name: "Desa" }));

    await waitFor(() => expect(goToLogin).toHaveBeenCalled());
    expect(body).toEqual({ current: "old-password", new: "new-password-1" });
  });
});

describe("the theme", () => {
  afterEach(() => chooseTheme("auto"));

  it("follows a change made from the command palette", async () => {
    server.use(...settingsHandlers());
    await openTab("Compte");
    const select = await screen.findByLabelText(/^Tema/);

    act(() => cycleTheme());

    expect(select).toHaveValue("light");
  });
});

describe("autonomous mode", () => {
  it("explains what turning it on does, and Cancel changes nothing", async () => {
    server.use(...settingsHandlers());
    const patches = acceptPatches();
    const user = await openTab("Baixades");

    await user.click(await screen.findByRole("switch", { name: "Mode autònom" }));
    const dialog = await screen.findByRole("alertdialog");

    expect(dialog).toHaveTextContent("Experimental");
    expect(dialog).toHaveTextContent("Sonarr i Radarr deixaran de decidir");

    await user.click(within(dialog).getByRole("button", { name: "Cancel·la" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(patches).toEqual([]);
    expect(screen.getByRole("switch", { name: "Mode autònom" })).not.toBeChecked();
  });

  it("turns on only once confirmed", async () => {
    server.use(...settingsHandlers());
    const patches = acceptPatches();
    const user = await openTab("Baixades");

    await user.click(await screen.findByRole("switch", { name: "Mode autònom" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Activa" }));

    await waitFor(() => expect(screen.getByRole("switch", { name: "Mode autònom" })).toBeChecked());
    expect(patches).toEqual([{ operating_mode: "standalone" }]);
  });

  it("explains that turning it off leaves queued transfers running", async () => {
    server.use(...settingsHandlers({ operating_mode: "standalone" }));
    const patches = acceptPatches({ operating_mode: "arr" });
    const user = await openTab("Baixades");

    await user.click(await screen.findByRole("switch", { name: "Mode autònom" }));
    const dialog = await screen.findByRole("alertdialog");

    expect(dialog).toHaveTextContent("Experimental");
    expect(dialog).toHaveTextContent("Sonarr i Radarr decideixen");
    expect(dialog).toHaveTextContent("continuen");

    await user.click(within(dialog).getByRole("button", { name: "Desactiva" }));

    await waitFor(() => expect(screen.getByRole("switch", { name: "Mode autònom" })).not.toBeChecked());
    expect(patches).toEqual([{ operating_mode: "arr" }]);
  });
});

describe("the performance form", () => {
  it("sends only what changed", async () => {
    server.use(...settingsHandlers());
    const patches = acceptPatches();
    const user = await openTab("Baixades");

    const workers = await screen.findByLabelText(/^Connexions en paral·lel/);
    await user.clear(workers);
    await user.type(workers, "8");
    await user.click(screen.getByRole("button", { name: "Desa el rendiment" }));

    await screen.findByText("S’ha desat el rendiment");
    expect(patches).toEqual([{ dl_workers: "8" }]);
  });

  it("re-renders from the response and says when the server adjusted a value", async () => {
    server.use(...settingsHandlers());
    acceptPatches({ dl_workers: 32 });
    const user = await openTab("Baixades");

    const workers = await screen.findByLabelText(/^Connexions en paral·lel/);
    await user.clear(workers);
    await user.type(workers, "20");
    await user.click(screen.getByRole("button", { name: "Desa el rendiment" }));

    await waitFor(() => expect(workers).toHaveValue(32));
    expect(screen.getByText(/ha ajustat/)).toBeVisible();
    expect(screen.queryByText("S’ha desat el rendiment")).not.toBeInTheDocument();
  });

  it("keeps what was typed when the save is refused", async () => {
    server.use(
      ...settingsHandlers(),
      http.patch("/api/settings", () =>
        HttpResponse.json({ detail: { key: "err.settings.env_locked", params: { env: "DL_WORKERS" } } }, { status: 400 }),
      ),
    );
    const user = await openTab("Baixades");

    const workers = await screen.findByLabelText(/^Connexions en paral·lel/);
    await user.clear(workers);
    await user.type(workers, "8");
    await user.click(screen.getByRole("button", { name: "Desa el rendiment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("DL_WORKERS");
    expect(workers).toHaveValue(8);
  });
});

describe("secrets", () => {
  it("shows TMDB as saved, and Clear sends an empty value", async () => {
    server.use(...settingsHandlers({ tmdb_key_set: true }));
    const patches = acceptPatches({ tmdb_key_set: false });
    const user = await openTab("Integracions");
    const tmdb = await card("Imatges (TMDB)");

    expect(within(tmdb).getByText("Desat ••••")).toBeVisible();

    await user.click(within(tmdb).getByRole("button", { name: "Esborra Clau de l’API" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Esborra" }));

    await waitFor(() => expect(within(tmdb).getByLabelText("Clau de l’API")).toBeVisible());
    expect(patches).toEqual([{ tmdb_key: "" }]);
  });

  it("never sends a blank replacement, which would clear the key", async () => {
    server.use(
      ...settingsHandlers({ tmdb_key_set: true }),
      http.post("/api/integrations/tmdb/test", () => HttpResponse.json({ ok: true, detail: "OK" })),
    );
    const patches = acceptPatches({ tmdb_key_set: true });
    const user = await openTab("Integracions");
    const tmdb = await card("Imatges (TMDB)");

    await user.click(within(tmdb).getByRole("button", { name: "Substitueix Clau de l’API" }));
    await user.type(within(tmdb).getByLabelText("Clau de l’API"), "   ");
    await user.click(within(tmdb).getByRole("button", { name: "Desa i prova" }));

    await within(tmdb).findByText("OK");
    expect(patches).toEqual([]);
  });

  it("shows a failed test that arrives inside a 200 as a failure", async () => {
    server.use(
      ...settingsHandlers({ plex_url: "http://plex:32400", plex_token_set: true }),
      http.post("/api/integrations/plex/test", () => HttpResponse.json({ ok: false, detail: "Unauthorized" })),
    );
    const user = await openTab("Integracions");
    const plex = await card("Plex");

    await user.click(within(plex).getByRole("button", { name: "Desa i prova" }));

    expect(await within(plex).findByRole("alert")).toHaveTextContent("Unauthorized");
  });
});

describe("a value set by an environment variable", () => {
  const LOCKED_LABEL = "Definit per variable d’entorn";

  it("shows a locked TMDB key read-only, and Save & test only tests", async () => {
    const patches = acceptPatches();
    const test = vi.fn();
    server.use(
      http.post("/api/integrations/tmdb/test", () => {
        test();
        return HttpResponse.json({ ok: true });
      }),
      ...settingsHandlers({ tmdb_key_set: true, tmdb_key_env_locked: true }),
    );
    const user = await openTab("Integracions");
    const tmdb = await card("Imatges (TMDB)");

    expect(within(tmdb).getByText(LOCKED_LABEL)).toBeVisible();
    expect(within(tmdb).queryByRole("button", { name: /Esborra|Substitueix/ })).not.toBeInTheDocument();

    await user.click(within(tmdb).getByRole("button", { name: "Desa i prova" }));

    await waitFor(() => expect(test).toHaveBeenCalledOnce());
    expect(patches).toEqual([]);
  });

  it("saves the Plex token with the Plex URL locked, leaving the URL out", async () => {
    const locked = { plex_url: "http://plex.env:32400", plex_url_env_locked: true };
    const patches = acceptPatches(locked);
    server.use(
      http.post("/api/integrations/plex/test", () => HttpResponse.json({ ok: true })),
      ...settingsHandlers(locked),
    );
    const user = await openTab("Integracions");
    const plex = await card("Plex");

    const url = within(plex).getByLabelText("URL del servidor");
    expect(url).toHaveValue("http://plex.env:32400");
    expect(url).toHaveAttribute("readonly");
    expect(url).toHaveAccessibleDescription(LOCKED_LABEL);

    await user.type(within(plex).getByLabelText("Testimoni"), "token");
    await user.click(within(plex).getByRole("button", { name: "Desa i prova" }));

    await waitFor(() => expect(patches).toEqual([{ plex_token: "token" }]));
  });

  it("saves the Plex URL with the Plex token locked", async () => {
    const locked = { plex_token_set: true, plex_token_env_locked: true };
    const patches = acceptPatches(locked);
    server.use(
      http.post("/api/integrations/plex/test", () => HttpResponse.json({ ok: true })),
      ...settingsHandlers(locked),
    );
    const user = await openTab("Integracions");
    const plex = await card("Plex");

    expect(within(plex).getByText(LOCKED_LABEL)).toBeVisible();

    await user.type(within(plex).getByLabelText("URL del servidor"), "http://plex:32400");
    await user.click(within(plex).getByRole("button", { name: "Desa i prova" }));

    await waitFor(() => expect(patches).toEqual([{ plex_url: "http://plex:32400" }]));
  });

  it("shows a locked proxy read-only, with where it points and nothing to connect", async () => {
    server.use(
      http.get("/api/telegram/proxy", () => HttpResponse.json({ proxy: "socks5://host:1080" })),
      ...settingsHandlers({ proxy_set: true, tg_proxy_env_locked: true }),
    );
    await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    expect(await within(telegram).findByText("socks5://host:1080")).toBeVisible();
    expect(within(telegram).getByText(LOCKED_LABEL)).toBeVisible();
    expect(within(telegram).queryByLabelText("URL del servidor intermediari")).not.toBeInTheDocument();
    expect(within(telegram).queryByRole("button", { name: "Connecta" })).not.toBeInTheDocument();
  });

  it("shows the Telegram API ID and hash read-only when both are locked", async () => {
    server.use(
      http.get("/api/telegram/auth", () => HttpResponse.json({ authorized: false, api_ready: true })),
      ...settingsHandlers({ tg_api_id_env_locked: true, tg_api_hash_env_locked: true }),
    );
    await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    await within(telegram).findByText("API ID");
    expect(within(telegram).getByText("API hash")).toBeVisible();
    expect(within(telegram).getAllByText(LOCKED_LABEL)).toHaveLength(2);
    expect(within(telegram).queryByRole("button", { name: /API hash/ })).not.toBeInTheDocument();
    expect(within(telegram).queryByRole("button", { name: "Desa" })).not.toBeInTheDocument();
  });

  it("explains that the Telegram pair cannot be finished here when only one is locked", async () => {
    server.use(
      http.get("/api/telegram/auth", () => HttpResponse.json({ authorized: false, api_ready: false })),
      ...settingsHandlers({ tg_api_id_env_locked: true }),
    );
    await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    expect(await within(telegram).findByText(/Defineix també l’altra variable/)).toBeVisible();
    expect(within(telegram).getAllByText(LOCKED_LABEL)).toHaveLength(1);
    expect(within(telegram).queryByLabelText("API hash")).not.toBeInTheDocument();
    expect(within(telegram).queryByRole("button", { name: "Desa" })).not.toBeInTheDocument();
  });
});

describe("Telegram", () => {
  it("saves the API hash through its own endpoint, because a settings patch ignores it", async () => {
    let body: unknown;
    let apiReady = false;
    server.use(
      http.get("/api/telegram/auth", () => HttpResponse.json({ authorized: false, api_ready: apiReady })),
      http.post("/api/telegram/auth/api", async ({ request }) => {
        body = await request.json();
        apiReady = true;
        return HttpResponse.json({ ok: true });
      }),
      ...settingsHandlers(),
    );
    const user = await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    await user.type(await within(telegram).findByLabelText("API ID"), "12345");
    await user.type(within(telegram).getByLabelText("API hash"), "hash");
    await user.click(within(telegram).getByRole("button", { name: "Desa" }));

    expect(await within(telegram).findByText("Desat ••••")).toBeVisible();
    expect(body).toEqual({ api_id: "12345", api_hash: "hash" });
  });

  it("shows a refusal that arrives inside a 200", async () => {
    server.use(
      http.post("/api/telegram/auth/api", () =>
        HttpResponse.json({ error: { key: "err.tg.api_id_number" } }),
      ),
      ...settingsHandlers(),
    );
    const user = await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    await user.type(await within(telegram).findByLabelText("API ID"), "x");
    await user.type(within(telegram).getByLabelText("API hash"), "hash");
    await user.click(within(telegram).getByRole("button", { name: "Desa" }));

    expect(await within(telegram).findByRole("alert")).toHaveTextContent("L’API ID ha de ser un número");
  });

  it("signs in by phone, code and two-step password", async () => {
    let authorized = false;
    server.use(
      http.get("/api/telegram/auth", () => HttpResponse.json({ authorized, api_ready: true })),
      http.post("/api/telegram/auth/send_code", () => HttpResponse.json({ ok: true })),
      http.post("/api/telegram/auth/sign_in", () => HttpResponse.json({ need_password: true })),
      http.post("/api/telegram/auth/password", () => {
        authorized = true;
        return HttpResponse.json({ ok: true });
      }),
      ...settingsHandlers(),
    );
    const user = await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    await user.click(await within(telegram).findByRole("button", { name: "Connecta Telegram" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Número de telèfon"), "+34600000000");
    await user.click(within(dialog).getByRole("button", { name: "Envia el codi" }));
    await user.type(await within(dialog).findByLabelText("Codi d’inici de sessió"), "12345");
    await user.click(within(dialog).getByRole("button", { name: "Verifica" }));
    await user.type(await within(dialog).findByLabelText(/^Contrasenya de verificació/), "two-step");
    await user.click(within(dialog).getByRole("button", { name: "Continua" }));
    await user.click(await within(dialog).findByRole("button", { name: "Fet" }));

    expect(await within(telegram).findByRole("button", { name: "Desconnecta" })).toBeVisible();
  });

  it("asks before disconnecting", async () => {
    const logout = vi.fn();
    server.use(
      http.get("/api/telegram/auth", () => HttpResponse.json({ authorized: true, api_ready: true })),
      http.post("/api/telegram/auth/logout", () => {
        logout();
        return HttpResponse.json({ ok: true });
      }),
      ...settingsHandlers(),
    );
    const user = await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    await user.click(await within(telegram).findByRole("button", { name: "Desconnecta" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel·la" }));

    expect(logout).not.toHaveBeenCalled();
  });

  it("refreshes the proxy state even when connecting through it fails, because it was still saved", async () => {
    let saved = "";
    server.use(
      http.get("/api/settings", () => HttpResponse.json(settingsResponse({ proxy_set: saved !== "" }))),
      http.get("/api/telegram/proxy", () => HttpResponse.json({ proxy: saved })),
      http.post("/api/telegram/proxy", () => {
        saved = "socks5://host:1080";
        return HttpResponse.json({ error: { key: "err.tg.proxy", params: { error: "timeout" } } });
      }),
      ...settingsHandlers(),
    );
    const user = await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    await user.type(await within(telegram).findByLabelText("URL del servidor intermediari"), "socks5://host:1080");
    await user.click(within(telegram).getByRole("button", { name: "Connecta" }));

    expect(await within(telegram).findByRole("alert")).toHaveTextContent("timeout");
    expect(await within(telegram).findByText("Desat socks5://host:1080")).toBeVisible();
  });

  it("keeps the typed proxy when env refuses it inside a 200, because nothing was saved", async () => {
    server.use(
      http.post("/api/telegram/proxy", () =>
        HttpResponse.json({ error: { key: "err.settings.env_locked", params: { env: "TELEARR_PROXY" } } }),
      ),
      ...settingsHandlers(),
    );
    const user = await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    await user.type(await within(telegram).findByLabelText("URL del servidor intermediari"), "socks5://host:1080");
    await user.click(within(telegram).getByRole("button", { name: "Connecta" }));

    expect(await within(telegram).findByRole("alert")).toHaveTextContent("TELEARR_PROXY");
    expect(within(telegram).getByLabelText("URL del servidor intermediari")).toHaveValue("socks5://host:1080");
  });

  it("shows the proxy as locked, with the reason, when the refusal comes from a stale page", async () => {
    let locked = false;
    server.use(
      http.get("/api/settings", () =>
        HttpResponse.json(settingsResponse({ proxy_set: locked, tg_proxy_env_locked: locked })),
      ),
      http.post("/api/telegram/proxy", () => {
        locked = true;
        return HttpResponse.json({ error: { key: "err.settings.env_locked", params: { env: "TELEARR_PROXY" } } });
      }),
      ...settingsHandlers(),
    );
    const user = await openTab("Integracions");
    const telegram = await card("Compte de Telegram");

    await user.type(await within(telegram).findByLabelText("URL del servidor intermediari"), "socks5://host:1080");
    await user.click(within(telegram).getByRole("button", { name: "Connecta" }));

    expect(await within(telegram).findByText("Definit per variable d’entorn")).toBeVisible();
    expect(within(telegram).getByRole("alert")).toHaveTextContent("TELEARR_PROXY");
  });
});
