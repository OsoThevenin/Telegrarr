// settings-toasts.js — the toast a Settings save calls for, as { key, params?, kind }
// (an i18n key and toast kind), or null for none. A null answer is a request that
// failed; api() has already said so.

// PATCH /api/settings → the new settings; `key` is the card's "saved" message
export const savedToast = (r, key) => (r ? { key, kind: "ok" } : null);

// POST /api/telegram/proxy with no proxy → { ok } or { error: { key, params } }
export const proxyClearToast = (r) => {
  if (!r) return null;
  return r.error ? { ...r.error, kind: "err" } : { key: "set.proxy_cleared", kind: "ok" };
};
