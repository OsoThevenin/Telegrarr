import { afterEach, describe, expect, it, vi } from "vitest";

import { applyStoredTheme } from "@/lib/theme";

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
