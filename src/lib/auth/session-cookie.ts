import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { StaffRole } from "@/types/enums";

/**
 * The signed session — SPEC §8, §17.
 *
 * This is the thing the whole authorisation model was missing. The session used
 * to live only in `localStorage`, which the server cannot see and the user can
 * edit; so a server action had no idea who was calling, and row-level security
 * had no claims to read. Every write refused, correctly, and the screens looked
 * broken.
 *
 * Now sign-in writes an **HTTP-only, signed** cookie. HTTP-only so no script on
 * the page can read it, signed so nobody can write one: the payload is plain
 * (it is a session, not a secret) but the HMAC means a forged claim of
 * `general_admin` will not verify, and an unverified cookie is treated as no
 * cookie at all.
 *
 * When Neon Auth (Stack Auth) is connected this module is what it replaces —
 * the shape of `Actor` and everything downstream stays exactly as it is.
 */

const COOKIE = "swiftgrocers.session";

/** Eight hours: longer than a shift, shorter than a night. */
const LIFETIME_SECONDS = 8 * 60 * 60;

export type SessionClaims = {
  staffId: string;
  role: StaffRole;
  branchId: string | null;
  /** Seconds since the epoch. Checked on every read. */
  expiresAt: number;
};

/**
 * The signing key.
 *
 * Missing in production is a hard failure, and deliberately so: falling back to
 * a default would mean every deployment signs with a key that is in the
 * repository, and anybody could mint themselves an admin session. In
 * development it falls back with a warning so the app runs from a clean clone.
 */
function signingKey(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is missing or too short (32+ characters required). " +
        "Generate one with `openssl rand -base64 32` — see .env.example.",
    );
  }
  return "development-only-session-key-not-for-production-use";
}

const sign = (payload: string): string =>
  createHmac("sha256", signingKey()).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` throws on a length mismatch, which is itself a leak of
  // one bit — but a length mismatch here means a malformed cookie, not a near
  // miss, so refusing early costs nothing.
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ── Writing ──────────────────────────────────────────────────────────────── */

export async function startSession(claims: Omit<SessionClaims, "expiresAt">) {
  const payload: SessionClaims = {
    ...claims,
    expiresAt: Math.floor(Date.now() / 1000) + LIFETIME_SECONDS,
  };

  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${body}.${sign(body)}`;

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LIFETIME_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

/**
 * The claims on this request, or null.
 *
 * Every failure — no cookie, bad signature, expired, unparseable — returns
 * null. There is no path here that returns partial trust, because a session
 * that is *almost* valid is one that must be treated as absent.
 */
export async function readSession(): Promise<SessionClaims | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // Signature first. Never parse a payload that has not been proven to be ours.
  if (!safeEqual(signature, sign(body))) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionClaims;
    if (!claims.staffId || !claims.role) return null;
    if (claims.expiresAt * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
