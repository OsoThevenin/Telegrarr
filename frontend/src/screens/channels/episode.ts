/** What a downloaded file's name says about the episode it holds. */
export type ParsedEpisode = {
  /** Null for a show numbered straight through, as anime and long-running series are. */
  season: number | null;
  episode: number | null;
  /** "S01E05", or the bare number: "848". Null when the name carries no number. */
  label: string | null;
  /** The name without its extension, its number or its separators. */
  title: string;
};

const EXTENSION = /\.[a-z0-9]{2,4}$/i;
/** S01E05, s1e5, S01 E05; letters or digits right around it make it another word. */
const SEASON_EPISODE = /(?<![a-z0-9])s(\d{1,2}) ?e(\d{1,4})(?![a-z0-9])/i;
/** A number standing alone between separators: "525 - Title", "522_Title", "_848_". */
const BARE_NUMBER = /(?<![a-z0-9'])(\d{1,4})(?![a-z0-9])/gi;
/** Four digits in this range are a year, not an episode. */
const YEAR = /^(19|20)\d{2}$/;
const EDGE_SEPARATORS = /^[\s._\-–]+|[\s._\-–]+$/g;

const pad = (n: number) => String(n).padStart(2, "0");

function findNumber(name: string): { season: number | null; episode: number; start: number; end: number } | null {
  const seasonEpisode = SEASON_EPISODE.exec(name);
  if (seasonEpisode) {
    const [token, season, episode] = seasonEpisode;
    const start = seasonEpisode.index;
    return { season: Number(season), episode: Number(episode), start, end: start + token.length };
  }
  const bare = [...name.matchAll(BARE_NUMBER)].find(([digits]) => !YEAR.test(digits));
  if (!bare) return null;
  return { season: null, episode: Number(bare[1]), start: bare.index, end: bare.index + bare[0].length };
}

/** Dots part the words only of a name with no space or underscore: "Dark.S01E05", not "Dr. House". */
const separatorsOf = (base: string) => (/[\s_]/.test(base) ? /_/g : /[_.]/g);

function cleanTitle(text: string, separators: RegExp): string {
  return text.replace(separators, " ").replace(/\s+/g, " ").replace(EDGE_SEPARATORS, "");
}

/** Reads "S01E05" or an absolute number ("525 - Title.mp4") out of a file name. */
export function parseEpisode(fileName: string): ParsedEpisode {
  const base = fileName.replace(EXTENSION, "");
  const found = findNumber(base);
  const separators = separatorsOf(base);
  if (!found) return { season: null, episode: null, label: null, title: cleanTitle(base, separators) || base };

  const { season, episode, start, end } = found;
  const rest = `${base.slice(0, start)} ${base.slice(end)}`;
  const label = season === null ? String(episode) : `S${pad(season)}E${pad(episode)}`;
  return { season, episode, label, title: cleanTitle(rest, separators) || base };
}

type Sortable = Pick<ParsedEpisode, "season" | "episode"> & { finishedAt: number | null };

/** The latest episode first; rows with no number go last, the newest download first. */
export function byEpisodeNewestFirst(a: Sortable, b: Sortable): number {
  if (a.episode !== null && b.episode !== null) {
    const bySeason = (b.season ?? 0) - (a.season ?? 0);
    const byEpisode = bySeason || b.episode - a.episode;
    if (byEpisode) return byEpisode;
  } else if (a.episode !== null || b.episode !== null) {
    return a.episode === null ? 1 : -1;
  }
  return (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
}
