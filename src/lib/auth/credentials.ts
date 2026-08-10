import "server-only";

import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * `promisify(scrypt)` drops the options overload, so the cost parameters
 * cannot be passed through it. Wrapped by hand instead — the whole point of
 * using scrypt is choosing those parameters.
 */
const scryptAsync = (
  secret: string,
  salt: string,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(secret, salt, keyLength, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });

/**
 * Passwords and till PINs — SPEC §17.
 *
 * **scrypt**, from Node's standard library. It is a memory-hard KDF, which is
 * the property that matters: a GPU farm can try billions of SHA-256 guesses a
 * second and is throttled to something far smaller against scrypt, because
 * every guess has to buy 64 MB of memory as well as time. Argon2id is the
 * modern favourite and would be a straight swap, but it needs a native module,
 * and a dependency that fails to compile on a deployment host is a shop that
 * cannot sign in.
 *
 * Stored as `scrypt$N$r$p$salt$hash`, so the cost parameters travel with the
 * hash. Raising them later re-hashes old credentials on next sign-in instead of
 * invalidating everyone at once.
 */

/** Cost parameters. `N` is the work factor; raising it is a deliberate act. */
const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(secret.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    // Node refuses scrypt above a default memory ceiling that N=16384 exceeds.
    maxmem: 64 * 1024 * 1024,
  });

  return `scrypt$${N}$${R}$${P}$${salt}$${derived.toString("hex")}`;
}

/**
 * Verify a secret against a stored hash.
 *
 * Compared with `timingSafeEqual`. A plain `===` returns faster the earlier the
 * first mismatch is, and that difference is measurable across a network — it
 * turns guessing a credential from a brute-force problem into a
 * character-by-character one.
 *
 * Returns false for a malformed or absent hash rather than throwing: an account
 * with no password set must simply fail to sign in, not crash the sign-in page
 * for everybody.
 */
export async function verifySecret(
  secret: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, salt, expected] = parts;
  const expectedBuffer = Buffer.from(expected, "hex");

  try {
    const derived = await scryptAsync(secret.normalize("NFKC"), salt, expectedBuffer.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });

    return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
  } catch {
    return false;
  }
}

/* ── Issuing secrets ──────────────────────────────────────────────────────── */

/**
 * A four-digit till PIN.
 *
 * `randomInt` is the crypto-grade source and is uniform by construction —
 * taking a modulus of a raw random draw quietly favours the low numbers, which
 * for a four-digit space is a real reduction in what an attacker has to try.
 *
 * Four digits is ten thousand possibilities, which is only defensible because a
 * PIN opens the till workspace on a registered device and nothing else, and
 * because `pinAttempts` and `lockedUntil` stop the guessing at five.
 */
export const generatePin = (): string => String(randomInt(0, 10_000)).padStart(4, "0");

/**
 * A temporary password a manager reads out once.
 *
 * Deliberately not a random hex string. Somebody has to say this down a phone
 * or across a counter and the other person has to type it correctly the first
 * time, so it is built from unambiguous characters — no `O` and `0`, no `l`
 * and `1`, no `5` and `S`.
 */
const SPEAKABLE = "ABCDEFGHJKMNPQRTUVWXYZ" + "abcdefghjkmnpqrtuvwxyz" + "23467892346789";

export function generateTemporaryPassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SPEAKABLE[randomInt(0, SPEAKABLE.length)];
  }
  return out;
}

/* ── What counts as a password ────────────────────────────────────────────── */
//
// The rule lives in `./password-policy`, which has no `server-only` marker,
// because the form has to apply the same rule before submitting. Re-exported
// here so server code has one import for everything credential-related.

export { MINIMUM_PASSWORD_LENGTH, checkPassword } from "./password-policy";

/* ── Lockout ──────────────────────────────────────────────────────────────── */

/** Wrong attempts before an account stops answering. */
export const MAX_ATTEMPTS = 5;
/** How long it stays shut. Long enough to stop a script, short enough to trade. */
export const LOCKOUT_MINUTES = 15;

export const lockoutUntil = (): Date =>
  new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
