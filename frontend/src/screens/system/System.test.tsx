import { screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse, type JsonBodyType } from "msw";
import { describe, expect, it } from "vitest";

import { renderApp } from "@/test/render";
import { server } from "@/test/server";

const NOW = Math.floor(Date.now() / 1000);
const LOADING = "S’està carregant…";

const SYSTEM_STATUS = {
  version: "1.2.0",
  python: "3.12.3",
  platform: "Linux",
  uptime_seconds: 93784,
  channels: 3,
  channels_enabled: 2,
  workers: 4,
  max_concurrent: 2,
  db_size: 1536,
  disk: { free: 1073741824, total: 2147483648 },
  data_dir: "/data",
  health: [
    { id: "telegram", ok: true, level: "ok", message: { key: "health.telegram.ok", params: {} } },
    { id: "queue", ok: false, level: "warn", message: { key: "health.queue.paused", params: {} } },
    { id: "database", ok: false, level: "error", message: { key: "health.database.bad", params: {} } },
    { id: "newcomer", ok: true, level: "ok", message: "All fine" },
  ],
};

const TASK = {
  title: "Cinema Club",
  poll_minutes: 30,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  enabled: true,
  last_run: NOW - 120,
  next_run: NOW + 600,
  channel_id: 7,
};

const answerStatus = (body: JsonBodyType = SYSTEM_STATUS) =>
  server.use(http.get("/api/system/status", () => HttpResponse.json(body)));
const answerTasks = (rows: JsonBodyType) => server.use(http.get("/api/system/tasks", () => HttpResponse.json(rows)));
const answerBackups = (rows: JsonBodyType) => server.use(http.get("/api/system/backups", () => HttpResponse.json(rows)));
const answerUpdates = (body: JsonBodyType) => server.use(http.get("/api/system/updates", () => HttpResponse.json(body)));

async function openTab(name: string) {
  answerStatus();
  const rendered = await renderApp({ route: "/ui/system" });
  await rendered.user.click(await screen.findByRole("tab", { name }));
  return rendered;
}

describe("System: status", () => {
  it("shows a loading state until the status arrives", async () => {
    server.use(
      http.get("/api/system/status", async () => {
        await delay("infinite");
        return HttpResponse.json(SYSTEM_STATUS);
      }),
    );

    await renderApp({ route: "/ui/system" });

    expect(await screen.findByRole("status", { name: LOADING })).toBeVisible();
  });

  it("offers a retry when the status cannot be loaded", async () => {
    let failing = true;
    server.use(
      http.get("/api/system/status", () =>
        failing ? HttpResponse.json({ detail: "No disponible" }, { status: 500 }) : HttpResponse.json(SYSTEM_STATUS),
      ),
    );

    const { user } = await renderApp({ route: "/ui/system" });

    expect(await screen.findByRole("alert")).toHaveTextContent("No disponible");
    failing = false;
    await user.click(screen.getByRole("button", { name: "Torna-ho a provar" }));

    expect(await screen.findByText("v1.2.0")).toBeVisible();
  });

  it("says each health check's name, message and verdict", async () => {
    answerStatus();

    await renderApp({ route: "/ui/system" });

    const row = (await screen.findByText("Cua de baixades")).closest("li") as HTMLElement;
    expect(within(row).getByText("En pausa")).toBeVisible();
    expect(within(row).getByText("Avís")).toBeVisible();
    const database = screen.getByText("Base de dades", { selector: "li *" }).closest("li") as HTMLElement;
    expect(within(database).getByText("Error")).toBeVisible();
  });

  it("falls back to the check's id when the UI has no name for it", async () => {
    answerStatus();

    await renderApp({ route: "/ui/system" });

    const row = (await screen.findByText("newcomer")).closest("li") as HTMLElement;
    expect(within(row).getByText("All fine")).toBeVisible();
    expect(within(row).getByText("Correcte")).toBeVisible();
  });

  it("shows the facts about this install", async () => {
    answerStatus();

    await renderApp({ route: "/ui/system" });

    expect(await screen.findByText("v1.2.0")).toBeVisible();
    expect(screen.getByText("3.12.3")).toBeVisible();
    expect(screen.getByText("Linux")).toBeVisible();
    expect(screen.getByText("1.5 KB")).toBeVisible();
    expect(screen.getByText("/data")).toBeVisible();
    expect(screen.getByText(/1\.0 GB .* 2\.0 GB/)).toBeVisible();
  });
});

