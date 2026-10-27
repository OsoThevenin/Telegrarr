// retry.js — which downloads a Retry may re-queue. Only stopped rows (failed or
// cancelled) are retryable; the server enforces the same rule.

const RETRYABLE = new Set(["failed", "cancelled"]);

export const isRetryable = (d) => RETRYABLE.has(d.status);

// ids of the retryable rows in `rows`, in order
export const retryableIds = (rows) => rows.filter(isRetryable).map((d) => d.id);
