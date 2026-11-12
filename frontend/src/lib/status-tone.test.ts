import { describe, expect, it } from "vitest";

import { statusTone } from "@/lib/status-tone";

describe("statusTone", () => {
  it("paints an error in the destructive colour", () => {
    const tone = statusTone("error");

    expect(tone.badge).toContain("text-destructive");
    expect(tone.dot).toBe("bg-destructive");
    expect(tone.row).toContain("bg-destructive/");
  });

  it("paints a warning in amber", () => {
    const tone = statusTone("warning");

    expect(tone.badge).toContain("text-warning");
    expect(tone.dot).toBe("bg-warning");
    expect(tone.row).toContain("bg-warning/");
  });

  it("paints a success in green", () => {
    const tone = statusTone("success");

    expect(tone.badge).toContain("text-success");
    expect(tone.dot).toBe("bg-success");
    expect(tone.row).toContain("bg-success/");
  });

  it("keeps a neutral status quiet, with no row tint", () => {
    const tone = statusTone("neutral");

    expect(tone.badge).toContain("text-muted-foreground");
    expect(tone.row).toBe("");
  });
});
