# The shared database

Swiftgrocers runs **one** database. Two applications read and write it:

| Application | Directory | Role in the database |
|---|---|---|
| POS — till, branch manager, HQ | `SwiftGrocers_POS` (this repo) | owns the schema |
| Online store | `../swiftgrocers-main` | reads it, never migrates it |

**Neon** (Postgres 17) · **Prisma 7** · **Neon Auth (Stack Auth)** for identity ·
row-level security for branch isolation.

> The build spec named Supabase. It was never wired up — no migrations, no
> policies, no client. Neon replaced it before any of it was built, and the
> `supabase/` directory has been removed. Everything the spec required of it
> (§8: non-superuser app role, `FORCE ROW LEVEL SECURITY`) is carried over and
> is in `prisma/migrations/20260809000001_security/migration.sql`.

---

## 1. One owner, two clients

`prisma/schema.prisma` lives here and **only** here. The storefront symlinks it:

```
swiftgrocers-main/prisma/schema.prisma → ../../SwiftGrocers_POS/prisma/schema.prisma
```

so the two applications cannot drift into two shapes of the same table. Each
generates its own client into its own `src/generated/prisma`; the generated code
is disposable and git-ignored.

**The storefront never runs `prisma migrate`.** Migrations are forward-only and
run from this repo. If the store needs a column, it changes the schema here, in
a pull request that both teams can see.

---

## 2. Two connection strings, and the difference matters

```bash
# The application. The non-superuser `swiftgrocers_app` role.
# Row-level security applies. Pooled.
DATABASE_URL="postgresql://swiftgrocers_app:…@ep-….neon.tech/swiftgrocers?sslmode=require"

# Migrations and the seed only. The owner role. Bypasses every policy.
DIRECT_DATABASE_URL="postgresql://neondb_owner:…@ep-….neon.tech/swiftgrocers?sslmode=require"
```

Point `DATABASE_URL` at the owner and every policy in the schema stops applying —
silently, with no error, and the isolation tests still pass because the owner can
see everything. **This is the single most dangerous misconfiguration in the
system.** SPEC §8 makes it a build failure for a reason.

`FORCE ROW LEVEL SECURITY` is set on every table, so even the owner is subject to
policies on ordinary queries; a Postgres *superuser*, however, bypasses RLS
entirely. `swiftgrocers_app` is neither owner nor superuser.

---

## 3. Every query carries an identity

Prisma connects as one role over one connection string, so the database cannot
tell a cashier from a general admin by the login. It reads session variables
instead:

| Setting | Meaning |
|---|---|
| `app.actor_kind` | `staff` · `customer` · `service` · `none` |
| `app.staff_id` | the signed-in staff member |
| `app.staff_role` | `general_admin` · `branch_manager` · `sales_person` |
| `app.branch_id` | the branch they are standing in |
| `app.customer_id` | the signed-in shopper |

They are set with `SET LOCAL`, which lasts exactly as long as the surrounding
transaction. `src/lib/db/session.ts` is the only place that sets them, and
`dbFor()` is the only exported way to reach a table:

```ts
import { dbFor } from "@/lib/db";

const db = dbFor({ kind: "staff", staffId, role: "branch_manager", branchId });

const entries = await db((tx) =>
  tx.stockLedger.findMany({ orderBy: { at: "desc" } }),
);
// No branch filter in that query. There does not need to be one —
// the database will not return another branch's rows.
```

**A query that escapes `dbFor()` has no identity, so every policy evaluates
false and it returns nothing.** Isolation fails *closed*: a forgotten scope
shows an empty screen, never another branch's takings.

The transaction also begins with `SET LOCAL ROLE swiftgrocers_app`, which is the
safety net for §2. If `DATABASE_URL` is ever pointed at the owner — or at a
Postgres that quietly maps every login to a superuser, which is exactly what
`prisma dev` does locally — the queries still run as the restricted role and row
security still applies. Without it, one wrong connection string switches the
entire security model off with no error and no symptom.

`{ kind: "service" }` bypasses branch scoping. It is for the reservation
sweeper, the nightly close and the loyalty accrual — never for a request handler
that took an id from the client.

