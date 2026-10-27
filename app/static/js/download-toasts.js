// download-toasts.js — the toast a Stop or Retry answer calls for, as
// { key, params?, kind } (an i18n key and toast kind), or null for none.
// A null answer is a request that failed; api() has already said so.

const NOT_REQUEUED = { key: "dl.not_requeued", kind: "err" };

// POST /api/downloads/{id}/cancel → { ok }: false when nothing was running
export const cancelToast = (r) => (r && r.ok === false ? { key: "dl.nothing_to_cancel", kind: "err" } : null);

// POST /api/downloads/{id}/retry → { ok }: false when the row wasn't re-queued
export const retryToast = (r) => {
  if (!r) return null;
  return r.ok ? { key: "dl.requeued", kind: "ok" } : NOT_REQUEUED;
};

// POST /api/downloads/bulk (retry) → { ok, count }: count = rows re-queued
export const bulkRetryToast = (r) => {
  if (!r) return null;
  return r.count > 0 ? { key: "dl.requeued_n", params: { count: r.count }, kind: "ok" } : NOT_REQUEUED;
};
