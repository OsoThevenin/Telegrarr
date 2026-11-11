import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { copyText } from "@/lib/clipboard";
import type { Settings } from "@/lib/settings";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";
import { settingsHandlers, settingsResponse } from "@/test/settings";

vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(true) }));

const SONARR_SAVED: Partial<Settings> = { sonarr_url: "http://sonarr:8989", sonarr_key_set: true };
const RADARR_SAVED: Partial<Settings> = { radarr_url: "http://radarr:7878", radarr_key_set: true };

const CONNECTED = (app: string) => HttpResponse.json({ app, ok: true, version: "4.0.1" });

function openConnect() {
  return renderApp({ route: "/connect" });
}

function appCard(name: string) {
  return screen.findByRole("group", { name });
}

function radarrChoices() {
  return http.get("/api/connect/radarr/defaults", () =>
    HttpResponse.json({
      quality_profiles: [
        { id: 1, name: "HD" },
        { id: 7, name: "4K" },
      ],
      root_folders: [{ path: "/movies" }, { path: "/films" }],
      selected: { quality_profile_id: 1, root_folder: "/movies" },
    }),
  );
}

describe("a fresh install", () => {
  it("tests nothing, and marks every app as not set up", async () => {
    const test = vi.fn();
    server.use(
      http.post("/api/connect/test", () => {
        test();
        return HttpResponse.json({});
      }),
      ...settingsHandlers(),
    );
    await openConnect();

    const sonarr = await appCard("Sonarr");

    expect(within(sonarr).getByText("No configurat")).toBeVisible();
    expect(within(sonarr).getByText("No configurat")).toHaveAttribute("data-tone", "neutral");
    expect(test).not.toHaveBeenCalled();
  });

  it("explains why registering is not possible yet", async () => {
    server.use(...settingsHandlers());
    await openConnect();

    expect(await screen.findByRole("button", { name: "Registra Telegrarr" })).toBeDisabled();
    expect(screen.getByText(/Desa primer una aplicació/)).toBeVisible();
  });

  it("does not offer Radarr defaults before Radarr is set up", async () => {
    server.use(...settingsHandlers());
    await openConnect();

    await appCard("Radarr");

    expect(screen.queryByText("Perfil de qualitat")).not.toBeInTheDocument();
  });
});

