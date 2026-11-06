import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLiveUpdates } from "@/app/use-live-updates";
import { api } from "@/lib/api";
import { DOWNLOADS_KEY, type Download } from "@/lib/downloads";
import { statusQuery } from "@/lib/status";
import { EMPTY_SNAPSHOT, emitRaw, emitSnapshot, failStream, openStreamCount } from "@/test/event-stream";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";

const STREAM_GONE_QUIET_MS = 12000;
const RECONNECT_MS = 5000;

function row(overrides: Partial<Download> = {}): Download {
  return {
    id: 1,
    channel_id: 1,
    file_name: "film.mkv",
    file_size: 1000,
    status: "downloading",
    progress: 10,
    speed_mbs: 1,
    channel_title: "Cinema Club",
    topic_title: null,
    ...overrides,
  };
}

/** A screen as #63 and #64 build them: it reads the caches and never the stream. */
function LiveScreen() {
  useLiveUpdates();
  const { data: rows = [] } = useQuery({
    queryKey: [...DOWNLOADS_KEY, "all"],
    queryFn: () => api.get<Download[]>("/api/downloads"),
  });
  const { data: status } = useQuery(statusQuery);

  return (
    <>
      <p>completed: {status?.stats.completed}</p>
      <p>speed: {status?.speed}</p>
      <ul>
        {rows.map(({ id, file_name, progress }) => (
          <li key={id}>
            {file_name} at {progress}%
          </li>
        ))}
      </ul>
    </>
  );
}

function serveDownloads(...answers: Download[][]) {
  const requests = { count: 0 };
  server.use(
    http.get("/api/downloads", () => {
      const answer = answers[Math.min(requests.count, answers.length - 1)];
      requests.count += 1;
      return HttpResponse.json(answer);
    }),
  );
  return requests;
}

function renderLiveScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LiveScreen />
    </QueryClientProvider>,
  );
}

const counts = (changes: Partial<typeof EMPTY_SNAPSHOT.stats>) => ({ ...EMPTY_SNAPSHOT.stats, ...changes });

describe("live updates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a download's progress from the stream, with no request", async () => {
    const requests = serveDownloads([row()]);
    renderLiveScreen();
    await screen.findByText("film.mkv at 10%");

    emitSnapshot({ active: [row({ progress: 55 })] });

    expect(await screen.findByText("film.mkv at 55%")).toBeVisible();
    expect(requests.count).toBe(1);
  });

  it("keeps what only the list knows when it patches a row", async () => {
    serveDownloads([row({ id: 7, file_name: "kept.mkv" })]);
    renderLiveScreen();
    await screen.findByText("kept.mkv at 10%");

    emitSnapshot({ active: [{ id: 7, progress: 80 } as Download] });

    expect(await screen.findByText("kept.mkv at 80%")).toBeVisible();
  });

  it("shows the stream's counters and speed", async () => {
    serveDownloads([]);
    renderLiveScreen();
    await screen.findByText(/completed: 0/);

    emitSnapshot({ stats: counts({ completed: 4 }), speed: 2.5 });

    expect(await screen.findByText("completed: 4")).toBeVisible();
    expect(screen.getByText("speed: 2.5")).toBeVisible();
  });

  it("fetches the list again when the queue's counters move", async () => {
    serveDownloads([row()], [row(), row({ id: 2, file_name: "new-release.mkv", progress: 0 })]);
    renderLiveScreen();
    await screen.findByText("film.mkv at 10%");
    emitSnapshot({ stats: counts({ queued: 1 }) });

    emitSnapshot({ stats: counts({ queued: 2 }) });

    expect(await screen.findByText("new-release.mkv at 0%")).toBeVisible();
  });

  it("leaves the list alone while the counters stand still", async () => {
    const requests = serveDownloads([row()]);
    renderLiveScreen();
    await screen.findByText("film.mkv at 10%");

    emitSnapshot({ stats: counts({ downloading: 1 }) });
    emitSnapshot({ stats: counts({ downloading: 1, total_size: 5 }) });
    await screen.findByText("film.mkv at 10%");

    expect(requests.count).toBe(1);
  });

  it("survives a frame that is not a snapshot", async () => {
    serveDownloads([row()]);
    renderLiveScreen();
    await screen.findByText("film.mkv at 10%");

    emitRaw("{cut sho");
    emitRaw("null");
    emitSnapshot({ active: [row({ progress: 20 })] });

    expect(await screen.findByText("film.mkv at 20%")).toBeVisible();
  });

  it("falls back to fetching while the stream is silent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "setTimeout", "Date"] });
    serveDownloads([row()], [row({ progress: 33 })]);
    renderLiveScreen();
    await screen.findByText("film.mkv at 10%");

    await vi.advanceTimersByTimeAsync(STREAM_GONE_QUIET_MS);

    expect(await screen.findByText("film.mkv at 33%")).toBeVisible();
  });

  it("opens the stream again after the browser gives up on it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout", "Date"] });
    serveDownloads([]);
    renderLiveScreen();

    failStream();
    expect(openStreamCount()).toBe(0);
    vi.advanceTimersByTime(RECONNECT_MS);

    expect(openStreamCount()).toBe(1);
  });

  it("closes the stream when the app goes away", () => {
    serveDownloads([]);
    const { unmount } = renderLiveScreen();

    unmount();

    expect(openStreamCount()).toBe(0);
  });

  it("uses one connection for the whole app", async () => {
    await renderApp({ route: "/ui/downloads" });

    expect(openStreamCount()).toBe(1);
  });
});
