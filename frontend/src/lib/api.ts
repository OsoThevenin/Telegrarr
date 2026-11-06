import { goToLogin } from "@/lib/browser";

/** What the backend puts in `detail`: a dictionary key with params, or plain text. */
export type ServerMessage = string | { key: string; params?: Record<string, unknown> };

function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value === "string") return true;
  return typeof value === "object" && value !== null && "key" in value && typeof value.key === "string";
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail: ServerMessage | undefined;

  constructor(status: number, detail: ServerMessage | undefined) {
    super(`API request failed with status ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function readDetail(response: Response): Promise<ServerMessage | undefined> {
  try {
    const body: unknown = await response.json();
    const detail = typeof body === "object" && body !== null && "detail" in body ? body.detail : undefined;
    return isServerMessage(detail) ? detail : undefined;
  } catch {
    // A proxy's HTML error page, say: the status is all there is to report.
    return undefined;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401) goToLogin();
  if (!response.ok) throw new ApiError(response.status, await readDetail(response));
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/** Every call to the backend goes through here, so an expired session always ends at login. */
export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
