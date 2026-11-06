import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { emitSnapshot } from "@/test/event-stream";
import { renderApp } from "@/test/render";
import { server, STATUS } from "@/test/server";

// In the sidebar: the Dashboard also offers to resume, from its status line.
const toggle = async (name: string) => within(await screen.findByRole("complementary")).findByRole("button", { name });

// It reads "Pause" while disabled too, until the first status answer.
const enabledToggle = (name: string) =>
  waitFor(async () => {
    const button = await toggle(name);
    expect(button).toBeEnabled();
    return button;
  });

const PAUSE = "Posa en pausa les baixades";
const RESUME = "Reprèn les baixades";

/**
 * The queue as the backend holds it: what a POST changes, every later GET reports.
 * A pause mounts the Dashboard's status line, which asks for /api/status again.
 */
function serveQueue({ paused = false } = {}) {
  const calls: string[] = [];
  let isPaused = paused;
  server.use(
    http.get("/api/status", () => HttpResponse.json({ ...STATUS, paused: isPaused })),
    http.post("/api/queue/pause", () => {
      calls.push("pause");
      isPaused = true;
      return HttpResponse.json({ ok: true, paused: true });
    }),
    http.post("/api/queue/resume", () => {
      calls.push("resume");
      isPaused = false;
      return HttpResponse.json({ ok: true, paused: false });
    }),
  );
  return calls;
}

describe("global pause", () => {
  it("shows the state the backend reports", async () => {
    server.use(http.get("/api/status", () => HttpResponse.json({ ...STATUS, paused: true })));

    await renderApp();

    expect(await toggle(RESUME)).toBeEnabled();
  });

  it("pauses the queue", async () => {
    const calls = serveQueue();
    const { user } = await renderApp();

    await user.click(await enabledToggle(PAUSE));

    expect(await toggle(RESUME)).toBeEnabled();
    expect(calls).toEqual(["pause"]);
  });

  it("resumes the queue", async () => {
    const calls = serveQueue({ paused: true });
    const { user } = await renderApp();

    await user.click(await enabledToggle(RESUME));

    expect(await toggle(PAUSE)).toBeEnabled();
    expect(calls).toEqual(["resume"]);
  });

  it("follows a pause made elsewhere, from the live stream", async () => {
    await renderApp();
    await enabledToggle(PAUSE);

    emitSnapshot({ paused: true });

    expect(await toggle(RESUME)).toBeEnabled();
  });

  it("stays as it was and says why when the request fails", async () => {
    server.use(
      http.post("/api/queue/pause", () =>
        HttpResponse.json({ detail: { key: "err.settings.budget" } }, { status: 400 }),
      ),
    );
    const { user } = await renderApp();

    await user.click(await enabledToggle(PAUSE));

    expect(await screen.findByText("El pressupost diari ha de ser 0 (il·limitat) o més GB")).toBeVisible();
    await enabledToggle(PAUSE);
  });
});
