import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration — Prisma 7.
 *
 * Note which URL this uses. Migrations run as `DIRECT_DATABASE_URL`, the
 * *owner* role, because creating tables and policies requires privileges the
 * application must never hold. The running application connects as a separate,
 * non-superuser role over `DATABASE_URL` and is subject to row-level security
 * (SPEC §8). Point both at the same string and the isolation tests will pass
 * for the wrong reason — the owner bypasses every policy.
 *
 * See docs/DATABASE.md.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx --tsconfig tsconfig.scripts.json prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"],
  },
});
