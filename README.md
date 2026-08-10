# Swiftgrocers POS

A cloud point-of-sale platform for a multi-branch grocery chain, designed to keep
working when the internet does not.

> A cashier scans or types a product, takes payment, hands over a printed receipt,
> and the correct number leaves stock — every time, at every branch, online or offline.

Built by **BitLayerX Technologies** for **Swiftgrocers**.

## Running it

```bash
npm install
npm run dev
```

## Signing in

There is **one door**: `/login`. Every tier uses the same screen with their own
password, and the account's role decides which workspace opens.

| Role | Lands on | May also reach |
|---|---|---|
| Sales Person | `/till` | — |
| Branch Manager | `/manager` | `/till` |
| General Admin | `/hq` | `/manager`, `/till` |

## Signing in

```
HQ              admin@swiftgrocers.ng           swiftgrocers-2026
Branch manager  gwa.manager@swiftgrocers.ng     swiftgrocers-2026
Cashier         GWA-C01                         1234
```

An **email address** signs in with a password; a **staff code** signs in with the
four-digit till PIN. The sign-in screen lists these and fills them in on a tap.

They are development fixtures, defined once in `src/config/demo-accounts.ts` and
used by both the sign-in screen and the seed, so the accounts offered are always
the accounts that work. `npm run db:seed` prints them. They exist only when
`NODE_ENV` is not production.

Credentials are **scrypt** hashes on the `staff` row (`src/lib/auth/credentials.ts`).
Sign-in sets a signed, HTTP-only session cookie — that cookie is what the server
reads to build the `Actor` that row-level security runs on, so a screen with no
session sees nothing rather than everything.

## Status

Working: sign-in with role-based routing, the workspace sidebar, and the three
overview dashboards — cashier (`/till/history`), branch manager (`/manager`) and
HQ (`/hq`). They run on fixture data from `src/lib/data/mock`.

The remaining routes render placeholders. Next up is the till itself (§15.1).

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build

npx next start -p 3100                      # smoke checks want a production build
BASE=http://localhost:3100 node tests/e2e/smoke.mjs
```

The smoke suite covers what server-rendered HTML cannot show: that each role lands
in its own workspace and the access guard resolves, that a branch manager is
bounced out of HQ, that no screen scrolls sideways at 390/834/1440px, and that no
text on a till screen has drifted below 16px.

## Structure

```
src/
  app/            Route groups: (auth) (till) (manager) (hq)
  components/     ui/ shared/ and one folder per workspace
  lib/
    domain/       Pure logic: money, VAT, points, rounding. No I/O.
    data/         Repository interfaces + mock implementations
    offline/      Dexie stores, outbox, push/pull sync engine
    stores/       Zustand
    hooks/
  types/          Shared domain types
  config/         Currency, roles, constants
prisma/           Shared schema, migrations, RLS policies, seed
tests/            domain/ isolation/ e2e/
docs/             SPEC, runbook, hardware, training
```

## Conventions

Read `CLAUDE.md` before contributing. The short version: the currency is the naira,
money is integer kobo and never a `number`, stock and points are append-only
ledgers, nothing is hard-deleted, and the till never waits on the network.
