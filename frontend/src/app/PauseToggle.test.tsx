import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { emitSnapshot } from "@/test/event-stream";
import { renderApp } from "@/test/render";
import { server, STATUS } from "@/test/server";

// In the sidebar: the Dashboard also offers to resume, from its status line.
const toggle = async (name: string) => within(await screen.findByRole("complementary")).findByRole("button", { name });

const PAUSE = "Posa en pausa les baixades";
const RESUME = "Reprèn les baixades";

function answerQueueRequests() {
  const calls: string[] = [];
  server.use(
    http.post("/api/queue/pause", () => {
      calls.push("pause");
      return HttpResponse.json({ ok: true, paused: true });
    }),
    http.post("/api/queue/resume", () => {
      calls.push("resume");
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
    const calls = answerQueueRequests();
    const { user } = await renderApp();

    await user.click(await toggle(PAUSE));

    expect(await toggle(RESUME)).toBeEnabled();
    expect(calls).toEqual(["pause"]);
  });

  it("resumes the queue", async () => {
    const calls = answerQueueRequests();
    server.use(http.get("/api/status", () => HttpResponse.json({ ...STATUS, paused: true })));
    const { user } = await renderApp();

    await user.click(await toggle(RESUME));

    expect(await toggle(PAUSE)).toBeEnabled();
    expect(calls).toEqual(["resume"]);
  });

  it("follows a pause made elsewhere, from the live stream", async () => {
    await renderApp();
    await toggle(PAUSE);

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

    await user.click(await toggle(PAUSE));

    expect(await screen.findByText("El pressupost diari ha de ser 0 (il·limitat) o més GB")).toBeVisible();
    await waitFor(async () => expect(await toggle(PAUSE)).toBeEnabled());
  });
});
