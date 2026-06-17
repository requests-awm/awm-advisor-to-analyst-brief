/**
 * Frontend SSO + session-token client. Single sign-in point is the
 * operations app — users arrive with ?token=<sso-jwt>, which we exchange
 * for a session JWT stored in localStorage and attached to every API call.
 */

const SESSION_KEY = "awm-a2a-session-token-v1";
const SESSION_USER_KEY = "awm-a2a-session-user-v1";

type StoredUser = {
  sub: string;
  email: string;
  name?: string;
  avatar_url?: string | null;
  admin?: boolean;
};

type StoredSession = {
  token: string;
  exp: number;
  user: StoredUser;
};

const OPS_LOGIN_URL =
  (import.meta as any).env?.VITE_OPS_LOGIN_URL ||
  "https://ascotwm.com/admin/operations";

function getUrlToken(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("token");
}

function stripUrlToken(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  window.history.replaceState({}, document.title, url.toString());
}

function decodePayload(jwt: string): any | null {
  try {
    const [, b64] = jwt.split(".");
    if (!b64) return null;
    return JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function getStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem(SESSION_KEY);
  if (!token) return null;
  const userRaw = window.localStorage.getItem(SESSION_USER_KEY);
  let user: StoredUser | null = null;
  try { user = userRaw ? JSON.parse(userRaw) : null; } catch { user = null; }
  const payload = decodePayload(token);
  if (!payload?.exp) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return {
    token,
    exp: payload.exp,
    user: user || {
      sub: payload.sub || "",
      email: payload.email || "",
      name: payload.name,
      avatar_url: payload.avatar_url || null,
    },
  };
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(SESSION_USER_KEY);
}

export function getSessionToken(): string | null {
  return getStoredSession()?.token ?? null;
}

export function getCurrentUser(): StoredUser | null {
  return getStoredSession()?.user ?? null;
}

export function redirectToOpsLogin(reason?: string): void {
  if (typeof window === "undefined") return;
  clearSession();
  const url = new URL(OPS_LOGIN_URL);
  url.searchParams.set("return_url", window.location.origin + window.location.pathname);
  if (reason) url.searchParams.set("reason", reason);
  window.location.replace(url.toString());
}

async function exchangeSSO(ssoToken: string): Promise<StoredSession> {
  const res = await fetch("/api/auth/sso-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ssoToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.details || body?.error || `SSO exchange failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  const data = await res.json();
  if (!data.session_token) throw new Error("Exchange response missing session_token");
  const payload = decodePayload(data.session_token);
  return {
    token: data.session_token,
    exp: payload?.exp || Math.floor(Date.now() / 1000) + (data.expires_in || 28800),
    user: data.user || { sub: payload?.sub || "", email: payload?.email || "" },
  };
}

function persistSession(session: StoredSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, session.token);
  window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(session.user));
}

export async function bootstrapAuth(): Promise<
  | { status: "ready"; user: StoredUser }
  | { status: "redirecting" }
  | { status: "error"; message: string }
> {
  const inbound = getUrlToken();
  if (inbound) {
    try {
      const session = await exchangeSSO(inbound);
      persistSession(session);
      stripUrlToken();
      return { status: "ready", user: session.user };
    } catch (err: any) {
      stripUrlToken();
      return { status: "error", message: err?.message || "SSO sign-in failed" };
    }
  }

  const stored = getStoredSession();
  if (stored) return { status: "ready", user: stored.user };

  // Dev shortcut: localhost mints a fake session via the dev-only endpoint.
  if (
    (import.meta as any).env?.DEV &&
    typeof window !== "undefined" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(window.location.origin)
  ) {
    try {
      const res = await fetch("/api/auth/dev-login", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const payload = decodePayload(data.session_token);
        const session: StoredSession = {
          token: data.session_token,
          exp: payload?.exp || Math.floor(Date.now() / 1000) + (data.expires_in || 28800),
          user: data.user || { sub: payload?.sub || "", email: payload?.email || "" },
        };
        persistSession(session);
        return { status: "ready", user: session.user };
      }
    } catch { /* fall through */ }
  }

  redirectToOpsLogin("no_session");
  return { status: "redirecting" };
}
