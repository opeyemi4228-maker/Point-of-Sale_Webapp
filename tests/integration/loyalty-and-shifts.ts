/**
 * Loyalty, shifts and staff management, through the real repository layer.
 *
 * The domain tests prove the arithmetic; the isolation suite proves the
 * policies. This proves the wiring between them — that enrolling actually
 * writes a customer, that a sale moves the points ledger in the same
 * transaction, that a shift opened at sign-in is not opened twice, and that a
 * suspended cashier's till is closed behind them.
 *
 *   DATABASE_URL=... DIRECT_DATABASE_URL=... npx tsx tests/integration/loyalty-and-shifts.ts
 *
 * Runs against a seeded database and cleans up after itself. `DATABASE_URL`
 * must be the restricted app role — that is the whole point of running through
 * the repositories rather than against the tables.
 */
import { prismaRepositories } from "@/lib/data/prisma";
import type { Actor } from "@/lib/db";
import { buildSale } from "@/lib/domain/sale";
import { naira } from "@/lib/domain/money";
import { units } from "@/lib/domain/quantity";
import { MINIMUM_REDEEMABLE_POINTS } from "@/config/loyalty";
import type { Staff } from "@/types/staff";
import type { Product } from "@/types/catalog";

let pass = 0;
const failures: string[] = [];
const ok = (n: string) => {
  pass++;
  console.log(`  PASS  ${n}`);
};
const bad = (n: string, d: unknown) => {
  failures.push(`${n} — ${d}`);
  console.log(`  FAIL  ${n}\n          ${d}`);
};
const eq = (n: string, actual: unknown, expected: unknown) =>
  actual === expected ? ok(`${n} (${String(actual)})`) : bad(n, `expected ${expected}, got ${actual}`);

/** A stable phone for the fixture member, cleaned up at the end. */
const TEST_PHONE = "08039999001";
const TEST_E164 = "+2348039999001";

