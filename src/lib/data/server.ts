import "server-only";

import type { Repositories } from "./repositories";
import type { Actor } from "@/lib/db/session";
import { mockRepositories } from "./index";

/**
 * The data layer, scoped to whoever is asking.
 *
 * Server-side only, and `import "server-only"` makes that a build error rather
 * than a code review comment: this reaches a Neon connection and reads columns
 * — cost prices, other people's figures — that must not travel to a browser.
 * Call it from a server component, a route handler or a server action, and pass
 * the *result* down as props.
 *
 * **The actor is the security boundary.** Build it from the verified session on
 * the server (`@/lib/auth/actor`); never from anything the client sent.
 *
 * `DATA_SOURCE=prisma` with a `DATABASE_URL` present switches every screen onto
 * Neon; anything else keeps the fixtures. Both satisfy the same contract, so no
 * screen changes when it flips.
 *
 * The check is deliberately conservative — `prisma` is chosen only when a
 * connection string actually exists, so a half-configured deployment falls back
 * to fixtures and looks obviously wrong, instead of throwing on the first query
 * a cashier makes.
 */
export function usingRealDatabase(): boolean {
  return process.env.DATA_SOURCE === "prisma" && Boolean(process.env.DATABASE_URL);
}

export async function getRepositories(actor: Actor): Promise<Repositories> {
  if (!usingRealDatabase()) return mockRepositories;

  // Imported lazily so the fixture path never pulls Prisma or the Neon driver
  // into a build that is not going to use them.
  const { prismaRepositories } = await import("./prisma");
  return prismaRepositories(actor);
}
