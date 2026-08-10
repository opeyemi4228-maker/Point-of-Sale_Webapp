# Tests

SPEC §18. Nothing is wired up yet — this is the shape the suite takes.

| Directory | Layer | Tool | Blocking |
|---|---|---|---|
| `domain/` | Money, VAT, points, rounding | Vitest — 95% coverage on `src/lib/domain` | Yes |
| `isolation/` | Cross-branch RLS leak suite | pgTAP + Testcontainers — 100% of branch-scoped tables | Yes |
| `e2e/` | The twelve journeys, plus offline simulation | Playwright | Yes |

## The twelve journeys

Listed in full in SPEC §18. Journey 12 — a Branch A manager attempting, with a
valid token, to read and write Branch B's sales, stock and staff — is the one that
protects the business. It runs on every pull request.
