"use server";

import { prisma } from "@/lib/db/client";
import { withActor } from "@/lib/db/session";
import { endSession, startSession } from "@/lib/auth/session-cookie";
import { currentActor } from "@/lib/auth/actor";
import { getRepositories, usingRealDatabase } from "@/lib/data/server";
import {
  LOCKOUT_MINUTES,
  MAX_ATTEMPTS,
  lockoutUntil,
  verifySecret,
} from "@/lib/auth/credentials";
import type { SignInResult } from "@/types/staff";

/**
 * Signing in — SPEC §17.
 *
 * A server action, because the credential must be checked on the server and
 * the session cookie can only be written there. The old client-side sign-in
 * could not do either: it compared a fixture password in the browser and put
 * the result in `localStorage`, which meant the server never knew who was
 * signed in and every write refused.
 *
 * Two ways in, because a shop has two situations:
 *
 *   **Email and password** — a manager or an admin at a keyboard.
 *   **Staff code and PIN** — a cashier at a till with a queue behind them.
 *
 * The same function handles both: what was typed decides which credential is
 * checked, and the account's role decides which workspace opens.
 */

/** Everything runs as `service`: there is no actor yet — that is the point. */
const asService = <T>(work: Parameters<typeof withActor<T>>[2]) =>
  withActor(prisma, { kind: "service", reason: "sign-in" }, work);

/**
 * One message for an unknown account and for a wrong secret.
 *
 * Telling an attacker which staff codes exist is a free gift, and it is exactly
 * how somebody enumerates a chain's roster from the car park (SPEC §17).
 */
const REFUSED = {
  ok: false as const,
  error: {
    code: "WRONG_PASSWORD" as const,
    message: "That sign-in was not recognised. Check and try again.",
  },
};

export async function signInAction(
  identifier: string,
  secret: string,
): Promise<SignInResult> {
  const keyed = identifier.trim();

  if (!keyed || !secret) {
    return {
      ok: false,
      error: {
        code: "MISSING_FIELDS",
        message: "Enter your email or staff code, and your password or PIN.",
      },
    };
  }

  // No database configured? Sign in against the fixtures.
  //
  // The session cookie is the same either way — it is the *credential source*
  // that differs, not the mechanism. Without this branch the app cannot be
  // opened at all until Neon is wired up, because this action would reach for
  // a connection that does not exist and fail with a driver error nobody can
  // act on.
  if (!usingRealDatabase()) return signInWithFixtures(keyed, secret);

  // A staff code is what a cashier types, and it is not an email address.
  const byEmail = keyed.includes("@");

  const staff = await asService((tx) =>
    tx.staff.findFirst({
      where: byEmail
        ? { email: keyed.toLowerCase(), deletedAt: null }
        : { staffCode: keyed.toUpperCase(), deletedAt: null },
      select: {
        id: true,
        orgId: true,
        branchId: true,
        role: true,
        fullName: true,
        email: true,
        staffCode: true,
        status: true,
        passwordHash: true,
        pinHash: true,
        pinAttempts: true,
        lockedUntil: true,
        mustChangePassword: true,
        branch: { select: { name: true } },
      },
    }),
  );

  if (!staff) return REFUSED;

  if (staff.status === "suspended" || staff.status === "offboarded") {
    return {
      ok: false,
      error: {
        code: "ACCOUNT_SUSPENDED",
        message: "This account is not active. Speak to your manager.",
      },
    };
  }

  if (staff.lockedUntil && staff.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(
      1,
      Math.ceil((staff.lockedUntil.getTime() - Date.now()) / 60_000),
    );
    return {
      ok: false,
      error: {
        code: "ACCOUNT_LOCKED",
        message: `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}, or ask your manager to reset it.`,
      },
    };
  }

  // Email means password; a staff code means the till PIN.
  const expected = byEmail ? staff.passwordHash : staff.pinHash;
  const correct = await verifySecret(secret, expected);

  if (!correct) {
    // Count the attempt and shut the account at the threshold. Without this a
    // four-digit PIN is ten thousand guesses, which is minutes of scripting.
    const attempts = staff.pinAttempts + 1;
    await asService((tx) =>
      tx.staff.update({
        where: { id: staff.id },
        data: {
          pinAttempts: attempts,
          ...(attempts >= MAX_ATTEMPTS ? { lockedUntil: lockoutUntil() } : {}),
        },
      }),
    );

    if (attempts >= MAX_ATTEMPTS) {
      return {
        ok: false,
        error: {
          code: "ACCOUNT_LOCKED",
          message: `Too many attempts. This account is locked for ${LOCKOUT_MINUTES} minutes.`,
        },
      };
    }
    return REFUSED;
  }

  // A clean sign-in clears the count. Otherwise yesterday's fumbles accumulate
  // until somebody is locked out by a mistake they made last week.
  await asService((tx) =>
    tx.staff.update({
      where: { id: staff.id },
      data: {
        pinAttempts: 0,
        lockedUntil: null,
        // An invited account becomes active the first time it is used.
        ...(staff.status === "invited" ? { status: "active" as const } : {}),
      },
    }),
  );

  await startSession({
    staffId: staff.id,
    role: staff.role,
    branchId: staff.branchId,
  });

  // A cashier's hours start now, not when somebody remembers to press a button
  // (SPEC §11.4). Idempotent, so a reload or a second sign-in finds the shift
  // already running rather than opening a second one.
  if (staff.role === "sales_person") {
    try {
      const repositories = await getRepositories({
        kind: "staff",
        staffId: staff.id,
        role: staff.role,
        branchId: staff.branchId,
      });
      await repositories.shifts.startForSignIn("Till");
    } catch {
      // The till opens regardless (rule 8); the shift reconciles on next load.
    }
  }

  return {
    ok: true,
    session: {
      staff: {
        id: staff.id,
        orgId: staff.orgId,
        branchId: staff.branchId,
        branchName: staff.branch?.name ?? null,
        role: staff.role,
        fullName: staff.fullName,
        email: staff.email,
        staffCode: staff.staffCode,
        status: staff.status === "invited" ? "active" : staff.status,
      },
      signedInAt: new Date().toISOString(),
    },
  };
}