describe("each app", () => {
  it("shows its connection state on load", async () => {
    server.use(
      http.post("/api/connect/test", () => CONNECTED("sonarr")),
      ...settingsHandlers(SONARR_SAVED),
    );
    await openConnect();

    const sonarr = await appCard("Sonarr");

    expect(await within(sonarr).findByText("Connectat · v4.0.1")).toBeVisible();
    expect(within(sonarr).getByText("Connectat · v4.0.1")).toHaveAttribute("data-tone", "success");
  });

  it("shows a failure that arrives inside a 200", async () => {
    server.use(
      http.post("/api/connect/test", () =>
        HttpResponse.json({ app: "sonarr", ok: false, error: "Unauthorized" }),
      ),
      ...settingsHandlers(SONARR_SAVED),
    );
    await openConnect();

    const sonarr = await appCard("Sonarr");

    expect(await within(sonarr).findByRole("alert")).toHaveTextContent("Unauthorized");
    expect(within(sonarr).getByText("Error")).toBeVisible();
    expect(within(sonarr).getByText("Error")).toHaveAttribute("data-tone", "error");
  });

  it("shows the API key as saved after saving, then tests", async () => {
    let settings = settingsResponse();
    let patch: unknown;
    server.use(
      http.get("/api/settings", () => HttpResponse.json(settings)),
      http.patch("/api/settings", async ({ request }) => {
        patch = await request.json();
        settings = settingsResponse(SONARR_SAVED);
        return HttpResponse.json({ ok: true, settings: settings.settings });
      }),
      http.post("/api/connect/test", () => CONNECTED("sonarr")),
      ...settingsHandlers(),
    );
    const { user } = await openConnect();
    const sonarr = await appCard("Sonarr");

    await user.type(within(sonarr).getByLabelText("URL"), "http://sonarr:8989");
    await user.type(within(sonarr).getByLabelText(/^Clau de l’API/), "  secret  ");
    await user.click(within(sonarr).getByRole("button", { name: "Desa i prova" }));

    expect(await within(sonarr).findByText("Connectat · v4.0.1")).toBeVisible();
    expect(within(sonarr).getByText("Desat ••••")).toBeVisible();
    expect(patch).toEqual({ sonarr_url: "http://sonarr:8989", sonarr_key: "secret" });
  });

  it("retests without saving anything when nothing changed", async () => {
    const test = vi.fn();
    const patch = vi.fn();
    server.use(
      http.post("/api/connect/test", () => {
        test();
        return CONNECTED("sonarr");
      }),
      http.patch("/api/settings", () => {
        patch();
        return HttpResponse.json({});
      }),
      ...settingsHandlers(SONARR_SAVED),
    );
    const { user } = await openConnect();
    const sonarr = await appCard("Sonarr");
    await within(sonarr).findByText("Connectat · v4.0.1");

    await user.click(within(sonarr).getByRole("button", { name: "Desa i prova" }));

    await vi.waitFor(() => expect(test).toHaveBeenCalledTimes(2));
    expect(patch).not.toHaveBeenCalled();
  });

  it("says when a saved app still cannot be tested", async () => {
    let settings = settingsResponse();
    server.use(
      http.get("/api/settings", () => HttpResponse.json(settings)),
      http.patch("/api/settings", () => {
        settings = settingsResponse({ sonarr_url: "http://sonarr:8989" });
        return HttpResponse.json({ ok: true, settings: settings.settings });
      }),
      ...settingsHandlers(),
    );
    const { user } = await openConnect();
    const sonarr = await appCard("Sonarr");

    await user.type(within(sonarr).getByLabelText("URL"), "http://sonarr:8989");
    await user.click(within(sonarr).getByRole("button", { name: "Desa i prova" }));

    expect(await within(sonarr).findByText(/Falta l’URL o la clau/)).toBeVisible();
  });

  it("keeps the typed key when the save is refused", async () => {
    server.use(
      http.patch("/api/settings", () =>
        HttpResponse.json({ detail: { key: "err.settings.env_locked", params: { env: "SONARR_API_KEY" } } }, { status: 400 }),
      ),
      ...settingsHandlers(),
    );
    const { user } = await openConnect();
    const sonarr = await appCard("Sonarr");

    await user.type(within(sonarr).getByLabelText(/^Clau de l’API/), "secret");
    await user.click(within(sonarr).getByRole("button", { name: "Desa i prova" }));

    expect(await within(sonarr).findByRole("alert")).toHaveTextContent("SONARR_API_KEY");
    expect(within(sonarr).getByLabelText(/^Clau de l’API/)).toHaveValue("secret");
  });
});

/** Answers PATCH /api/settings as the backend would, and records what was sent. */
function recordPatches(respond: (patch: Record<string, unknown>) => Partial<Settings>) {
  const patches: Record<string, unknown>[] = [];
  server.use(
    http.patch("/api/settings", async ({ request }) => {
      const patch = (await request.json()) as Record<string, unknown>;
      patches.push(patch);
      return HttpResponse.json({ ok: true, settings: settingsResponse(respond(patch)).settings });
    }),
  );
  return patches;
}

