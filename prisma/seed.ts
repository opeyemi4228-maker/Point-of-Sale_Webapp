/**
 * Seed — the chain as it stands, in one database, for both applications.
 *
 * Run with `npm run db:seed`. It connects as the *owner* role over
 * `DIRECT_DATABASE_URL`, which bypasses row-level security; that is correct for
 * a seed and wrong for anything else (SPEC §8).
 *
 * The catalog in `seed-data/catalog.json` was lifted from the storefront's own
 * `lib/products.js`, so the slugs match: a link to `/product/seedless-prunes`
 * printed before the migration still resolves after it. Prices were whole naira
 * there and are an integer count of kobo here, which is the one-way door — see
 * CLAUDE.md rule 2.
 *
 * Idempotent. Every write is an upsert on a natural key, so running it twice
 * changes nothing the second time.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { hashSecret } from "../src/lib/auth/credentials";
import { DEMO_PASSWORD, DEMO_PIN } from "../src/config/demo-accounts";

type SeedCatalog = {
  categories: { slug: string; name: string; position: number; imageUrl: string }[];
  products: {
    sku: string;
    slug: string;
    name: string;
    brand: string | null;
    description: string;
    categorySlug: string;
    priceKobo: number;
    compareAtPriceKobo: number | null;
    costKobo: number;
    unit: string;
    packSize: string | null;
    reorderLevelMilli: number;
    imageUrl: string | null;
    images: string[];
    onlineListed: boolean;
    tags: string[];
    ratingAvg: number;
    ratingCount: number;
    barcode: string;
    /** Whole units put on the shelf as the branch's opening ledger entry. */
    openingStock: number;
  }[];
};

/**
 * The four branches from SPEC §15.3, with the coordinates the order router
 * needs. These are approximate shop locations — good enough to demonstrate
 * routing, and HQ pins the real ones on the map before go-live.
 */
const BRANCHES = [
  { code: "GWA", name: "Gwarinpa",      city: "Abuja", state: "FCT",   address: "12 3rd Avenue, Gwarinpa",       phone: "+2348000000001", lat: 9.1100, lon: 7.4100, position: 1 },
  { code: "WUS", name: "Wuse II",       city: "Abuja", state: "FCT",   address: "44 Aminu Kano Crescent, Wuse II", phone: "+2348000000002", lat: 9.0765, lon: 7.4700, position: 2 },
  { code: "LEK", name: "Lekki Phase 1", city: "Lagos", state: "Lagos", address: "5 Admiralty Way, Lekki Phase 1",  phone: "+2348000000003", lat: 6.4400, lon: 3.4700, position: 3 },
  { code: "IKE", name: "Ikeja GRA",     city: "Lagos", state: "Lagos", address: "9 Oduduwa Way, Ikeja GRA",        phone: "+2348000000004", lat: 6.5800, lon: 3.3500, position: 4 },
];

/**
 * Neon over WebSockets in the normal case, plain node-postgres when the URL is
 * not Neon — which is how this runs against `npx prisma dev` on a laptop with
 * no network. The Neon driver speaks to Neon's WS endpoint and cannot reach an
 * ordinary Postgres, so picking by host is not a preference, it is a
 * requirement.
 */
async function client() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL is not set — see docs/DATABASE.md");

  if (/\.neon\.tech|neon\.build/.test(new URL(url).hostname)) {
    return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });
  }

  const { PrismaPg } = await import("@prisma/adapter-pg");
  console.log("(local Postgres — using the node-postgres adapter)");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

