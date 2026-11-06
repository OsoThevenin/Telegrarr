import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { EMPTY_SNAPSHOT } from "@/test/event-stream";

/** The answer of GET /api/status, which the shell asks for on every screen. */
export const STATUS = {
  authorized: true,
  paused: EMPTY_SNAPSHOT.paused,
  disk: EMPTY_SNAPSHOT.disk,
  stats: EMPTY_SNAPSHOT.stats,
  budget: EMPTY_SNAPSHOT.budget,
};

/**
 * The fake backend of every Vitest test. It answers only what the shell itself
 * needs. Any other request fails like a dropped connection and logs an error, so
 * each test states the API it depends on:
 *
 *   server.use(http.get("/api/channels", () => HttpResponse.json([...])));
 */
export const server = setupServer(http.get("/api/status", () => HttpResponse.json(STATUS)));