---

## 4. What the two applications share

```
                    ┌───────────── shared, one row each ─────────────┐
   till ────────────┤  product · category · barcode · customer       ├──────── storefront
   manager ─────────┤  branch · stock_ledger · loyalty_ledger        ├──────── (read-only
   HQ ──────────────┤  order · stock_reservation                     │          on catalog)
                    └────────────────────────────────────────────────┘
```

- **One product, one price.** HQ prices centrally. `online_listed` decides
  whether the storefront shows it; the till sells anything not delisted.
- **One customer.** Keyed by phone (E.164) — the loyalty card *is* the phone
  number. Someone who signs up online and walks into Gwarinpa next week already
  has their points. `stack_user_id` is null for a till enrolment with no login,
  which is normal, not a defect.
- **One stock ledger.** Both channels move stock on the same append-only table.
- **One loyalty ledger.** Earned online, spent at the till, or the reverse.

### The catalog the storefront actually reads

`app.product_public` — a `security_invoker` view that drops `cost_kobo` and
shows only listed, non-delisted rows. Row-level security cannot hide a *column*,
and the margin on a tin of milk must not be liftable from a network tab.

---

## 5. Online orders: how a branch gets chosen

The shopper's browser offers coordinates, or they pick a branch by hand
(`branch_chosen_by_customer`). At checkout:

```sql
SELECT * FROM app.route_order(
  6.4281, 3.4219,                                    -- the delivery address
  '[{"product_id":"…","qty_milli":3000}]'::jsonb     -- the basket
);
```

`route_order` returns the **nearest active branch that delivers, whose service
radius reaches the address, and which can cover every line from stock it
actually has available** — with the distance, which is stored on the order so a
manager can see the reasoning months later.

It returns **no rows** when no single branch can fill the basket. That is a real
answer and checkout must handle it — a later slot, a split, or an honest "not
today". Assigning it to the nearest branch anyway is how a customer gets a
confirmation email for groceries that do not exist.

Distances are haversine (`app.distance_m`), not PostGIS: a handful of branches,
a sphere is close enough over Lagos, and there is no extension to install.

### Reservations — why the till and the website never sell the same crate

```
available = SUM(stock_ledger.delta_milli) − SUM(held reservations)
```

When a shopper pays, the crate is **held**. Nothing physical has moved, so
nothing is written to the ledger — but the till's *available* figure drops and a
cashier cannot sell it out from under the order. When the picker lifts it off
the shelf, the reservation is **committed** and the ledger movement is written
then.

`app.branch_stock` exposes `on_hand_milli`, `held_milli` and `available_milli`
per branch and product. **Show a cashier `available`.** Holds expire, so
unpicked orders return stock to the shelf rather than stranding it.

---

## 6. What the database refuses to do

Enforced in SQL, not by convention — see the security migration.

| Rule | How it is enforced |
|---|---|
| Money is never a float (rule 2) | every amount is `BigInt` kobo; `Int` would cap a total at ₦21,474,836.47 |
| Stock is append-only (rule 3) | no quantity column exists; `UPDATE`/`DELETE` revoked **and** trigger-rejected on `stock_ledger` |
| Loyalty is append-only (rule 3) | same, on `loyalty_ledger` |
| Nothing is hard-deleted (rule 4) | soft-delete columns; `audit_log` and `order_event` are append-only |
| A sale is written once (rule 4) | trigger rejects any `UPDATE` touching a column other than `synced_at` |
| Offline retries land once (rule 8) | `sale.client_id` is unique — the till mints it, so a triple-retried sale inserts once |
| A non-admin has a branch | `CHECK (role = 'general_admin' OR branch_id IS NOT NULL)` |
| A delivering branch has coordinates | `CHECK`, so it can never be "nearest" to nobody |

Quantities are `Int` milli-units (thousandths) — 1.250 kg of rice — for the same
reason money is integer kobo: sum a few hundred float deltas and the on-hand
figure drifts from the count sheet by a gram, and then nobody trusts it.

### Converting at the boundary

