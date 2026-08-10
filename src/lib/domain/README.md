# `lib/domain` — pure domain logic

SPEC §19. **No I/O in this directory.** No fetch, no Dexie, no React, no `Date.now()`
passed implicitly — clocks and dependencies come in as arguments so every function
here is deterministic and trivially testable.

This is the highest-value code in the system and carries the highest test coverage
target (95%, blocking — §18).

| File | Owns |
|---|---|
| `money.ts` | The `Money` type: integer kobo, explicit construction, formatting. **Money is never a `number`.** (§19) |
| `vat.ts` | VAT extraction on VAT-inclusive prices, exempt staples, half-up per-line rounding (§9.3) |
| `pricing.ts` | Price resolution order: promotion → branch override → master price (§9.3) |
| `loyalty.ts` | Earn on net-of-discount-and-VAT total, redemption caps, tiers, expiry (§11) |
| `receipt.ts` | Receipt numbering `{PREFIX}-{DEVICE}-{YYYYMMDD}-{SEQ}` (§12) |
| `stock.ts` | Ledger deltas, balance derivation, oversell rules (§7.4, §9.5) |
| `weight.ts` | EAN-13 embedded-weight barcode decoding, prefix `2x` (§9.4) |
| `shift.ts` | `expected_cash` computation and variance (§9.2) |

## The one rule

> Floating-point arithmetic on currency is a build error.

Rounding is **half-up to 2 decimal places, applied per line, then summed**. Never
round a total independently of its lines — it drifts, and customers notice.
