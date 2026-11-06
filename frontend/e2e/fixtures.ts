import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";

import { E2E_PASSWORD, E2E_USER } from "./credentials";

type Fixtures = {
  resetBackend: void;
  /** A page whose browser context has signed in through the real login form. */
  signedInPage: Page;
};

export async function signIn(request: APIRequestContext): Promise<void> {
  const response = await request.post("/login", {
    form: { username: E2E_USER, password: E2E_PASSWORD },
    maxRedirects: 0,
  });
  expect(response.headers().location).toBe("/");
}

/** Sets environment variables on the backend, as a deployment would, until the next reset. */
export async function setBackendEnv(request: APIRequestContext, values: Record<string, string>): Promise<void> {
  const response = await request.post("/__e2e__/env", { data: values });
  expect(response.ok()).toBe(true);
}

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
    await signIn(page.request);
    await use(page);
  },
});

export { expect };
