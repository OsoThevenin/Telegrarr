import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { toast } from "sonner";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { DEFAULT_LANGUAGE, i18n } from "@/i18n";
import { FakeEventSource } from "@/test/event-stream";
import { server } from "@/test/server";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// Radix reads these browser APIs, which jsdom does not implement.
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("EventSource", FakeEventSource);
window.matchMedia = (query) =>
  ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));

afterEach(async () => {
  toast.dismiss();
  cleanup();
  FakeEventSource.instances = [];
  server.resetHandlers();
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
  document.documentElement.lang = DEFAULT_LANGUAGE;
});

afterAll(() => server.close());
