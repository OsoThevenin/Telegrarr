/** Hands over to the backend's login page, which sits outside this app. */
export function goToLogin(): void {
  window.location.assign("/login");
}

/** Ends the session; the backend answers with its login page. */
export function goToLogout(): void {
  window.location.assign("/logout");
}