Postgres speaks `BigInt` kobo and `Int` milli. The domain speaks `Money` and
`Quantity`. The conversion happens in `src/lib/db/index.ts` and nowhere else:

```ts
import { toMoney, toQuantity } from "@/lib/db";

toMoney(row.priceKobo);       // bigint  → Money
toQuantity(row.deltaMilli);   // number  → Quantity
```

`Number()` on a kobo bigint is safe — 2^53 kobo is about ₦90 trillion. The
bigint exists to lift Postgres's int4 ceiling, not JavaScript's.

---

## 7. Defaults Prisma keeps to itself

Prisma generates `@default(uuid())` and `@updatedAt` **in the client**, so the
DDL it emits leaves those columns with no database default. Any write that does
not go through Prisma Client then fails or silently drifts — the reservation
sweeper, a seed, a psql fix at 2am, raw SQL from either application.

A shared database cannot depend on one client library to stay consistent, so the
security migration adds `DEFAULT gen_random_uuid()` and both halves of
`updated_at` (a default *and* a trigger). Prisma carries on supplying its own
values; these simply never fire.

---

## 8. Running it

```bash
npm run db:migrate      # apply migrations (owner role)
npm run db:seed         # 4 branches, 12 categories, 26 products, opening stock
npm run db:generate     # regenerate the client after a schema change
npm run db:studio       # browse
```

Locally, with no Neon and no network:

```bash
npx prisma dev -d -n sg          # a real Postgres 17 in your terminal
DIRECT_DATABASE_URL="postgres://postgres:postgres@localhost:<port>/template1?sslmode=disable" \
  npm run db:migrate
```

The seed picks the node-postgres adapter automatically for non-Neon hosts — the
Neon driver speaks to Neon's WebSocket endpoint and cannot reach an ordinary
Postgres.

### After changing the schema

```bash
npx prisma migrate dev --name what_changed   # new migration + regenerate
npm run test:isolation                       # never skip this
```

`tests/isolation` is the blocking test (SPEC §18, journey 12): a session
authenticated as Branch A's manager must receive **exactly zero** rows belonging
to Branch B, and a rejection on insert, update and delete. A single leaked row
fails the build.

```bash
npx prisma dev start sg -d          # a real Postgres 17, no network needed
DIRECT_DATABASE_URL="postgres://postgres:postgres@localhost:<port>/template1?sslmode=disable" \
  node tests/isolation/branch-isolation.mjs --reset
```

One thing it asserts that is worth understanding, because it looks like a bug
the first time: an `UPDATE` or `DELETE` aimed at another branch's row does **not**
raise. Row security filters the row out before the statement reaches it, so the
command succeeds having touched nothing. The test therefore asserts on the
affected-row count, and then re-reads the row from outside the session to prove
it is unchanged. An `INSERT` with a foreign `branch_id` *does* raise, because
that is a `WITH CHECK` violation.

## 8a. Driving the dashboards before Stack Auth exists

`currentActor()` reads a development-only cookie so the screens can be run
against a real seeded database today. It is ignored in production.

```
swiftgrocers.dev-actor=staff:<staffId>:<role>:<branchId>
swiftgrocers.dev-actor=staff:<staffId>:general_admin        # HQ: no branch
```

`npm run db:seed` creates the staff to use it with: one `HQ-001` admin, and a
manager and a cashier for each branch (`GWA-M01`, `GWA-C01`, and so on).

---

## 9. Identity

**Neon Auth (Stack Auth)** for both applications. Stack syncs its users into
`neon_auth.users_sync`; `staff.stack_user_id` and `customer.stack_user_id` point
at it. They are plain columns, not foreign keys, because that schema is managed
outside these migrations.

The till PIN is **ours**, not Stack's. It is fast local re-authentication for a
cashier already standing at an authenticated till — never a primary credential —
and `staff.pin_hash` is a hash, with `pin_attempts` and `locked_until` beside it.

Signing in must resolve a Stack user to a `staff` or `customer` row and build the
`Actor` that `dbFor()` takes. **The `Actor` is the security boundary. Never build
one from anything the client sent.**
