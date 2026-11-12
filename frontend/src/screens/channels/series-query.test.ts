import { describe, expect, it } from "vitest";

import { exactHit, isBareDigits, seriesQuery, seriesSearchUrl } from "@/screens/channels/series-query";

const hit = (tmdb_id: number, exact?: boolean) => ({ tmdb_id, title: "Merlí", exact });

describe("seriesQuery", () => {
  it.each([
    ["Naruto Shippuden 1080p", "Naruto Shippuden"],
    ["Naruto Shippuden 720p HD", "Naruto Shippuden"],
    ["Joc de trons CAT", "Joc de trons"],
    ["Dragon Ball Super [VOSE] 1080p", "Dragon Ball Super"],
    ["Merlí | Català | 4K", "Merlí"],
    ["One.Piece.HEVC.x265 - CAST", "One Piece"],
    ["Pokémon (Dual) MULTI SUBS", "Pokémon"],
  ])("strips the release words from %s", (title, query) => {
    expect(seriesQuery(title)).toBe(query);
  });

  it.each(["Catalunya Experience", "Spider-Man", "Subway Stories"])(
    "keeps %s, whose words merely start like release words",
    (title) => {
      expect(seriesQuery(title)).toBe(title);
    },
  );

  it.each(["Cat", "HD", "[VOSE]"])("leaves %s as it is, as nothing else would remain", (title) => {
    expect(seriesQuery(title)).toBe(title);
  });
});

describe("seriesSearchUrl", () => {
  it.each([
    [false, "false"],
    [true, "true"],
  ])("reads digits as an id only when asked (%s)", (digitsAsId, flag) => {
    expect(seriesSearchUrl("Joc de trons", digitsAsId)).toBe(
      `/api/tmdb/search?q=Joc%20de%20trons&digits_as_id=${flag}`,
    );
  });
});

describe("exactHit", () => {
  it("picks a lone exact hit", () => {
    expect(exactHit([hit(1399, true)])?.tmdb_id).toBe(1399);
  });

  it.each([[[hit(1399)]], [[hit(1399), hit(1400)]], [[]]])("picks nothing from title hits", (hits) => {
    expect(exactHit(hits)).toBeNull();
  });
});

describe("isBareDigits", () => {
  it.each([
    ["1399", true],
    [" 1883 ", true],
    ["tt0944947", false],
    ["24 hores", false],
    ["", false],
  ])("reads %j as %s", (query, isBare) => {
    expect(isBareDigits(query)).toBe(isBare);
  });
});
