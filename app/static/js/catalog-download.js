// catalog-download.js — the Catalog's Download (Baixar) decisions, kept pure so
// they run in node: which button a film row offers for its Radarr status, the
// status a row shows once Radarr accepted, and what a failure toast says.
// Texts are i18n messages ({ key, params? }); catalog.js translates and renders.
// Also the one place the UI names the Radarr statuses GET …/catalog/status sends.

export const STATUS_MISSING = "missing", STATUS_REQUESTED = "requested";
export const STATUS_DOWNLOADED = "downloaded", STATUS_UPGRADE = "upgrade";
const KIND_GET = "get", KIND_UPGRADE = "upgrade";

const getButton = (title, disabled) => ({
  kind: KIND_GET, disabled,
  label: { key: "cat.download" }, aria: { key: "cat.download_aria", params: { title } },
});

/**
 * The row's Download button for status `s` (a /catalog/status row, or {} when
 * Radarr is unavailable), or null when the film needs none.
 * @returns {{kind: string, disabled: boolean, label: object, aria: object} | null}
 */
export function downloadButton(s, available, title) {
  if (!available) return getButton(title, true);
  if (s.status === STATUS_MISSING) return getButton(title, false);
  if (s.status === STATUS_UPGRADE) {
    return {
      kind: KIND_UPGRADE, disabled: false,
      label: { key: "cat.download_quality", params: { quality: s.best_quality } },
      aria: { key: "cat.upgrade_aria", params: { from: s.radarr_quality, to: s.best_quality } },
    };
  }
  return null;
}

/**
 * The status a row shows once Radarr accepted its request, as /catalog/status then
 * reads it: a requested upgrade keeps its Baixada quality and the channel's best.
 */
export const requestedStatus = (s) => (s.status === STATUS_UPGRADE
  ? { status: STATUS_REQUESTED, radarr_quality: s.radarr_quality, best_quality: s.best_quality }
  : { status: STATUS_REQUESTED });

/**
 * The error toast for a refused request. `answer` is { ok, status, body }: status 0
 * when the request never reached the server, body the decoded JSON (or null).
 */
export function failureToast(title, answer) {
  const detail = answer && answer.body && answer.body.detail;
  let reason;
  if (detail && detail.key) reason = detail;
  else if (answer && answer.status) {
    reason = { key: "common.http_error", params: { status: answer.status } };
  }
  else reason = { key: "common.network_error" };
  return { title: { key: "cat.download_failed", params: { title } }, reason };
}
