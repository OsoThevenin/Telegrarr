import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { applyLanguage } from "@/i18n";
import { useI18n } from "@/i18n/use-i18n";
import { ApiError } from "@/lib/api";

describe("useI18n", () => {
  it("fills single-brace placeholders", () => {
    const { result } = renderHook(() => useI18n());

    expect(result.current.t("common.http_error", { status: 503 })).toBe("Error 503");
  });

  it("renders an unknown key as itself", () => {
    const { result } = renderHook(() => useI18n());

    expect(result.current.t("no.such.key")).toBe("no.such.key");
  });

  it("picks the plural form and localizes the count", async () => {
    await applyLanguage("en");
    const { result } = renderHook(() => useI18n());

    expect(result.current.tn("dl.episodes", 1)).toBe("1 episode");
    expect(result.current.tn("dl.episodes", 1234)).toBe("1,234 episodes");
  });

  it("translates a server message, including one nested in a param", () => {
    const { result } = renderHook(() => useI18n());

    expect(result.current.msg({ key: "err.settings.poll_floor", params: { floor: 5 } })).toBe(
      "L’interval de consulta ha de ser d’almenys 5 minuts",
    );
    expect(
      result.current.t("common.http_error", { status: { key: "nav.channels" } }),
    ).toBe("Error Canals");
  });

  it("passes plain server text through and shows nothing for no message", () => {
    const { result } = renderHook(() => useI18n());

    expect(result.current.msg("disk full")).toBe("disk full");
    expect(result.current.msg(undefined)).toBe("");
  });

  it("describes failed API calls", () => {
    const { result } = renderHook(() => useI18n());

    expect(result.current.errorText(new ApiError(400, "disk full"))).toBe("disk full");
    expect(result.current.errorText(new ApiError(502, undefined))).toBe("Error 502");
    expect(result.current.errorText(new TypeError("fetch failed"))).toBe("Error de xarxa");
  });
});
