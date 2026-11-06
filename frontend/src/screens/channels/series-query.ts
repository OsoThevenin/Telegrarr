/** One answer of GET /api/tmdb/search. */
export type SeriesHit = {
  tmdb_id: number;
  title: string;
  year?: string | number | null;
  original_title?: string | null;
  /** The series a typed link or id named, rather than a title match. */
  exact?: boolean;
};

export const MIN_QUERY_LENGTH = 2;

const JUNK_WORDS = [
  "2160p", "1440p", "1080p", "720p", "576p", "480p", "4k", "uhd", "fhd", "hd", "sd",
  "hevc", "x264", "x265", "h264", "h265", "10bit",
  "web-dl", "webdl", "webrip", "hdtv", "bluray", "bdrip", "dvdrip",
  "cat", "català", "catala", "cast", "castellano", "esp", "spa", "eng", "lat",
  "vo", "vos", "vose", "vosc", "vosi", "sub", "subs", "subtitulat", "subtitulada",
  "dual", "multi",
];
// Whole words only: "Catalunya" and "Subway" are titles, "CAT" and "SUB" are not.
const JUNK_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${JUNK_WORDS.join("|")})(?![\\p{L}\\p{N}])`, "giu");
const BRACKETED_PATTERN = /[[(][^\])]*[\])]/g;
const SEPARATORS_PATTERN = /[._|·•]+|\s[-–—]+(?=\s|$)/g;

/** A channel's name as a TMDB search; the bare name when cleaning leaves too little ("Cat"). */
export function seriesQuery(channelTitle: string): string {
  const raw = channelTitle.replace(/\s+/g, " ").trim();
  const cleaned = raw
    .replace(BRACKETED_PATTERN, " ")
    .replace(SEPARATORS_PATTERN, " ")
    .replace(JUNK_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length >= MIN_QUERY_LENGTH ? cleaned : raw;
}

/** Plain digits name a TMDB id only with `digitsAsId`: otherwise "1883" is a title. */
export const seriesSearchUrl = (query: string, digitsAsId: boolean): string =>
  `/api/tmdb/search?q=${encodeURIComponent(query)}&digits_as_id=${digitsAsId}`;

/** The one series a typed id or link named, picked at once; null for title hits. */
export const exactHit = (hits: SeriesHit[]): SeriesHit | null =>
  hits.length === 1 && hits[0].exact ? hits[0] : null;

/** Only decides whether to offer "Enter reads it as a TMDB id": the server parses the id. */
export const isBareDigits = (query: string): boolean => /^\d+$/.test(query.trim());
