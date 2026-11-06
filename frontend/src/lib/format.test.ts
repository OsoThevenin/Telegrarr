import { describe, expect, it } from "vitest";

import { formatBytes } from "@/lib/format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [null, "0 B"],
    [undefined, "0 B"],
    [512, "512 B"],
    [1536, "1.5 KB"],
    [1610612736, "1.5 GB"],
  ])("writes %s bytes as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