describe("System: tasks", () => {
  it("lists each scan with its schedule", async () => {
    answerTasks([TASK]);

    await openTab("Tasques");

    const row = (await screen.findByText(/Cinema Club/)).closest("tr") as HTMLElement;
    expect(within(row).getByText("cada dia")).toBeVisible();
    expect(within(row).getByText("fa 2 min")).toBeVisible();
  });

  it("says a disabled task has no next run", async () => {
    answerTasks([{ ...TASK, enabled: false, next_run: null }]);

    await openTab("Tasques");

    const row = (await screen.findByText(/Cinema Club/)).closest("tr") as HTMLElement;
    expect(within(row).getByText("desactivat")).toBeVisible();
  });

  it("says so when there is nothing scheduled", async () => {
    answerTasks([]);

    await openTab("Tasques");

    expect(await screen.findByText(/Encara no hi ha cap canal/)).toBeVisible();
  });

  it("offers a retry when the tasks cannot be loaded", async () => {
    server.use(http.get("/api/system/tasks", () => HttpResponse.json({ detail: "No disponible" }, { status: 500 })));

    await openTab("Tasques");

    expect(await screen.findByRole("alert")).toHaveTextContent("No disponible");
  });

  it("runs one Channel's scan", async () => {
    let scanned = "";
    answerTasks([TASK]);
    server.use(
      http.post("/api/channels/:id/scan", ({ params }) => {
        scanned = String(params.id);
        return HttpResponse.json({ ok: true });
      }),
    );

    const { user } = await openTab("Tasques");
    await user.click(await screen.findByRole("button", { name: "Executa" }));

    expect(await screen.findByText("Escaneig iniciat")).toBeVisible();
    expect(scanned).toBe("7");
  });

  it("scans everything and reports what the server said", async () => {
    answerTasks([TASK]);
    server.use(
      http.post("/api/system/tasks/scan_all", () =>
        HttpResponse.json({ ok: true, message: { key: "scan.all_started", params: { n: 3 } } }),
      ),
    );

    const { user } = await openTab("Tasques");
    await user.click(await screen.findByRole("button", { name: "Escaneja-ho tot ara" }));

    expect(await screen.findByText("S’estan escanejant 3 canals")).toBeVisible();
  });

  it("reports why a scan was refused", async () => {
    answerTasks([TASK]);
    server.use(
      http.post("/api/system/tasks/scan_all", () =>
        HttpResponse.json({ detail: { key: "err.scan.rate_limit_active", params: { minutes: 5 } } }, { status: 429 }),
      ),
    );

    const { user } = await openTab("Tasques");
    await user.click(await screen.findByRole("button", { name: "Escaneja-ho tot ara" }));

    expect(await screen.findByText(/Límit de Telegram actiu/)).toBeVisible();
  });
});

