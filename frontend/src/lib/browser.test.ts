import { describe, expect, it } from "vitest";

import { loginUrl, pathFromOldHash } from "@/lib/browser";

describe("loginUrl", () => {
  it("goes straight to the login page from the root", () => {
    expect(loginUrl("/")).toBe("/login");
  });

  it("remembers any other page, with its query", () => {
    expect(loginUrl("/downloads?tab=failed")).toBe("/login?next=%2Fdownloads%3Ftab%3Dfailed");
  });
});

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
