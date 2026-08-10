import "server-only";

import { prisma } from "./client";
import { withActor, type Actor, type TxClient } from "./session";

/**
 * The database, as the rest of the application is allowed to see it.
 *
 * There is no exported `PrismaClient`. The only way to reach a table is
 * `dbFor(actor)`, which opens a transaction carrying that actor's identity so
 * row-level security can do its job. `import "server-only"` above makes it a
 * build error to pull any of this into a client component — the connection
 * string and the whole catalog's cost prices live on this side of the wire.
 *
 * See docs/DATABASE.md, and src/lib/db/session.ts for why the transaction is
 * not optional.
 */
export function dbFor(actor: Actor) {
  return <T>(work: (tx: TxClient) => Promise<T>) => withActor(prisma, actor, work);
}

/* ── Money and quantity across the boundary ───────────────────────────────── */
//
// Postgres stores kobo as `int8` and milli-units as `int4`, which Prisma hands
// back as `bigint` and `number`. The domain types are `Money` and `Quantity`.
// Nothing in between is allowed to be a naira float, so the conversion happens
// exactly here and nowhere else.
//
// `Number()` on a kobo bigint is safe: 2^53 kobo is about ₦90 trillion, and the
// bigint exists to lift the *Postgres* int4 ceiling of ₦21.5m, not JavaScript's.

import { kobo, type Money } from "@/lib/domain/money";
import { milli, type Quantity } from "@/lib/domain/quantity";

export const toMoney = (value: bigint): Money => kobo(Number(value));
export const fromMoney = (value: Money): bigint => BigInt(value.kobo);

export const toQuantity = (value: number): Quantity => milli(value);
export const fromQuantity = (value: Quantity): number => value.milli;

export type { Actor, TxClient };
