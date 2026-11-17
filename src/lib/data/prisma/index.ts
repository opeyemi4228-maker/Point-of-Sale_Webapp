import type { Actor } from "@/lib/db";
import { dbFor } from "@/lib/db";
import { toStaff } from "./mappers";
import {
  branchRepository,
  catalogRepository,
  purchasingRepository,
  salesRepository,
  stockRepository,
} from "./reads";
import { customerRepository, shiftRepository, staffRepository } from "./people";
import { dashboardRepository } from "./dashboards";
import type { AuthRepository, Repositories } from "../repositories";
import type { SignInResult } from "@/types/staff";

/**
 * The real data layer, assembled for one actor.
 *
 * Nothing in here filters by branch. `dbFor(actor)` sets the session variables
 * that row-level security reads, and the database returns only what that actor
 * may see — so a missing filter shows an empty screen rather than another
 * branch's takings (docs/DATABASE.md §3).
 */

/**
 * Sign-in.
 *
 * Password verification belongs to Neon Auth (Stack Auth), not to this
 * repository — Stack owns the credential, the rate limiting and the lockout.
 * What happens here is the half that is ours: given a verified Stack user,
 * resolve the `staff` row and build the session the workspaces render from.
 *
 * Until the Stack handshake is wired up, this refuses rather than guesses.
 * A sign-in that silently succeeds against an unverified credential is the one
 * failure mode that must never reach a shop, so the gap fails closed and says
 * so plainly.
 */
function authRepository(actor: Actor): AuthRepository {
  const db = dbFor(actor);

  return {
    async signIn(identifier: string): Promise<SignInResult> {
      if (!identifier.trim()) {
        return {
          ok: false,
          error: { code: "MISSING_FIELDS", message: "Enter your email address or staff code." },
        };
      }

      // The lookup half is real and already correct: it is how a verified Stack
      // user becomes a Session. Only the credential check is outstanding.
      const staff = await db(async (tx) =>
        tx.staff.findFirst({
          where: {
            deletedAt: null,
            OR: [{ email: identifier.toLowerCase() }, { staffCode: identifier.toUpperCase() }],
          },
          select: {
            id: true,
            orgId: true,
            branchId: true,
            role: true,
            fullName: true,
            email: true,
            staffCode: true,
            status: true,
            branch: { select: { name: true } },
          },
        }),
      );

      if (!staff) {
        return {
          ok: false,
          error: {
            code: "UNKNOWN_ACCOUNT",
            message: "We do not recognise that email address or staff code.",
          },
        };
      }

      if (staff.status === "suspended" || staff.status === "offboarded") {
        return {
          ok: false,
          error: {
            code: "ACCOUNT_SUSPENDED",
            message: "This account is not active. Speak to your manager.",
          },
        };
      }

      return {
        ok: false,
        error: {
          code: "WRONG_PASSWORD",
          message:
            "Password sign-in is not connected yet. Set NEXT_PUBLIC_STACK_PROJECT_ID and " +
            "STACK_SECRET_SERVER_KEY to finish wiring Neon Auth — see docs/DATABASE.md §9.",
        },
      };
    },
  };
}

/** Every repository, scoped to one actor. */
export function prismaRepositories(actor: Actor): Repositories {
  return {
    auth: authRepository(actor),
    branches: branchRepository(actor),
    catalog: catalogRepository(actor),
    stock: stockRepository(actor),
    purchasing: purchasingRepository(actor),
    sales: salesRepository(actor),
    shifts: shiftRepository(actor),
    staff: staffRepository(actor),
    customers: customerRepository(actor),
    dashboards: dashboardRepository(actor),
  };
}

export { toStaff };
