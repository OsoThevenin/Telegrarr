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
  return renderApp({ route: "/ui/connect" });
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

    await user.type(within(sonarr).getByLabelText(/^URL/), "http://sonarr:8989");
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

    await user.type(within(sonarr).getByLabelText(/^URL/), "http://sonarr:8989");
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

    expect(await screen.findByText(/no podrà arribar/)).toBeVisible();
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
