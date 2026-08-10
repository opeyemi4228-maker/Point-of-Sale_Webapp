import "server-only";

import { readSession } from "./session-cookie";
import type { Actor } from "@/lib/db/session";

/**
 * Who the server thinks is asking.
 *
 * This is the security boundary, and the **only** place an `Actor` may be
 * built. Everything downstream — every repository, every policy in the
 * database — trusts what this returns.
 *
 * It reads the signed, HTTP-only session cookie and nothing else. In
 * particular it does not read the Zustand session in
 * `src/lib/stores/session.ts`: that lives in `localStorage`, the user can edit
 * it, and it decides which *chrome* renders and nothing more (see
 * `RequireRole`). Authorisation is here and in the database's policies.
 *
 * Anything unverified resolves to `anonymous`, which sees zero rows from every
 * policy. That is the correct failure direction — an unauthenticated request
 * gets an empty screen, never somebody else's branch.
 *
 * Neon Auth (Stack Auth) slots in here when its keys exist: resolve the Stack
 * user, map `stack_user_id` to a `staff` row, and return the same shape. The
 * rest of the application does not change.
 */
export async function currentActor(): Promise<Actor> {
  const claims = await readSession();
  if (!claims) return { kind: "anonymous" };

  return {
    kind: "staff",
    staffId: claims.staffId,
    role: claims.role,
    branchId: claims.branchId,
  };
}

/**
 * The branch the current actor is standing in, or null for HQ.
 *
 * Convenience for screens that need to name the branch. It is not an
 * authorisation check — the database has already made that decision.
 */
export async function currentBranchId(): Promise<string | null> {
  const actor = await currentActor();
  return actor.kind === "staff" ? actor.branchId : null;
}
