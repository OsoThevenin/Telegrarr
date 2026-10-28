// catalog-download.js — the Catalog's Download (Baixar) decisions, kept pure so
// they run in node: which button a film row offers for its Radarr status, the
// status a row shows once Radarr accepted, and what a failure toast says.
// Texts are i18n messages ({ key, params? }); catalog.js translates and renders.

const MISSING = "missing", REQUESTED = "requested", UPGRADE = "upgrade";
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
  if (s.status === MISSING) return getButton(title, false);
  if (s.status === UPGRADE) {
    return {
      kind: KIND_UPGRADE, disabled: false,
      label: { key: "cat.download_quality", params: { quality: s.best_quality } },
      aria: { key: "cat.upgrade_aria", params: { from: s.radarr_quality, to: s.best_quality } },
    };
  }
  return null;
}

/** The status a row shows once Radarr accepted its request; an upgrade keeps its Baixada quality. */
export const requestedStatus = (s) => (s.status === UPGRADE
  ? { status: REQUESTED, radarr_quality: s.radarr_quality }
  : { status: REQUESTED });

/**
 * The error toast for a refused request. `answer` is { ok, status, body }: status 0
 * when the request never reached the server, body the decoded JSON (or null).
 */
export function failureToast(title, answer) {
  const detail = answer && answer.body && answer.body.detail;
  let reason;
  if (detail && detail.key) reason = detail;
  else if (answer && answer.status) reason = { key: "common.http_error", params: { status: answer.status } };
  else reason = { key: "common.network_error" };
  return { title: { key: "cat.download_failed", params: { title } }, reason };
}
