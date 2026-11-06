/** Hands over to the backend's login page, which sits outside this app. */
export function goToLogin(): void {
  window.location.assign("/login");
}
