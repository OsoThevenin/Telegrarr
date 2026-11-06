import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { DEFAULT_LANGUAGE, i18n } from "@/i18n";
import { server } from "@/test/server";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// Radix reads these browser APIs, which jsdom does not implement.
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));

afterEach(async () => {
  cleanup();
  server.resetHandlers();
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
  document.documentElement.lang = DEFAULT_LANGUAGE;
});

afterAll(() => server.close());
