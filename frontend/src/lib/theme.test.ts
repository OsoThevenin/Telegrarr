import { afterEach, describe, expect, it, vi } from "vitest";

import { applyStoredTheme, chooseTheme, currentTheme } from "@/lib/theme";

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

describe("chooseTheme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("applies the choice and remembers it for the old UI", () => {
    chooseTheme("dark");

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(currentTheme()).toBe("dark");
  });

  it("hands auto back to the system preference", () => {
    chooseTheme("dark");

    chooseTheme("auto");

    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(currentTheme()).toBe("auto");
  });

  it("still applies the choice when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    chooseTheme("light");

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("treats an unknown stored value as auto", () => {
    localStorage.setItem("theme", "sepia");

    expect(currentTheme()).toBe("auto");
  });
});
