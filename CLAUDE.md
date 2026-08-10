@AGENTS.md

# Swiftgrocers POS

Multi-branch grocery point of sale. Client: Swiftgrocers. Built by BitLayerX Technologies.
The build specification (`docs/SPEC.md`) is the source of truth; code comments
reference its section numbers.

## Stack

Next.js 16 (App Router, `src/`) · React 19 · TypeScript · Tailwind v4 · lucide-react ·
react-icons · Zustand (UI state) · TanStack Query (server state) · Dexie (IndexedDB).

Backend is **Neon Postgres via Prisma 7**, with Neon Auth (Stack Auth) for identity.
The schema in `prisma/` is shared, verbatim, with the online store in
`../swiftgrocers-main` — one database, two applications. See `docs/DATABASE.md`.
Screens still run against the mock repository layer in `src/lib/data`; the swap is
a transport change, not a redesign.

## Layout

Three workspaces, one app, separated by route group:

- `src/app/(till)` — the cashier's till (§15.1). The most important screen.
- `src/app/(manager)` — branch manager (§15.2)
- `src/app/(hq)` — general admin (§15.3)
- `src/app/(auth)` — email sign-in and till PIN sign-in

`src/lib/domain` is pure — no I/O, no React, no ambient clock. Highest test coverage.

## Rules that are not negotiable

1. **The currency is the naira.** Nothing else, ever. See `src/config/currency.ts`.
2. **Money is never a `number`.** Integer kobo, explicit construction and formatting.
   Rounding is half-up per line, then summed — never round a total independently.
3. **Stock is an append-only ledger**, not an editable number. Balances are derived.
   The same rule applies to loyalty points.
4. **Nothing is hard-deleted.** Soft deletes plus an immutable audit log.
5. **Design tokens live in `src/app/globals.css`.** No hex values anywhere else.
6. **Nothing on the till screen is below 16px**, and touch targets are 56×56px.
   Manager and HQ may use 14px in dense tables and 44px targets.
7. **Status colour is never the only signal** — always an icon and a text label too.
8. **The till never blocks on the network.** Local write, print from local state,
   background sync. Offline is a normal operating mode, never an error state.
