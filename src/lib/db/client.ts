import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

/**
 * The connection to Neon.
 *
 * `PrismaNeon` — the WebSocket pool — and deliberately not `PrismaNeonHttp`.
 * The HTTP driver sends each statement as its own one-shot request and cannot
 * hold an interactive transaction, and every query in this application runs
 * inside a transaction so that `SET LOCAL app.*` has something to be local to
 * (see ./session.ts). Swap in the HTTP driver for speed and row-level security
 * silently stops applying, which is the worst possible way to be fast.
 *
 * `DATABASE_URL` must resolve to the **non-superuser** `swiftgrocers_app` role.
 * A superuser bypasses every policy in the schema, so an application connecting
 * as one is protected by nothing at all (SPEC §8). Migrations are the only
 * thing that uses the owner role, over `DIRECT_DATABASE_URL`.
 */

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the swiftgrocers_app role on Neon — " +
        "see docs/DATABASE.md.",
    );
  }
  return url;
}

/**
 * Neon speaks WebSockets to its own endpoint and cannot reach an ordinary
 * Postgres, so a laptop running `npx prisma dev` needs node-postgres instead.
 * Picking by host is therefore a requirement rather than a convenience — and it
 * is what lets the whole application, dashboards included, be run and tested
 * locally with no Neon account and no network.
 *
 * Both adapters hold real interactive transactions, so the `SET LOCAL` that
 * row-level security depends on behaves identically either way.
 */
const isNeon = (url: string) => /\.neon\.tech|neon\.build/.test(new URL(url).hostname);

function create(): PrismaClient {
  const url = connectionString();
  const log = process.env.NODE_ENV === "development" ? (["warn", "error"] as const) : (["error"] as const);

  if (isNeon(url)) {
    return new PrismaClient({
      adapter: new PrismaNeon({ connectionString: url }),
      log: [...log],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    log: [...log],
  });
}

/**
 * One client per process. Next's dev server re-evaluates modules on every edit,
 * and a fresh pool each time exhausts Neon's connection limit within a morning
 * of ordinary work — so in development it is parked on `globalThis`.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