describe("a value set by an environment variable", () => {
  const URL_LOCKED: Partial<Settings> = { sonarr_url: "http://sonarr.env:8989", sonarr_url_env_locked: true };

  it("shows a locked URL read-only, with its value and where it comes from", async () => {
    server.use(...settingsHandlers(URL_LOCKED));
    await openConnect();
    const sonarr = await appCard("Sonarr");

    const url = within(sonarr).getByLabelText("URL");

    expect(url).toHaveValue("http://sonarr.env:8989");
    expect(url).toHaveAttribute("readonly");
    expect(url).toHaveAccessibleDescription("Definit per variable d’entorn");
  });

  it("saves a key with the URL locked, leaving the URL out of the patch, then tests", async () => {
    const patches = recordPatches(() => ({ ...URL_LOCKED, sonarr_key_set: true }));
    server.use(http.post("/api/connect/test", () => CONNECTED("sonarr")), ...settingsHandlers(URL_LOCKED));
    const { user } = await openConnect();
    const sonarr = await appCard("Sonarr");

    await user.type(within(sonarr).getByLabelText(/^Clau de l’API/), "secret");
    await user.click(within(sonarr).getByRole("button", { name: "Desa i prova" }));

    expect(await within(sonarr).findByText("Connectat · v4.0.1")).toBeVisible();
    expect(patches).toEqual([{ sonarr_key: "secret" }]);
  });

  it("sends nothing but still tests when everything on the card is locked", async () => {
    const locked: Partial<Settings> = { ...URL_LOCKED, sonarr_key_set: true, sonarr_key_env_locked: true };
    const patches = recordPatches(() => locked);
    const test = vi.fn();
    server.use(
      http.post("/api/connect/test", () => {
        test();
        return CONNECTED("sonarr");
      }),
      ...settingsHandlers(locked),
    );
    const { user } = await openConnect();
    const sonarr = await appCard("Sonarr");
    await within(sonarr).findByText("Connectat · v4.0.1");

    expect(within(sonarr).getByText("Definit per variable d’entorn", { selector: '[data-slot="badge"]' })).toBeVisible();
    expect(within(sonarr).queryByRole("button", { name: /Clau de l’API/ })).not.toBeInTheDocument();

    await user.click(within(sonarr).getByRole("button", { name: "Desa i prova" }));

    await vi.waitFor(() => expect(test).toHaveBeenCalledTimes(2));
    expect(patches).toEqual([]);
  });

  it("saves the URL when only the key is locked", async () => {
    const locked: Partial<Settings> = { sonarr_key_set: true, sonarr_key_env_locked: true };
    const patches = recordPatches((patch) => ({ ...locked, ...patch }));
    server.use(http.post("/api/connect/test", () => CONNECTED("sonarr")), ...settingsHandlers(locked));
    const { user } = await openConnect();
    const sonarr = await appCard("Sonarr");

    await user.type(within(sonarr).getByLabelText("URL"), "http://sonarr:8989");
    await user.click(within(sonarr).getByRole("button", { name: "Desa i prova" }));

    await vi.waitFor(() => expect(patches).toEqual([{ sonarr_url: "http://sonarr:8989" }]));
  });

  it("leaves out what was typed before the setting became locked", async () => {
    const patches = recordPatches(() => ({ ...URL_LOCKED, sonarr_key_set: true, sonarr_key_env_locked: true }));
    server.use(http.post("/api/connect/test", () => CONNECTED("sonarr")), ...settingsHandlers());
    const { user } = await openConnect();
    const sonarr = await appCard("Sonarr");
    const radarr = await appCard("Radarr");

    await user.type(within(sonarr).getByLabelText("URL"), "http://typed");
    await user.type(within(sonarr).getByLabelText(/^Clau de l’API/), "typed-key");
    await user.type(within(radarr).getByLabelText("URL"), "http://radarr:7878");
    await user.click(within(radarr).getByRole("button", { name: "Desa i prova" }));

    const url = await within(sonarr).findByDisplayValue("http://sonarr.env:8989");
    expect(url).toHaveAttribute("readonly");

    await user.click(within(sonarr).getByRole("button", { name: "Desa i prova" }));

    await vi.waitFor(() => expect(within(sonarr).getByText(/^Connectat/)).toBeVisible());
    expect(patches).toEqual([{ radarr_url: "http://radarr:7878" }]);
  });
});

