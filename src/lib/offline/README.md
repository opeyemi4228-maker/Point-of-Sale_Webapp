# `lib/offline` — the sync engine

SPEC §10. The design principle: **the till writes locally and never waits for the
network.** Correctness comes from making every write idempotent and every ledger
append-only, so replay is always safe.

| File | Owns |
|---|---|
| `db.ts` | Dexie schema and versioned migrations for the six local stores (§10) |
| `outbox.ts` | The pending-write queue. `idempotencyKey = ${deviceId}:${localSeq}` — the uniqueness contract |
| `push.ts` | Batched, idempotent push to `/sync/push` |
| `pull.ts` | Cursor-based delta pull of catalog, prices, customers and settings |
| `status.ts` | Sync state for the header chip |

## Local stores

`catalog` · `customers_cache` · `outbox` · `sales_local` · `shift_local` · `manager_pins`

## The wording rule

The offline state is **never** presented as an error. It is a normal operating
mode. "Offline · 34 sales saved on this device" — not "Connection failed."
