import { describe, expect, it } from "vitest";

import { pathFromOldHash } from "@/lib/browser";

describe("pathFromOldHash", () => {
  it("reads a screen of the old app", () => {
    expect(pathFromOldHash("#/channels")).toBe("/channels");
  });

  it("reads the old Dashboard as the root", () => {
    expect(pathFromOldHash("#/dashboard")).toBe("/");
  });

  it.each(["", "#", "#section"])("leaves %j alone", (hash) => {
    expect(pathFromOldHash(hash)).toBeNull();
  });

  it("cannot be turned into another host", () => {
    expect(pathFromOldHash("#//evil.example")).toBeNull();
  });
});
