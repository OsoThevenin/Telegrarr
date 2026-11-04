// series-query.js — the TMDB series search a new TV channel's dialog prefills (no
// DOM, no i18n): the channel's name without the quality, language and release
// words TMDB knows nothing about ("Naruto Shippuden 1080p" → "Naruto Shippuden").
// views.js uses it; tests run it in node.

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

/** A channel name cleaned into a TMDB series search. */
export function seriesQuery(channelTitle) {
  return (channelTitle || "")
    .replace(BRACKETED_RE, " ")
    .replace(SEPARATORS_RE, " ")
    .replace(JUNK_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
