import { describe, expect, it } from "vitest";

import { byEpisodeNewestFirst, parseEpisode } from "@/screens/channels/episode";

describe("parseEpisode", () => {
  it.each([
    ["Dark.S01E05.1080p.mkv", { label: "S01E05", title: "Dark 1080p" }],
    ["dark s2e10.mkv", { label: "S02E10", title: "dark" }],
    ["525 - Espurnes Blaves D'odi (2A Part).mp4", { label: "525", title: "Espurnes Blaves D'odi (2A Part)" }],
    ["522_El_cas_del_pont.mp4", { label: "522", title: "El cas del pont" }],
    ["514-Title.mp4", { label: "514", title: "Title" }],
    ["El_detectiu_Conan_S2204_848_La_cita.mp4", { label: "848", title: "El detectiu Conan S2204 La cita" }],
  ])("reads the number and a clean title from %s", (name, expected) => {
    // Act
    const episode = parseEpisode(name);

    // Assert
    expect({ label: episode.label, title: episode.title }).toEqual(expected);
  });

  it("keeps a season and an episode, so a later season sorts above", () => {
    expect(parseEpisode("Show.S02E01.mkv")).toMatchObject({ season: 2, episode: 1 });
    expect(parseEpisode("848_Title.mp4")).toMatchObject({ season: null, episode: 848 });
  });

  it("does not take a year, a resolution or a codec for an episode number", () => {
    for (const name of ["Pa negre 2010.mkv", "La.Riera.1080p.x264.mkv", "Documental.mkv"]) {
      expect(parseEpisode(name).label).toBeNull();
    }
  });

  it("titles a file with no number by its name, without the extension", () => {
    expect(parseEpisode("La_Riera_final.mkv")).toMatchObject({ label: null, title: "La Riera final" });
  });

  it("falls back to the bare name when only the number is left", () => {
    expect(parseEpisode("S01E02.mkv")).toMatchObject({ label: "S01E02", title: "S01E02" });
  });
});

describe("byEpisodeNewestFirst", () => {
  const row = (name: string, finishedAt: number) => ({ ...parseEpisode(name), finishedAt });

  it("puts the highest episode first, then rows without a number by when they finished", () => {
    // Arrange
    const rows = [
      row("Sense numero A.mkv", 10),
      row("S01E09.mkv", 1),
      row("S02E01.mkv", 2),
      row("Sense numero B.mkv", 30),
      row("S01E10.mkv", 3),
    ];

    // Act
    const sorted = rows.toSorted(byEpisodeNewestFirst);

    // Assert
    expect(sorted.map(({ title }) => title)).toEqual([
      "S02E01",
      "S01E10",
      "S01E09",
      "Sense numero B",
      "Sense numero A",
    ]);
  });

  it("orders absolute numbers above one another", () => {
    const sorted = [row("514-A.mp4", 3), row("525 - B.mp4", 1), row("522_C.mp4", 2)].toSorted(byEpisodeNewestFirst);

    expect(sorted.map(({ label }) => label)).toEqual(["525", "522", "514"]);
  });
});
