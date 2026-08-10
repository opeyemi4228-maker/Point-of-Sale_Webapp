import { PrismaClient } from "@/generated/prisma/client";
import type { StaffRole } from "@/types/enums";

/**
 * Who is asking — and the only way to ask.
 *
 * Prisma connects as one database role over one connection string, so the
 * database cannot tell a cashier from a general admin by the login. It reads
 * `app.*` session variables instead, and the policies in
 * `prisma/migrations/*_security` are written against them.
 *
 * Those variables are set with `SET LOCAL`, which lasts exactly as long as the
 * surrounding transaction. That is the whole design: a query that escapes this
 * module runs with no identity, every policy evaluates false, and it returns
 * nothing. Isolation therefore fails *closed* — a forgotten scope shows a
 * manager an empty screen rather than another branch's takings.
 *
 * SPEC §8. Rules 3 and 4 depend on this file being the only door.
 */

export type Actor =
  /** A signed-in staff member. `branchId` is null only for a general_admin. */
  | { kind: "staff"; staffId: string; role: StaffRole; branchId: string | null }
  /** A signed-in shopper on the storefront. */
  | { kind: "customer"; customerId: string }
  /**
   * Trusted server-side work with no human behind it — the reservation
   * sweeper, the nightly close, the loyalty accrual. Bypasses branch scoping,
   * so it is deliberately awkward to name and must never be reachable from a
   * request handler that took a user id from the client.
   */
  | { kind: "service"; reason: string }
  /**
   * Nobody. Sees nothing, by construction. Use it for the signed-out
   * storefront rather than reaching for `service`.
   */
  | { kind: "anonymous" };

/** The settings the policies read. Empty string means "unset" to Postgres. */
function claims(actor: Actor): Record<string, string> {
  switch (actor.kind) {
    case "staff":
      return {
        "app.actor_kind": "staff",
        "app.staff_id": actor.staffId,
        "app.staff_role": actor.role,
        "app.branch_id": actor.branchId ?? "",
      };
    case "customer":
      return {
        "app.actor_kind": "customer",
        "app.customer_id": actor.customerId,
      };
    case "service":
      return { "app.actor_kind": "service" };
    case "anonymous":
      return { "app.actor_kind": "none" };
  }
}

/**
 * Run `work` inside one transaction that carries `actor`'s identity.
 *
 * Everything the repository layer does goes through here. The client handed to
 * the callback is transaction-scoped: hold on to it past the callback and the
 * queries either fail or run unscoped, so don't.
 */
export function withActor<T>(
  prisma: PrismaClient,
  actor: Actor,
  work: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const settings = claims(actor);

  return prisma.$transaction(async (tx) => {
    // Drop to the restricted role for the life of this transaction, whatever
    // the connection authenticated as.
    //
    // Belt and braces against the one misconfiguration that turns the entire
    // security model off without a single error: a `DATABASE_URL` pointed at
    // the owner, or a managed Postgres that maps every login to a superuser.
    // A superuser bypasses row security completely, so without this line the
    // policies are advisory and nobody finds out until a manager sees another
    // branch's takings. `prisma dev`'s local Postgres does exactly this, which
    // is how it was caught.
    //
    // `SET LOCAL` unwinds with the transaction, so the pooled connection is
    // handed back unchanged.
    await tx.$executeRawUnsafe("SET LOCAL ROLE swiftgrocers_app");

    // `set_config(_, _, true)` is SET LOCAL in function form, which is what
    // lets the value be parameterised. Interpolating a staff id into SQL text
    // to set the variable that decides what that staff member may read would
    // be a memorable way to invent an injection hole.
    for (const [key, value] of Object.entries(settings)) {
      await tx.$executeRaw`SELECT set_config(${key}, ${value}, true)`;
    }
    return work(tx as TxClient);
  });
}

export type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
