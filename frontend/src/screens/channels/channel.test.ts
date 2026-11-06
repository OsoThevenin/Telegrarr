import { describe, expect, it } from "vitest";

import { groupIntoShows, initialsOf, showTitle } from "@/screens/channels/channel";
import { channel } from "@/screens/channels/test-data";

describe("initialsOf", () => {
  it.each([
    ["Cinema Club", "CC"],
    ["dark", "D"],
    ["Sèries en català de sempre", "SE"],
    ["[HD] 4K Films", "H4"],
    ["🎬 Òpera prima", "ÒP"],
    ["🎬", "?"],
    ["", "?"],
  ])("takes %j to %j", (title, initials) => {
    expect(initialsOf(title)).toBe(initials);
  });
});

describe("groupIntoShows", () => {
  it("joins the sources mapped to one title, led by the first", () => {
    const shows = groupIntoShows([
      channel({ id: 1, imdb_id: "tt1", imdb_title: "Dark" }),
      channel({ id: 2, imdb_id: "tt2", imdb_title: "Lost" }),
      channel({ id: 3, imdb_id: "tt1", imdb_title: "Dark" }),
    ]);

    expect(shows.map(({ lead, sources }) => [lead.id, sources.map(({ id }) => id)])).toEqual([
      [1, [1, 3]],
      [2, [2]],
    ]);
    expect(showTitle(shows[0])).toBe("Dark");
  });

  it("keeps unmapped sources apart", () => {
    expect(groupIntoShows([channel({ id: 1 }), channel({ id: 2 })])).toHaveLength(2);
  });

  it("names an unmapped topic source Group › Topic", () => {
    const [show] = groupIntoShows([channel({ id: 1, title: "Fòrum", topic_title: "Drama" })]);

    expect(showTitle(show)).toBe("Fòrum › Drama");
  });
});
