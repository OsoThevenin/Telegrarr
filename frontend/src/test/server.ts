import { setupServer } from "msw/node";

/**
 * The fake backend of every Vitest test. It starts with no handlers, and an
 * unhandled request fails like a dropped connection and logs an error, so each
 * test states the API it depends on:
 *
 *   server.use(http.get("/api/channels", () => HttpResponse.json([...])));
 */
export const server = setupServer();
