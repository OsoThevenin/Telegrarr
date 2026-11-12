import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

const BACKEND = process.env.TELEGRARR_BACKEND ?? "http://127.0.0.1:8790";
const BACKEND_PATHS = ["/api", "/login", "/logout", "/static"];
const APP_ROOT = "/";
const PAGES_CACHE = "telegrarr-pages";
const HTTP_OK = 200;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // An external script: the backend's CSP is the same for every deployment.
      injectRegister: "script",
      includeManifestIcons: false,
      manifest: {
        name: "Telegrarr",
        short_name: "Telegrarr",
        description: "Bring Telegram into your *arr stack — auto-download channel media into a Plex-ready library.",
        // The old UI's manifest had this id too, so an installed app stays the same app.
        start_url: APP_ROOT,
        scope: APP_ROOT,
        id: APP_ROOT,
        display: "standalone",
        background_color: "#f5f5f7",
        theme_color: "#ffffff",
        icons: [
          { src: "/static/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/static/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/static/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Not the index: it sits behind the login check and carries the saved language.
        globPatterns: ["assets/**/*.{js,css,woff2}"],
        navigateFallback: null,
        // The plugin only implies these two with injectRegister "auto". Without them a new
        // worker, this one over the old UI's included, waits for every tab to close.
        skipWaiting: true,
        clientsClaim: true,
        importScripts: ["retire-old-shell.js"],
        runtimeCaching: [
          {
            // The network first, so an expired session still ends at the login page. Only the
            // app's own pages: the worker sees every navigation here, a backup download included.
            // Inlined because this function is copied into the worker, away from this file.
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" && !/^\/(api|sabnzbd|static|login|logout|healthz)(\/|$)/.test(url.pathname),
            handler: "NetworkFirst",
            options: { cacheName: PAGES_CACHE, cacheableResponse: { statuses: [HTTP_OK] } },
          },
        ],
      },
    }),
  ],
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
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/**/test-data.ts"],
      reporter: ["text-summary", "html"],
    },
  },
});