describe("the external URL", () => {
  const EXTERNAL = "https://radarr.example.com";

  it("is offered for Radarr and Sonarr, not Prowlarr", async () => {
    server.use(...settingsHandlers());
    await openConnect();

    expect(within(await appCard("Radarr")).getByLabelText("URL externa")).toBeVisible();
    expect(within(await appCard("Sonarr")).getByLabelText("URL externa")).toBeVisible();
    expect(within(await appCard("Prowlarr")).queryByLabelText("URL externa")).not.toBeInTheDocument();
  });

  it("saves only itself, and comes back from the server", async () => {
    const patches = recordPatches((patch) => ({ ...RADARR_SAVED, ...patch }));
    server.use(radarrChoices(), http.post("/api/connect/test", () => CONNECTED("radarr")), ...settingsHandlers(RADARR_SAVED));
    const { user } = await openConnect();
    const radarr = await appCard("Radarr");

    await user.type(within(radarr).getByLabelText("URL externa"), EXTERNAL);
    await user.click(within(radarr).getByRole("button", { name: "Desa i prova" }));

    await vi.waitFor(() => expect(patches).toEqual([{ radarr_external_url: EXTERNAL }]));
    expect(within(radarr).getByLabelText("URL externa")).toHaveValue(EXTERNAL);
  });

  it("clears by saving it empty", async () => {
    const saved: Partial<Settings> = { ...RADARR_SAVED, radarr_external_url: EXTERNAL };
    const patches = recordPatches((patch) => ({ ...saved, ...patch }));
    server.use(radarrChoices(), http.post("/api/connect/test", () => CONNECTED("radarr")), ...settingsHandlers(saved));
    const { user } = await openConnect();
    const radarr = await appCard("Radarr");

    await user.clear(within(radarr).getByLabelText("URL externa"));
    await user.click(within(radarr).getByRole("button", { name: "Desa i prova" }));

    await vi.waitFor(() => expect(patches).toEqual([{ radarr_external_url: "" }]));
    expect(within(radarr).getByLabelText("URL externa")).toHaveValue("");
  });

  it("shows why a URL was refused on the card, and keeps it for fixing", async () => {
    server.use(
      http.patch("/api/settings", () =>
        HttpResponse.json({ detail: { key: "err.settings.url_scheme" } }, { status: 400 }),
      ),
      radarrChoices(),
      http.post("/api/connect/test", () => CONNECTED("radarr")),
      ...settingsHandlers(RADARR_SAVED),
    );
    const { user } = await openConnect();
    const radarr = await appCard("Radarr");

    await user.type(within(radarr).getByLabelText("URL externa"), "ftp://radarr");
    await user.click(within(radarr).getByRole("button", { name: "Desa i prova" }));

    expect(await within(radarr).findByRole("alert")).toHaveTextContent("http://");
    expect(within(radarr).getByLabelText("URL externa")).toHaveValue("ftp://radarr");
  });
});

