import { test as base, expect, type Page } from "@playwright/test";

import { E2E_PASSWORD, E2E_USER } from "./credentials";

type Fixtures = {
  resetBackend: void;
  /** A page whose browser context has signed in through the real login form. */
  signedInPage: Page;
};

export const test = base.extend<Fixtures>({
  resetBackend: [
    async ({ request }, use) => {
      const response = await request.post("/__e2e__/reset");
      expect(response.ok()).toBe(true);
      await use();
    },
    { auto: true },
  ],

  signedInPage: async ({ page }, use) => {
    const response = await page.request.post("/login", {
      form: { username: E2E_USER, password: E2E_PASSWORD },
      maxRedirects: 0,
    });
    expect(response.headers().location).toBe("/");
    await use(page);
  },
});

export { expect };