/**
 * Fixture sign-in, for a checkout with no database.
 *
 * Credentials come from `@/config/demo-accounts`, the same file the seed uses,
 * so the accounts offered on screen are the accounts that work — in both modes.
 */
async function signInWithFixtures(
  identifier: string,
  secret: string,
): Promise<SignInResult> {
  const { DEMO_ACCOUNTS } = await import("@/config/demo-accounts");
  const { CURRENT_BRANCH_ID } = await import("@/lib/data/mock/branches");

  const account = DEMO_ACCOUNTS.find(
    (a) => a.identifier.toLowerCase() === identifier.toLowerCase(),
  );

  if (!account || account.secret !== secret) return REFUSED;

  // Stable ids so a fixture session survives a reload and reads the same rows.
  // The branch must be the fixtures' own id: an invented one matched no ledger
  // row, so a demo manager saw every line at zero.
  const staffId = `demo-${account.role}`;
  const branchId = account.role === "general_admin" ? null : CURRENT_BRANCH_ID;

  await startSession({ staffId, role: account.role, branchId });

  return {
    ok: true,
    session: {
      staff: {
        id: staffId,
        orgId: "demo-org",
        branchId,
        branchName: branchId ? "Gwarinpa" : null,
        role: account.role,
        fullName: account.fullName,
        email: account.identifier.includes("@") ? account.identifier : "",
        staffCode: account.identifier.includes("@") ? "DEMO" : account.identifier,
        status: "active",
      },
      signedInAt: new Date().toISOString(),
    },
  };
}

export async function signOutAction() {
  await endSession();
}

/**
 * Change your own password.
 *
 * Requires the current one even though the session already proves who you are:
 * an unattended till is the normal state of a shop floor, and without this
 * anybody passing one could lock the cashier out of their own account.
 */
export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const actor = await currentActor();
  if (actor.kind !== "staff") return { ok: false, message: "Sign in first." };

  if (!usingRealDatabase()) {
    return {
      ok: false,
      message: "Passwords cannot be changed against the demo fixtures.",
    };
  }

  const { checkPassword, hashSecret } = await import("@/lib/auth/credentials");

  const strong = checkPassword(newPassword);
  if (!strong.ok) return { ok: false, message: strong.message };

  const staff = await asService((tx) =>
    tx.staff.findUnique({
      where: { id: actor.staffId },
      select: { passwordHash: true },
    }),
  );

  if (!(await verifySecret(currentPassword, staff?.passwordHash ?? null))) {
    return { ok: false, message: "That is not your current password." };
  }

  const passwordHash = await hashSecret(newPassword);

  await asService((tx) =>
    tx.staff.update({
      where: { id: actor.staffId },
      data: { passwordHash, mustChangePassword: false },
    }),
  );

  return { ok: true };
}