describe("registering", () => {
  it("saves the address it was given, then reports each app", async () => {
    let patch: unknown;
    server.use(
      http.post("/api/connect/test", () => CONNECTED("sonarr")),
      http.patch("/api/settings", async ({ request }) => {
        patch = await request.json();
        return HttpResponse.json({
          ok: true,
          settings: settingsResponse({ ...SONARR_SAVED, telegrarr_url: "http://telegrarr:8790" }).settings,
        });
      }),
      http.post("/api/connect/register", () =>
        HttpResponse.json({
          results: [{ app: "sonarr", kind: "download_client", name: "Telegrarr", status: "created" }],
        }),
      ),
      ...settingsHandlers(SONARR_SAVED),
    );
    const { user } = await openConnect();
    const url = await screen.findByLabelText(/^URL de Telegrarr/);

    await user.clear(url);
    await user.type(url, "http://telegrarr:8790");
    await user.click(screen.getByRole("button", { name: "Registra Telegrarr" }));

    expect(await screen.findByText("Registrat a 1 aplicació")).toBeVisible();
    expect(screen.getByText(/Sonarr · client de baixades: creat/)).toBeVisible();
    expect(patch).toEqual({ telegrarr_url: "http://telegrarr:8790" });
  });

  it("does not call a failed registration a success", async () => {
    server.use(
      http.post("/api/connect/test", () => CONNECTED("sonarr")),
      http.post("/api/connect/register", () =>
        HttpResponse.json({
          results: [
            { app: "sonarr", kind: "download_client", name: "Telegrarr", status: "error", error: "Refused" },
          ],
        }),
      ),
      ...settingsHandlers({ ...SONARR_SAVED, telegrarr_url: "http://telegrarr:8790" }),
    );
    const { user } = await openConnect();

    await user.click(await screen.findByRole("button", { name: "Registra Telegrarr" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Refused");
    expect(screen.queryByText("No hi ha res de nou per registrar")).not.toBeInTheDocument();
  });

  it("warns that an app in a container cannot reach a loopback address", async () => {
    server.use(
      http.post("/api/connect/test", () => CONNECTED("sonarr")),
      ...settingsHandlers({ ...SONARR_SAVED, telegrarr_url: "http://localhost:8790" }),
    );
    await openConnect();

    const warning = (await screen.findByText(/no podrà arribar/)).closest("p");

    expect(warning).toBeVisible();
    expect(warning).toHaveAttribute("data-tone", "warning");
    expect(warning).not.toHaveTextContent(/^!/);
    expect(warning?.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("says when the address is only a suggestion", async () => {
    server.use(...settingsHandlers());
    await openConnect();

    expect(await screen.findByText(/Encara no està desada/)).toBeVisible();
  });

  it("shows why the address could not be saved, and does not register", async () => {
    const register = vi.fn();
    server.use(
      http.post("/api/connect/test", () => CONNECTED("sonarr")),
      http.patch("/api/settings", () => HttpResponse.json({ detail: "Refused" }, { status: 400 })),
      http.post("/api/connect/register", () => {
        register();
        return HttpResponse.json({ results: [] });
      }),
      ...settingsHandlers(SONARR_SAVED),
    );
    const { user } = await openConnect();

    await user.click(await screen.findByRole("button", { name: "Registra Telegrarr" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Refused");
    expect(register).not.toHaveBeenCalled();
  });
});

describe("Radarr defaults", () => {
  it("saves the chosen profile as a number", async () => {
    let body: unknown;
    server.use(
      http.post("/api/connect/test", () => CONNECTED("radarr")),
      radarrChoices(),
      http.put("/api/connect/radarr/defaults", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
      ...settingsHandlers(RADARR_SAVED),
    );
    const { user } = await openConnect();

    await user.selectOptions(await screen.findByLabelText("Perfil de qualitat"), await screen.findByRole("option", { name: "4K" }));
    await user.click(screen.getByRole("button", { name: "Desa els valors" }));

    expect(await screen.findByText("Desat")).toBeVisible();
    expect(body).toEqual({ quality_profile_id: 7, root_folder: "/movies" });
  });

  it("shows inline when Radarr cannot offer its choices", async () => {
    server.use(
      http.post("/api/connect/test", () => CONNECTED("radarr")),
      http.get("/api/connect/radarr/defaults", () => HttpResponse.json({ detail: "Timed out" }, { status: 502 })),
      ...settingsHandlers(RADARR_SAVED),
    );
    await openConnect();

    expect(await screen.findByRole("alert")).toHaveTextContent("Timed out");
  });
});

describe("manual setup", () => {
  it("masks the key and copies the whole of it", async () => {
    server.use(...settingsHandlers());
    const { user } = await openConnect();

    await screen.findByText("••••wxyz");
    await user.click(screen.getByRole("button", { name: "Copia la clau" }));

    expect(copyText).toHaveBeenCalledWith("abcdef123456wxyz");
    expect(screen.queryByText("abcdef123456wxyz")).not.toBeInTheDocument();
    expect(await screen.findByText("S’ha copiat al porta-retalls")).toBeVisible();
  });

  it("changes nothing when regenerating is cancelled", async () => {
    const regenerate = vi.fn();
    server.use(
      http.post("/api/integrations/arr/regenerate", () => {
        regenerate();
        return HttpResponse.json({ apikey: "new" });
      }),
      ...settingsHandlers(),
    );
    const { user } = await openConnect();

    await user.click(await screen.findByRole("button", { name: "Regenera la clau" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel·la" }));

    expect(regenerate).not.toHaveBeenCalled();
  });

  it("warns that a new key must be changed in each app, then shows it", async () => {
    server.use(
      http.post("/api/integrations/arr/regenerate", () => HttpResponse.json({ apikey: "0000111122223333" })),
      ...settingsHandlers(),
    );
    const { user } = await openConnect();

    await user.click(await screen.findByRole("button", { name: "Regenera la clau" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Prowlarr, Sonarr i Radarr/);
    await user.click(within(dialog).getByRole("button", { name: "Regenera" }));

    expect(await screen.findByText("••••3333")).toBeVisible();
  });
});

describe("on a phone", () => {
  it("gives every action a full-size touch target", async () => {
    server.use(
      http.post("/api/connect/test", () => CONNECTED("radarr")),
      radarrChoices(),
      ...settingsHandlers(RADARR_SAVED),
    );
    await openConnect();
    await screen.findByRole("button", { name: "Desa els valors" });

    const actions = [
      ...screen.getAllByRole("button", { name: "Desa i prova" }),
      ...["Registra Telegrarr", "Desa els valors", "Copia l’URL", "Copia la clau", "Regenera la clau"].map((name) =>
        screen.getByRole("button", { name }),
      ),
    ];

    for (const action of actions) expect(action).toHaveClass("h-11", "sm:h-7");
  });
});