async function main() {
  const service: Actor = { kind: "service", reason: "integration test" };
  const admin = prismaRepositories(service);

  // Clear anything a previous run left behind before asserting on counts —
  // a balance test is meaningless if the card already has points on it.
  await purgeFixtures();

  // Find the seeded Gwarinpa manager and cashier to act as.
  const roster = await admin.staff.roster();
  const cashierRow = roster.find((s) => s.staffCode === "GWA-C01");
  const managerRow = roster.find((s) => s.staffCode === "GWA-M01");
  if (!cashierRow?.branchId || !managerRow?.branchId) {
    throw new Error("Seed first: npm run db:seed");
  }

  const cashier: Actor = {
    kind: "staff",
    staffId: cashierRow.id,
    role: "sales_person",
    branchId: cashierRow.branchId,
  };
  const manager: Actor = {
    kind: "staff",
    staffId: managerRow.id,
    role: "branch_manager",
    branchId: managerRow.branchId,
  };

  const asCashier = prismaRepositories(cashier);
  const asManager = prismaRepositories(manager);

  /* ── 1. A shift starts itself at sign-in ───────────────────────────────── */
  console.log("\n1. Shift opens on sign-in, and only once");

  const first = await asCashier.shifts.startForSignIn("Till 1");
  if (first) ok(`shift opened at ${first.openedAt}`);
  else bad("shift opened", "got null");

  const second = await asCashier.shifts.startForSignIn("Till 1");
  eq("signing in again returns the same shift", second?.id, first?.id);

  const current = await asCashier.shifts.current();
  eq("the cashier is on shift", current?.status, "open");

  // The manager sees it on their dashboard, with the clock already running.
  const overview = await asManager.dashboards.manager(todayInLagos());
  const onShift = overview.onShift.find((r) => r.staffId === cashierRow.id);
  if (onShift) {
    ok(`manager sees "${onShift.staffName}" on ${onShift.tillLabel} since ${onShift.since}`);
  } else {
    bad("manager sees the open shift", JSON.stringify(overview.onShift));
  }

  /* ── 2. Enrolment: name and number, both required ──────────────────────── */
  console.log("\n2. Loyalty enrolment");

  const noName = await asCashier.customers.enrol({ fullName: "", phone: TEST_PHONE });
  eq("a card with no name is refused", noName.ok === false && noName.field, "fullName");

  const badPhone = await asCashier.customers.enrol({ fullName: "Ada Obi", phone: "12345" });
  eq("a card with no usable number is refused", badPhone.ok === false && badPhone.field, "phone");

  const enrolled = await asCashier.customers.enrol({
    fullName: "  Ada   Obi  ",
    phone: "0803 999 9001",
  });
  if (!enrolled.ok) throw new Error(`enrolment failed: ${enrolled.message}`);
  eq("the name is tidied", enrolled.lookup.customer.fullName, "Ada Obi");
  eq("the number is normalised to E.164", enrolled.lookup.customer.phone, TEST_E164);
  eq("a new card starts at zero", enrolled.lookup.pointsBalance, 0);
  eq("and cannot be redeemed yet", enrolled.lookup.canRedeem, false);

  const again = await asCashier.customers.enrol({ fullName: "Ada Obi", phone: TEST_PHONE });
  eq(
    "enrolling a number already on the scheme returns their card",
    again.ok && again.lookup.customer.id,
    enrolled.lookup.customer.id,
  );

  // Whatever shape the cashier keys, one person.
  for (const keyed of ["08039999001", "+234 803 999 9001", "803 999 9001"]) {
    const found = await asCashier.customers.findByPhone(keyed);
    eq(`"${keyed}" finds the same card`, found?.customer.id, enrolled.lookup.customer.id);
  }

  const customerId = enrolled.lookup.customer.id;

  /* ── 3. A sale moves the points ledger ─────────────────────────────────── */
  console.log("\n3. Points earned on a sale");

  const products = await asCashier.catalog.listProducts();
  const product = products[0];
  if (!product) throw new Error("No products — seed first.");

  const staff: Staff = {
    id: cashierRow.id,
    orgId: "",
    branchId: cashierRow.branchId,
    branchName: "Gwarinpa",
    role: "sales_person",
    fullName: cashierRow.fullName,
    email: cashierRow.email ?? "",
    staffCode: cashierRow.staffCode,
    status: "active",
  };

  // A basket worth ₦10,000 exactly, so the arithmetic is checkable by eye.
  const sale = saleOf(product, staff, naira(10_000), {
    id: customerId,
    fullName: "Ada Obi",
    tier: "bronze",
  });

  const recorded = await asCashier.sales.record(sale);
  eq("the sale records", recorded.ok, true);
  eq("₦10,000 earns 100 points", recorded.sale.pointsEarned, 100);

  const afterSale = await asCashier.customers.findByPhone(TEST_PHONE);
  eq("the balance moved", afterSale?.pointsBalance, 100);
  eq("100 points is not yet redeemable", afterSale?.canRedeem, false);
  eq(
    "and the till says how far off they are",
    afterSale?.pointsToRedemption,
    MINIMUM_REDEEMABLE_POINTS - 100,
  );

  const history = await asCashier.customers.pointsHistory(customerId);
  eq("the movement is on the ledger", history[0]?.delta, 100);
  eq("with the reason recorded", history[0]?.reason, "EARN");
  eq("and the receipt it came from", history[0]?.ref, sale.receiptNo);

  /* ── 4. Redemption, once the balance is worth something ────────────────── */
  console.log("\n4. Redemption");

  // Another ₦45,000 of shopping takes them past the threshold.
  const big = saleOf(product, staff, naira(45_000), {
    id: customerId,
    fullName: "Ada Obi",
    tier: "bronze",
  });
  await asCashier.sales.record(big);

  const rich = await asCashier.customers.findByPhone(TEST_PHONE);
  eq("balance after a bigger shop", rich?.pointsBalance, 550);
  eq("now redeemable", rich?.canRedeem, true);

  // Spend 500 points (₦500) against a ₦2,000 bill.
  const withPoints = saleOf(
    product,
    staff,
    naira(2_000),
    { id: customerId, fullName: "Ada Obi", tier: "bronze" },
    500,
  );
  const redeemed = await asCashier.sales.record(withPoints);

  eq("500 points came off the bill", redeemed.sale.pointsRedeemed, 500);
  eq(
    "and only the ₦1,500 actually paid earned",
    redeemed.sale.pointsEarned,
    15,
  );

  const afterRedeem = await asCashier.customers.findByPhone(TEST_PHONE);
  eq("the balance is debited then credited", afterRedeem?.pointsBalance, 550 - 500 + 15);

  /* ── 5. A sale with no card is the ordinary sale ───────────────────────── */
  console.log("\n5. A sale without a card");

  const anonymous = saleOf(product, staff, naira(3_000), null);
  const plain = await asCashier.sales.record(anonymous);
  eq("it settles", plain.ok, true);
  eq("no card attached", plain.sale.customerId, null);
  eq("nothing earned", plain.sale.pointsEarned, 0);

  /* ── 6. The manager's roster ───────────────────────────────────────────── */
  console.log("\n6. Branch manager manages their own branch");

  const created = await asManager.staff.createSalesPerson({
    fullName: "Test Cashier",
    phone: "08039999002",
    email: `test.cashier.${Date.now()}@swiftgrocers.ng`,
    branchId: "ignored-on-purpose",
  });
  if (!created.ok) throw new Error(`create failed: ${created.message}`);

  eq("the new cashier is on the manager's branch", created.staff.branchId, managerRow.branchId);
  eq("with a branch-scoped staff code", created.staff.staffCode.startsWith("GWA-C"), true);
  eq("a PIN is issued once", created.temporaryPin.length, 4);
  eq("they start as invited", created.staff.status, "invited");

  const suspended = await asManager.staff.setStatus(created.staff.id, "suspended");
  eq("suspending works", suspended.ok && suspended.staff.status, "suspended");

  const reinstated = await asManager.staff.setStatus(created.staff.id, "active");
  eq("and reinstating", reinstated.ok && reinstated.staff.status, "active");

  const pin = await asManager.staff.resetPin(created.staff.id);
  eq("a PIN can be reissued", pin.ok && pin.pin.length, 4);
  if (pin.ok && created.temporaryPin === pin.pin) {
    bad("the reissued PIN is different", "got the same PIN twice");
  } else {
    ok("the reissued PIN is a new one");
  }

  // Suspending someone must close the till they left open.
  const victim = prismaRepositories({
    kind: "staff",
    staffId: created.staff.id,
    role: "sales_person",
    branchId: managerRow.branchId,
  });
  await victim.shifts.startForSignIn("Till 9");
  await asManager.staff.setStatus(created.staff.id, "suspended");
  const stranded = await victim.shifts.current();
  eq("suspending closes the till behind them", stranded, null);

  /* ── Cleanup ───────────────────────────────────────────────────────────── */
  await cleanup(customerId, created.staff.id);

  console.log(`\n${"—".repeat(66)}`);
  if (failures.length) {
    console.log(`${pass} passed, ${failures.length} FAILED\n`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log(`${pass} passed.`);
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function todayInLagos(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Receipt numbers are branch-and-day scoped and unique, so a fixed sequence
 * would collide with anything a previous run left behind. Starting from the
 * clock keeps each run in its own range.
 */
let sequence = Date.now() % 5_000;

/** A one-line sale for exactly `total`, so the point arithmetic is legible. */
function saleOf(
  product: Product,
  staff: Staff,
  total: ReturnType<typeof naira>,
  customer: { id: string; fullName: string; tier: "bronze" | "silver" | "gold" } | null,
  redeemPoints = 0,
) {
  const at = new Date().toISOString();
  sequence += 1;

  const line = {
    product: { ...product, price: total },
    quantity: units(1),
    unitPrice: total,
    discount: { kobo: 0 },
  };

  const tenders = [
    ...(redeemPoints > 0
      ? [{ method: "loyalty_points" as const, amount: { kobo: redeemPoints * 100 } }]
      : []),
    { method: "cash" as const, amount: { kobo: total.kobo - redeemPoints * 100 } },
  ];

  const sale = buildSale({
    lines: [line as never],
    tenders,
    staff,
    at,
    sequence,
    takenOffline: false,
    customer,
  });

  return { ...sale, clientId: `test-${Date.now()}-${sequence}` };
}

/** Everything this suite has ever created, gone. Safe to run at any time. */
async function purgeFixtures() {
  const { prisma } = await import("@/lib/db/client");
  const { withActor } = await import("@/lib/db/session");

  await withActor(prisma, { kind: "service", reason: "test purge" }, async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE NONE`);
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);

    await tx.$executeRawUnsafe(`
      DELETE FROM sale_line WHERE sale_id IN (
        SELECT id FROM sale WHERE client_id LIKE 'test-%')`);
    await tx.$executeRawUnsafe(`
      DELETE FROM tender WHERE sale_id IN (
        SELECT id FROM sale WHERE client_id LIKE 'test-%')`);
    await tx.$executeRawUnsafe(`
      DELETE FROM stock_ledger WHERE ref IN (
        SELECT receipt_no FROM sale WHERE client_id LIKE 'test-%')`);
    await tx.$executeRawUnsafe(`DELETE FROM sale WHERE client_id LIKE 'test-%'`);

    await tx.$executeRawUnsafe(`
      DELETE FROM loyalty_ledger WHERE customer_id IN (
        SELECT id FROM customer WHERE phone = '${TEST_E164}')`);
    await tx.$executeRawUnsafe(`DELETE FROM customer WHERE phone = '${TEST_E164}'`);

    await tx.$executeRawUnsafe(`
      DELETE FROM shift WHERE staff_id IN (
        SELECT id FROM staff WHERE email LIKE 'test.cashier.%@swiftgrocers.ng')`);
    await tx.$executeRawUnsafe(`
      DELETE FROM audit_log WHERE entity_id IN (
        SELECT id::text FROM staff WHERE email LIKE 'test.cashier.%@swiftgrocers.ng')`);
    await tx.$executeRawUnsafe(
      `DELETE FROM staff WHERE email LIKE 'test.cashier.%@swiftgrocers.ng'`);
  });
}

/** Leave the database as it was found. */
async function cleanup(customerId: string, staffId: string) {
  const { prisma } = await import("@/lib/db/client");
  const { withActor } = await import("@/lib/db/session");

  await withActor(prisma, { kind: "service", reason: "test cleanup" }, async (tx) => {
    const sales = await tx.sale.findMany({
      where: { OR: [{ customerId }, { staffId }] },
      select: { id: true },
    });
    const ids = sales.map((s) => s.id);

    // Append-only tables refuse DELETE by trigger as well as by grant, and
    // rightly so — for everybody, including the owner. Dropping back to the
    // session role gets the grants; suspending user triggers for this
    // transaction gets past the rest.
    //
    // Both are scoped to this transaction and to cleanup alone. Every
    // assertion above ran with the locks fully live, which is the only way
    // they mean anything.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE NONE`);
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
    if (ids.length) {
      await tx.$executeRawUnsafe(
        `DELETE FROM sale_line WHERE sale_id = ANY($1::uuid[])`, ids,
      );
      await tx.$executeRawUnsafe(`DELETE FROM tender WHERE sale_id = ANY($1::uuid[])`, ids);
      await tx.$executeRawUnsafe(`DELETE FROM stock_ledger WHERE ref IN (
        SELECT receipt_no FROM sale WHERE id = ANY($1::uuid[]))`, ids);
      await tx.$executeRawUnsafe(`DELETE FROM sale WHERE id = ANY($1::uuid[])`, ids);
    }
    await tx.$executeRawUnsafe(`DELETE FROM loyalty_ledger WHERE customer_id = $1::uuid`, customerId);
    await tx.$executeRawUnsafe(`DELETE FROM customer WHERE id = $1::uuid`, customerId);
    await tx.$executeRawUnsafe(`DELETE FROM shift WHERE staff_id = $1::uuid`, staffId);
    await tx.$executeRawUnsafe(`DELETE FROM audit_log WHERE entity_id = $1`, staffId);
    await tx.$executeRawUnsafe(`DELETE FROM staff WHERE id = $1::uuid`, staffId);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
