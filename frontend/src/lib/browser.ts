const OLD_HASH_PATH = /^#\/([\w-]+)$/;
const OLD_DASHBOARD = "dashboard";

/** The login page, which brings the visitor back to `path` afterwards. */
export function loginUrl(path: string): string {
  return path === "/" ? "/login" : `/login?${new URLSearchParams({ next: path })}`;
}

/** Hands over to the backend's login page, which sits outside this app. */
export function goToLogin(): void {
  window.location.assign(loginUrl(window.location.pathname + window.location.search));
}

/** Ends the session; the backend answers with its login page. */
export function goToLogout(): void {
  window.location.assign("/logout");
}

/** The path of a bookmark from the old UI, whose screens lived in the hash: `#/channels`. */
export function pathFromOldHash(hash: string): string | null {
  const screen = OLD_HASH_PATH.exec(hash)?.[1];
  if (!screen) return null;
  return screen === OLD_DASHBOARD ? "/" : `/${screen}`;
}

/** Runs before the router reads the URL, so an old bookmark opens its screen. */
export function followOldBookmark(): void {
  const path = pathFromOldHash(window.location.hash);
  if (path) window.history.replaceState(null, "", path);
}
