import { afterEach, describe, expect, it, vi } from "vitest";

import { applyStoredTheme, currentTheme, cycleTheme, subscribeToTheme } from "@/lib/theme";

describe("applyStoredTheme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("applies the theme chosen in the old UI", () => {
    localStorage.setItem("theme", "dark");

    applyStoredTheme();

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("leaves auto to the system preference", () => {
    localStorage.setItem("theme", "auto");

    applyStoredTheme();

    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("follows the system preference when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    applyStoredTheme();

    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});

describe("cycleTheme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("goes from auto to light to dark and back, in the old UI's order", () => {
    const seen = [1, 2, 3].map(() => {
      cycleTheme();
      return currentTheme();
    });

    expect(seen).toEqual(["light", "dark", "auto"]);
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("stores the choice for the next visit", () => {
    cycleTheme();

    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("still changes the theme when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    cycleTheme();

    expect(currentTheme()).toBe("light");
  });

  it("tells subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToTheme(listener);

    cycleTheme();
    unsubscribe();
    cycleTheme();

    expect(listener).toHaveBeenCalledOnce();
  });
});