describe("System: backup", () => {
  const BACKUP = { name: "telearr 1.zip", size: 2048, created: NOW - 120 };

  it("lists backups with a download link", async () => {
    answerBackups([BACKUP]);

    await openTab("Còpia de seguretat");

    const row = (await screen.findByText("telearr 1.zip")).closest("tr") as HTMLElement;
    expect(within(row).getByText("2.0 KB")).toBeVisible();
    expect(within(row).getByRole("link", { name: "Baixa" })).toHaveAttribute(
      "href",
      "/api/system/backups/telearr%201.zip/download",
    );
  });

  it("says so when there are no backups, and how to restore one", async () => {
    answerBackups([]);

    await openTab("Còpia de seguretat");

    expect(await screen.findByText(/Encara no hi ha cap còpia/)).toBeVisible();
    expect(screen.getByText("Restauració")).toBeVisible();
  });

  it("offers a retry when backups cannot be loaded", async () => {
    server.use(http.get("/api/system/backups", () => HttpResponse.json({ detail: "No disponible" }, { status: 500 })));

    await openTab("Còpia de seguretat");

    expect(await screen.findByRole("alert")).toHaveTextContent("No disponible");
  });

  it("makes a backup and shows it", async () => {
    let backups: JsonBodyType[] = [];
    server.use(
      http.get("/api/system/backups", () => HttpResponse.json(backups)),
      http.post("/api/system/backups", () => {
        backups = [BACKUP];
        return HttpResponse.json(BACKUP);
      }),
    );

    const { user } = await openTab("Còpia de seguretat");
    await screen.findByText(/Encara no hi ha cap còpia/);
    await user.click(screen.getByRole("button", { name: "Fes una còpia ara" }));

    expect(await screen.findByText("S’ha creat la còpia de seguretat")).toBeVisible();
    expect(await screen.findByText("telearr 1.zip")).toBeVisible();
  });

  it("deletes a backup only after confirming", async () => {
    let backups: JsonBodyType[] = [BACKUP];
    let deleted = "";
    server.use(
      http.get("/api/system/backups", () => HttpResponse.json(backups)),
      http.delete("/api/system/backups/:name", ({ params }) => {
        deleted = String(params.name);
        backups = [];
        return HttpResponse.json({ ok: true });
      }),
    );

    const { user } = await openTab("Còpia de seguretat");
    await user.click(await screen.findByRole("button", { name: "Suprimeix la còpia" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(deleted).toBe("");
    await user.click(within(dialog).getByRole("button", { name: "Suprimeix" }));

    expect(await screen.findByText("S’ha suprimit la còpia de seguretat")).toBeVisible();
    await waitFor(() => expect(deleted).toBe("telearr 1.zip"));
    expect(await screen.findByText(/Encara no hi ha cap còpia/)).toBeVisible();
  });

  it("leaves a backup alone when the confirmation is cancelled", async () => {
    let deleted = false;
    answerBackups([BACKUP]);
    server.use(
      http.delete("/api/system/backups/:name", () => {
        deleted = true;
        return HttpResponse.json({ ok: true });
      }),
    );

    const { user } = await openTab("Còpia de seguretat");
    await user.click(await screen.findByRole("button", { name: "Suprimeix la còpia" }));
    await user.click(await screen.findByRole("button", { name: "Cancel·la" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deleted).toBe(false);
  });
});

describe("System: updates", () => {
  const URL_RELEASES = "https://github.com/OsoThevenin/Telegrarr/releases";
  const UPDATES = { current: "1.2.0", latest: "1.2.0", up_to_date: true, url: URL_RELEASES, error: null };

  it("says when this is the latest version", async () => {
    answerUpdates(UPDATES);

    await openTab("Actualitzacions");

    expect(await screen.findByText("Tens la versió més recent")).toBeVisible();
    expect(screen.getAllByText("v1.2.0")).toHaveLength(2);
  });

  it("announces a newer version and links its notes safely", async () => {
    answerUpdates({ ...UPDATES, latest: "1.3.0", up_to_date: false });

    await openTab("Actualitzacions");

    expect(await screen.findByText("Hi ha una actualització disponible: v1.3.0")).toBeVisible();
    const notes = screen.getByRole("link", { name: "Notes de la versió" });
    expect(notes).toHaveAttribute("href", URL_RELEASES);
    expect(notes).toHaveAttribute("target", "_blank");
    expect(notes).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("explains why the latest version is unknown", async () => {
    answerUpdates({
      ...UPDATES,
      latest: null,
      error: { key: "updates.github_http", params: { status: 503 } },
    });

    await openTab("Actualitzacions");

    expect(await screen.findByText(/503/)).toBeVisible();
    expect(screen.getByText("No s’ha trobat cap versió més nova")).toBeVisible();
  });

  it("offers a retry when the check itself fails", async () => {
    server.use(http.get("/api/system/updates", () => HttpResponse.json({ detail: "No disponible" }, { status: 500 })));

    await openTab("Actualitzacions");

    expect(await screen.findByRole("alert")).toHaveTextContent("No disponible");
  });
});
