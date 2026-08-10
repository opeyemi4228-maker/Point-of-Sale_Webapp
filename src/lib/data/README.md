# `lib/data` — the repository layer

Every screen talks to the app through the interfaces declared here, never to a
database client directly. Today those interfaces are backed by in-memory mock
fixtures; when the Neon database is populated, the mock implementation is swapped
for a real one and **no screen changes**.

```
repositories.ts   interface definitions — the contract screens code against
mock/             fixtures + in-memory implementations (current default)
prisma/           real implementations against Neon (not built yet)
index.ts          resolves which implementation is active
```

Keep the interfaces shaped like the API surface in SPEC §16, so the eventual
swap is a transport change and not a redesign.

Two things the Prisma implementations must honour, because the interfaces alone
do not say so:

- **Never construct a `PrismaClient` here.** Use `dbFor(actor)` from
  `@/lib/db` — it is the only thing that sets the row-level security context,
  and a query issued outside it sees nothing at all. See `docs/DATABASE.md`.
- **Convert at this boundary.** The database speaks `BigInt` kobo and `Int`
  milli-units; the domain speaks `Money` and `Quantity`. Neither type crosses
  into the other's half of the app.