async function main() {
  const prisma = await client();
  const catalog: SeedCatalog = JSON.parse(
    readFileSync(join(import.meta.dirname, "seed-data", "catalog.json"), "utf8"),
  );

  const org = await prisma.org.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: { id: "00000000-0000-0000-0000-000000000001", name: "Swiftgrocers" },
  });

  const branches = [];
  for (const b of BRANCHES) {
    branches.push(
      await prisma.branch.upsert({
        where: { code: b.code },
        update: {},
        create: {
          orgId: org.id,
          code: b.code,
          name: b.name,
          city: b.city,
          state: b.state,
          address: b.address,
          phone: b.phone,
          status: "active",
          position: b.position,
          latitude: b.lat,
          longitude: b.lon,
          serviceRadiusM: 15_000,
          deliversOnline: true,
          offersCollection: true,
          deliveryFeeKobo: BigInt(150_000), // ₦1,500
          openingFloatKobo: BigInt(5_000_000), // ₦50,000
          lowStockThreshold: 10,
        },
      }),
    );
  }
  console.log(`branches: ${branches.length}`);

  // ── Staff ────────────────────────────────────────────────────────────────
  //
  // A seeded database with no staff cannot be signed into, and every dashboard
  // is scoped to a staff member's branch — so without these the screens have
  // nothing to render even though the catalog is full.
  //
  // Every account gets a real, hashed credential. A seeded database nobody can
  // sign into is a database nobody can look at.
  //
  // The demo secrets below are deliberately obvious and are printed at the end
  // of the seed. They are development fixtures: `npm run db:seed` is never run
  // against production, and the first thing a real deployment does is issue
  // proper credentials through the manager screens.
  const staff = [
    { code: "HQ-001", name: "Chain Admin", email: "admin@swiftgrocers.ng", role: "general_admin" as const, branch: null },
    ...branches.map((b, i) => ({
      code: `${b.code}-M01`,
      name: `${b.name} Manager`,
      email: `${b.code.toLowerCase()}.manager@swiftgrocers.ng`,
      role: "branch_manager" as const,
      branch: b.id,
      _i: i,
    })),
    ...branches.map((b) => ({
      code: `${b.code}-C01`,
      name: `${b.name} Cashier`,
      email: `${b.code.toLowerCase()}.cashier@swiftgrocers.ng`,
      role: "sales_person" as const,
      branch: b.id,
    })),
  ];

  // Imported, not restated: the sign-in screen offers these same credentials,
  // and two copies of a password drift into a screen that offers one the
  // database has never heard of.
  const [demoPasswordHash, demoPinHash] = await Promise.all([
    hashSecret(DEMO_PASSWORD),
    hashSecret(DEMO_PIN),
  ]);

  for (const person of staff) {
    await prisma.staff.upsert({
      where: { staffCode: person.code },
      update: {
        // Re-seeding restores the demo credentials, which is the whole reason
        // somebody re-runs this after experimenting with the staff screens.
        passwordHash: demoPasswordHash,
        pinHash: demoPinHash,
        pinAttempts: 0,
        lockedUntil: null,
      },
      create: {
        orgId: org.id,
        branchId: person.branch,
        fullName: person.name,
        email: person.email,
        staffCode: person.code,
        role: person.role,
        status: "active",
        passwordHash: demoPasswordHash,
        pinHash: demoPinHash,
        pinSetAt: new Date(),
      },
    });
  }
  console.log(`staff: ${staff.length}`);

  const categoryBySlug = new Map<string, string>();
  for (const c of catalog.categories) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, position: c.position, imageUrl: c.imageUrl },
      create: { slug: c.slug, name: c.name, position: c.position, imageUrl: c.imageUrl },
    });
    categoryBySlug.set(c.slug, row.id);
  }
  console.log(`categories: ${categoryBySlug.size}`);

  let productCount = 0;
  for (const p of catalog.products) {
    const categoryId = categoryBySlug.get(p.categorySlug);
    if (!categoryId) throw new Error(`No category for ${p.slug}: ${p.categorySlug}`);

    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: {
        sku: p.sku,
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        description: p.description,
        categoryId,
        priceKobo: BigInt(p.priceKobo),
        compareAtPriceKobo: p.compareAtPriceKobo ? BigInt(p.compareAtPriceKobo) : null,
        // The storefront never recorded cost. 72% of retail is a placeholder so
        // the margin columns render — HQ replaces it with real supplier cost.
        costKobo: BigInt(p.costKobo),
        soldBy: "unit",
        unit: p.unit,
        packSize: p.packSize,
        reorderLevelMilli: p.reorderLevelMilli,
        imageUrl: p.imageUrl,
        onlineListed: p.onlineListed,
        tags: p.tags,
        ratingAvg: p.ratingAvg,
        ratingCount: p.ratingCount,
        barcodes: { create: [{ barcode: p.barcode, isPrimary: true }] },
        images: {
          create: p.images.map((url, i) => ({ url, alt: p.name, position: i })),
        },
      },
    });
    productCount++;

    // Opening stock, as ledger movements — never as a quantity column, because
    // there is no quantity column to write (rule 3). Each branch opens with the
    // storefront's figure; the flagship gets a little more.
    for (const [i, branch] of branches.entries()) {
      const existing = await prisma.stockLedger.count({
        where: { branchId: branch.id, productId: product.id, reason: "BRANCH_OPENED" },
      });
      if (existing > 0) continue;

      const units = Math.max(1, Math.round(p.openingStock * (i === 0 ? 1 : 0.6)));
      await prisma.stockLedger.create({
        data: {
          branchId: branch.id,
          productId: product.id,
          deltaMilli: units * 1000,
          reason: "BRANCH_OPENED",
          staffName: "System",
          note: "Opening stock",
        },
      });
    }
  }
  console.log(`products: ${productCount} (× ${branches.length} branches of opening stock)`);

  await prisma.$disconnect();

  console.log(`
seed complete

  Sign in with any of these — development fixtures, printed on purpose:

    HQ            admin@swiftgrocers.ng          / ${DEMO_PASSWORD}
    Branch manager gwa.manager@swiftgrocers.ng   / ${DEMO_PASSWORD}
    Cashier (till) GWA-C01                       / ${DEMO_PIN}

  An email address signs in with a password; a staff code signs in with the
  four-digit till PIN.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
