/**
 * SSO + session-token auth for the Express backend.
 *
 * Mirrors the fee-sheet app's auth so the same operations app sign-in works:
 *   1. User signs in to the operations app (ascotwm.com).
 *   2. Ops app issues a short-lived SSO JWT (HS256, shared secret), with
 *      iss = ascotwm.com and an audience registered for this app.
 *   3. User arrives here with ?token=<sso-jwt>.
 *   4. Frontend POSTs it to /api/auth/sso-exchange.
 *   5. We verify it and mint our own longer-lived session JWT, which the
 *      frontend stores and sends as Authorization: Bearer <…>.
 *   6. requireSession verifies the session JWT on each protected route.
 */

import type { Request, Response, NextFunction } from "express";
import { jwtVerify, SignJWT } from "jose";

const SSO_SHARED_SECRET =
  process.env.SSO_SHARED_SECRET ||
  "efktyi/6nHkYs7s2ND3Dk/tuDjr1opoL2DDvn7F1LMw=";
const SSO_ISSUER = process.env.SSO_ISSUER || "ascotwm.com";
const SSO_AUDIENCE = process.env.SSO_AUDIENCE || "clientsignup.ascotwm.com";
const SESSION_JWT_SECRET = process.env.SESSION_JWT_SECRET || SSO_SHARED_SECRET;
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 8);
const SESSION_ISSUER = "a2a.ascotwm.com";
const SESSION_AUDIENCE = "a2a.ascotwm.com";

const ssoSecretBytes = new TextEncoder().encode(SSO_SHARED_SECRET);
const sessionSecretBytes = new TextEncoder().encode(SESSION_JWT_SECRET);

export type SessionUser = {
  sub: string;
  email: string;
  name?: string;
  avatar_url?: string | null;
  iss: string;
  aud: string;
};

export type SessionTokenPayload = SessionUser & {
  iat: number;
  exp: number;
};

export async function verifySSOToken(token: string): Promise<{
  sub: string;
  email: string;
  name?: string;
}> {
  const { payload } = await jwtVerify(token, ssoSecretBytes, {
    issuer: SSO_ISSUER,
    audience: SSO_AUDIENCE,
  });
  const sub = String(payload.sub || "");
  const email = String((payload as any).email || "");
  if (!sub) throw new Error("SSO JWT missing sub claim");
  if (!email) throw new Error("SSO JWT missing email claim");
  return { sub, email: email.toLowerCase(), name: (payload as any).name };
}

export async function signSessionToken(user: {
  sub: string;
  email: string;
  name?: string;
  avatar_url?: string | null;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_HOURS * 60 * 60;
  return await new SignJWT({
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url || null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(sessionSecretBytes);
}

export async function verifySessionToken(token: string): Promise<SessionTokenPayload> {
  const { payload } = await jwtVerify(token, sessionSecretBytes, {
    issuer: SESSION_ISSUER,
    audience: SESSION_AUDIENCE,
  });
  return payload as SessionTokenPayload;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }
  try {
    const payload = await verifySessionToken(m[1]);
    req.user = {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      iss: payload.iss,
      aud: typeof payload.aud === "string" ? payload.aud : payload.aud?.[0] || "",
    };
    next();
  } catch (err: any) {
    res.status(401).json({ error: "Invalid or expired session", details: err?.message });
  }
}

export const SESSION_TTL_SECONDS = SESSION_TTL_HOURS * 60 * 60;
