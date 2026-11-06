import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const BACKEND = process.env.TELEGRARR_BACKEND ?? "http://127.0.0.1:8790";
const BACKEND_PATHS = ["/api", "/login", "/logout", "/static"];

export default defineConfig({
  base: "/ui/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    // The dictionaries live with the backend, in app/static/i18n.
    fs: { allow: [".."] },
    proxy: Object.fromEntries(BACKEND_PATHS.map((path) => [path, BACKEND])),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
