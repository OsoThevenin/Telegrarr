// series-query.js — the TMDB series search of the channel dialog (no DOM, no
// i18n): the prefill, the channel's name without the quality, language and
// release words TMDB knows nothing about ("Naruto Shippuden 1080p" → "Naruto
// Shippuden"), and what a search answer means. series-mapper.js uses it; tests
// run it in node.

export const MIN_QUERY_LEN = 2;

const JUNK_WORDS = [
  "2160p", "1440p", "1080p", "720p", "576p", "480p", "4k", "uhd", "fhd", "hd", "sd",
  "hevc", "x264", "x265", "h264", "h265", "10bit",
  "web-dl", "webdl", "webrip", "hdtv", "bluray", "bdrip", "dvdrip",
  "cat", "català", "catala", "cast", "castellano", "esp", "spa", "eng", "lat",
  "vo", "vos", "vose", "vosc", "vosi", "sub", "subs", "subtitulat", "subtitulada",
  "dual", "multi",
];
// whole words only: "Catalunya" and "Subway" are titles, "CAT" and "SUB" are not
const JUNK_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${JUNK_WORDS.join("|")})(?![\\p{L}\\p{N}])`, "giu");
const BRACKETED_RE = /[[(][^\])]*[\])]/g;
const SEPARATORS_RE = /[._|·•]+|\s[-–—]+(?=\s|$)/g;

/** A channel name cleaned into a TMDB series search; the bare name when cleaning
 * leaves too little to search (a show called "Cat"). */
export function seriesQuery(channelTitle) {
  const raw = (channelTitle || "").replace(/\s+/g, " ").trim();
  const cleaned = raw
    .replace(BRACKETED_RE, " ")
    .replace(SEPARATORS_RE, " ")
    .replace(JUNK_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= MIN_QUERY_LEN ? cleaned : raw;
}

/** GET /api/tmdb/search for ``q``; plain digits name a TMDB id only with ``digitsAsId``. */
export const seriesSearchUrl = (q, digitsAsId) =>
  `/api/tmdb/search?q=${encodeURIComponent(q)}&digits_as_id=${Boolean(digitsAsId)}`;

/** The one series a typed id or link named, picked at once; null for title hits. */
export const exactHit = (results) => (results.length === 1 && results[0].exact ? results[0] : null);

// Only decides whether to offer "Enter reads it as a TMDB id"; the id itself is
// parsed server-side (tmdb.typed_id).
export const isBareDigits = (q) => /^\d+$/.test((q || "").trim());
