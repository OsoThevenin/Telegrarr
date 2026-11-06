import { describe, expect, it } from "vitest";

import {
  chipStates,
  filmAction,
  formatBytes,
  pageCount,
  pageNumbers,
  pageUrl,
  requestedStatus,
  shownRange,
  withRequested,
  type CatalogCounts,
} from "@/screens/channels/catalog/catalog";

const COUNTS: CatalogCounts = { all: 5, missing: 1, downloaded: 2, upgrade: 1 };
const OFFLINE_COUNTS: CatalogCounts = { all: 5, missing: null, downloaded: null, upgrade: null };

describe("chipStates", () => {
  it("shows whole-channel counts and presses the chosen filter", () => {
    expect(chipStates(COUNTS, true, "downloaded")).toEqual([
      { id: "all", labelKey: "cat.filter_all", count: "5", isPressed: false, isDisabled: false },
      { id: "missing", labelKey: "cat.filter_missing", count: "1", isPressed: false, isDisabled: false },
      { id: "downloaded", labelKey: "cat.filter_downloaded", count: "2", isPressed: true, isDisabled: false },
      { id: "upgrade", labelKey: "cat.filter_upgrade", count: "1", isPressed: false, isDisabled: false },
    ]);
  });

  it("enables only All while Radarr is unavailable, with a dash on the rest", () => {
    const chips = chipStates(OFFLINE_COUNTS, false, "all");

    expect(chips.map(({ count, isDisabled }) => [count, isDisabled])).toEqual([
      ["5", false],
      ["–", true],
      ["–", true],
      ["–", true],
    ]);
  });

  it("waits on the status counts while Radarr is being checked, and still shows All", () => {
    const chips = chipStates(OFFLINE_COUNTS, null, "all");

    expect(chips.map(({ count, isDisabled }) => [count, isDisabled])).toEqual([
      ["5", false],
      ["…", true],
      ["…", true],
      ["…", true],
    ]);
  });
});

describe("filmAction", () => {
  it("offers Download on a film Radarr lacks", () => {
    expect(filmAction({ status: "missing" }, true)).toEqual({ kind: "get", isDisabled: false });
  });

  it("offers the channel's best resolution on a Quality upgrade", () => {
    const upgrade = { status: "upgrade", radarr_quality: "720p", best_quality: "1080p" } as const;

    expect(filmAction(upgrade, true)).toEqual({ kind: "upgrade", from: "720p", to: "1080p" });
  });

  it("keeps Download disabled while Radarr is unavailable", () => {
    expect(filmAction(undefined, false)).toEqual({ kind: "get", isDisabled: true });
  });

  it("offers nothing on a downloaded film, and Requested on a requested one", () => {
    expect(filmAction({ status: "downloaded", radarr_quality: "1080p" }, true)).toBeNull();
    expect(filmAction({ status: "requested" }, true)).toEqual({ kind: "requested" });
  });
});

describe("requestedStatus", () => {
  it("turns a missing film requested", () => {
    expect(requestedStatus({ status: "missing" })).toEqual({ status: "requested" });
  });

  it("keeps an upgrade's qualities, as /catalog/status then reads it", () => {
    const upgrade = { status: "upgrade", radarr_quality: "720p", best_quality: "1080p" } as const;

    expect(requestedStatus(upgrade)).toEqual({ status: "requested", radarr_quality: "720p", best_quality: "1080p" });
  });
});

describe("withRequested", () => {
  const answer = {
    channel_id: 7,
    radarr: { available: true, error: null },
    counts: COUNTS,
    rows: [
      { tmdb_id: 1, status: "missing" as const, poster: "https://poster" },
      { tmdb_id: 2, status: "downloaded" as const },
    ],
  };

  it("marks one film and leaves the answer it was given untouched", () => {
    const next = withRequested(answer, 1);

    expect(next.rows).toEqual([
      { tmdb_id: 1, status: "requested", poster: "https://poster" },
      { tmdb_id: 2, status: "downloaded" },
    ]);
    expect(answer.rows[0].status).toBe("missing");
  });

  it("adds a film the answer did not know yet", () => {
    expect(withRequested(answer, 3).rows).toContainEqual({ tmdb_id: 3, status: "requested" });
  });
});

describe("pageUrl", () => {
  it("asks for 25 films and carries only the parameters in use", () => {
    expect(pageUrl(7, { q: "", filter: "all", page: 1 })).toBe("/api/channels/7/catalog?limit=25");
  });

  it("turns the page into an offset, next to the search and the filter", () => {
    expect(pageUrl(7, { q: "pa negre", filter: "missing", page: 3 })).toBe(
      "/api/channels/7/catalog?limit=25&q=pa+negre&filter=missing&offset=50",
    );
  });
});

describe("pageCount", () => {
  it.each([
    [0, 1],
    [1, 1],
    [25, 1],
    [26, 2],
    [60, 3],
  ])("makes pages of 25 out of %i rows", (rows, pages) => {
    expect(pageCount(rows)).toBe(pages);
  });
});

describe("pageNumbers", () => {
  it("lists every page when there are few", () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
  });

  it("keeps the first, the last and the neighbours of the current page", () => {
    expect(pageNumbers(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
  });

  it("shows a lone page instead of hiding it behind a gap", () => {
    expect(pageNumbers(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
  });
});

describe("shownRange", () => {
  it("names the rows of the current page", () => {
    expect(shownRange(2, 25)).toBe("26–50");
    expect(shownRange(3, 10)).toBe("51–60");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1536, "1.5 KB"],
    [1610612736, "1.5 GB"],
  ])("writes %i bytes as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
