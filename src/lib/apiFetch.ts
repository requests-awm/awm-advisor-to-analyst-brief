import { getSessionToken, redirectToOpsLogin } from "./authClient";

/**
 * fetch wrapper that attaches the session JWT and bounces to the ops app
 * login on 401. GETs retry on 5xx/network errors; mutations don't unless
 * { retry: true } is passed.
 */

type ApiFetchOptions = RequestInit & { retry?: boolean; retries?: number };

const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000];

export async function apiFetch(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const token = getSessionToken();
  const method = (options.method || "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD";
  const retryEnabled = options.retry ?? isIdempotent;
  const maxRetries = retryEnabled ? (options.retries ?? DEFAULT_RETRY_DELAYS_MS.length) : 0;

  const { retry: _retry, retries: _retries, ...fetchOptions } = options;
  void _retry; void _retries;

  const doFetch = () =>
    fetch(url, {
      ...fetchOptions,
      headers: {
        ...fetchOptions.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await doFetch();
      if (res.status === 401) {
        redirectToOpsLogin("session_expired");
        return res;
      }
      if (res.status >= 500 && res.status < 600 && attempt < maxRetries) {
        await sleep(DEFAULT_RETRY_DELAYS_MS[Math.min(attempt, DEFAULT_RETRY_DELAYS_MS.length - 1)]);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(DEFAULT_RETRY_DELAYS_MS[Math.min(attempt, DEFAULT_RETRY_DELAYS_MS.length - 1)]);
        continue;
      }
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  return doFetch();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
