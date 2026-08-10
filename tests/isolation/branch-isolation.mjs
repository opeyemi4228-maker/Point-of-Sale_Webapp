/**
 * The blocking test — SPEC §18, journey 12.
 *
 * A session authenticated as Branch A's manager must receive exactly zero rows
 * belonging to Branch B on select, and a rejection on insert, update and
 * delete. A single leaked row fails the build.
 *
 * It runs against the database directly rather than through Prisma, on purpose.
 * The thing under test is the row-level security in
 * `prisma/migrations/*_security/migration.sql` — if the proof went through the
 * same client the application uses, a bug in that client's scoping would hide a
 * hole in the database's. Here the harness sets `app.*` by hand, exactly as a
 * hostile caller with a valid connection would.
 *
 *   DIRECT_DATABASE_URL=... node tests/isolation/branch-isolation.mjs
 *
 * Locally, with no Neon:
 *   npx prisma dev start sg -d
 *   DIRECT_DATABASE_URL="postgres://postgres:postgres@localhost:<port>/template1?sslmode=disable" \
 *     node tests/isolation/branch-isolation.mjs --reset
 *
 * `--reset` drops and rebuilds the schema from the migrations first. It refuses
 * to run against anything that is not obviously a local database.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const URL_STR = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const RESET = process.argv.includes("--reset");

if (!URL_STR) {
  console.error("Set DIRECT_DATABASE_URL (the owner role) — see docs/DATABASE.md");
  process.exit(2);
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const ORG = "00000000-0000-0000-0000-0000000000e1";
const A = "aaaaaaaa-0000-0000-0000-0000000000ea"; // "branch A"
const B = "bbbbbbbb-0000-0000-0000-0000000000eb";
const MGR_A = "11111111-0000-0000-0000-0000000000ea";
const MGR_B = "11111111-0000-0000-0000-0000000000eb";
const ADMIN = "11111111-0000-0000-0000-0000000000ef";
const CAT = "22222222-0000-0000-0000-0000000000e1";
const P_ONLINE = "33333333-0000-0000-0000-0000000000e1";
const P_SHOP = "33333333-0000-0000-0000-0000000000e2";
const CUST1 = "44444444-0000-0000-0000-0000000000e1";
const CUST2 = "44444444-0000-0000-0000-0000000000e2";
const ORD_A = "55555555-0000-0000-0000-0000000000ea";
const ORD_B = "55555555-0000-0000-0000-0000000000eb";
const SALE_A = "66666666-0000-0000-0000-0000000000ea";

const staffA = { "app.actor_kind": "staff", "app.staff_role": "branch_manager", "app.staff_id": MGR_A, "app.branch_id": A };
const staffB = { "app.actor_kind": "staff", "app.staff_role": "branch_manager", "app.staff_id": MGR_B, "app.branch_id": B };
const admin = { "app.actor_kind": "staff", "app.staff_role": "general_admin", "app.staff_id": ADMIN };
const shopper = { "app.actor_kind": "customer", "app.customer_id": CUST1 };

let pass = 0;
const failures = [];
const ok = (n) => { pass++; console.log(`  PASS  ${n}`); };
const bad = (n, d) => { failures.push(`${n} — ${d}`); console.log(`  FAIL  ${n}\n          ${d}`); };

async function rows(c, name, sql, params, expected) {
  try {
    const r = await c.query(sql, params);
    if (r.rows.length === expected) ok(`${name} (${r.rows.length})`);
    else bad(name, `expected ${expected} rows, got ${r.rows.length}`);
  } catch (e) { bad(name, `unexpected error: ${e.message}`); }
}

// Each attempt gets a savepoint: a rejected statement poisons the transaction,
// and without one every later assertion reports the same "transaction is
// aborted" and proves nothing.
async function rejects(c, name, sql, params) {
  await c.query("SAVEPOINT probe");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT probe");
    bad(name, "the statement SUCCEEDED and should not have");
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT probe");
    ok(`${name} — refused (${e.message.split("\n")[0].slice(0, 60)})`);
  }
}

/**
 * An UPDATE or DELETE aimed at a row the session cannot see.
 *
 * Row-level security does not raise here — it filters the row out before the
 * statement reaches it, so the command succeeds having touched nothing. That is
 * the correct and safe outcome, and it is why these are asserted on the
 * affected-row count rather than on an exception: expecting an error would make
 * the test pass for the wrong reason the day the policy disappeared and the
 * statement started matching a real row.
 */
async function affectsNothing(c, name, sql, params) {
  await c.query("SAVEPOINT probe");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT probe");
    if (r.rowCount === 0) ok(`${name} — 0 rows affected`);
    else bad(name, `MODIFIED ${r.rowCount} row(s) belonging to another branch`);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT probe");
    ok(`${name} — refused (${e.message.split("\n")[0].slice(0, 60)})`);
  }
}

async function allows(c, name, sql, params) {
  await c.query("SAVEPOINT probe");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT probe");
    ok(name);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT probe");
    bad(name, `should have been allowed: ${e.message}`);
  }
}

/** Open a transaction wearing an identity, exactly as src/lib/db/session.ts does. */
async function as(c, claims, fn) {
  await c.query("BEGIN");
  await c.query("SET LOCAL ROLE swiftgrocers_app");
  for (const [k, v] of Object.entries(claims)) {
    await c.query("SELECT set_config($1, $2, true)", [k, v ?? ""]);
  }
  try { await fn(); } finally { await c.query("ROLLBACK"); }
}

async function resetSchema(c) {
  const host = new global.URL(URL_STR.replace(/^postgres/, "http")).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) {
    console.error(`--reset refuses to touch ${host}. Local databases only.`);
    process.exit(2);
  }
  await c.query(`DROP SCHEMA IF EXISTS app CASCADE`);
  await c.query(`DROP SCHEMA public CASCADE`);
  await c.query(`CREATE SCHEMA public`);

  const dir = join(ROOT, "prisma", "migrations");
  for (const name of readdirSync(dir).filter((d) => !d.startsWith(".")).sort()) {
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    await c.query(sql);
    console.log(`  applied ${name}`);
  }

  // `prisma dev`'s local Postgres hangs its own change-capture trigger on every
  // table, writing into a schema the app role cannot see. Neon has no such
  // thing; this keeps the local tooling from looking like a policy failure.
  const wal = await c.query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = '_prisma_dev_wal'`,
  );
  if (wal.rows.length) {
    await c.query(`GRANT USAGE ON SCHEMA _prisma_dev_wal TO swiftgrocers_app`);
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _prisma_dev_wal TO swiftgrocers_app`);
    await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA _prisma_dev_wal TO swiftgrocers_app`);
  }
}

async function seedFixtures(c) {
  // Clearing the previous run means deleting from append-only tables, which
  // the triggers in the security migration exist to forbid — correctly, and
  // for everybody including the owner. `session_replication_role = replica`
  // suspends user triggers for this session only, which is the sanctioned way
  // to do surgery on a table that ordinarily refuses it.
  //
  // Scoped as tightly as possible and restored immediately below. It is set
  // here and nowhere else in the suite: the assertions themselves must run with
  // every trigger live, or they prove nothing.
  await c.query(`SET session_replication_role = 'replica'`);

  // One statement per call: Postgres will not accept several commands in a
  // single *parameterised* query.
  await c.query(`DELETE FROM stock_reservation WHERE order_id IN ($1,$2)`, [ORD_A, ORD_B]);
  await c.query(`DELETE FROM order_line WHERE order_id IN ($1,$2)`, [ORD_A, ORD_B]);
  await c.query(`DELETE FROM order_event WHERE order_id IN ($1,$2)`, [ORD_A, ORD_B]);
  await c.query(`DELETE FROM "order" WHERE id IN ($1,$2)`, [ORD_A, ORD_B]);
  await c.query(`DELETE FROM sale_line WHERE sale_id = $1`, [SALE_A]);
  await c.query(`DELETE FROM tender WHERE sale_id = $1`, [SALE_A]);
  await c.query(`DELETE FROM sale WHERE id = $1`, [SALE_A]);
  await c.query(`DELETE FROM stock_ledger WHERE branch_id IN ($1,$2)`, [A, B]);
  await c.query(`DELETE FROM staff WHERE id IN ($1,$2,$3)`, [MGR_A, MGR_B, ADMIN]);
  await c.query(`DELETE FROM staff WHERE email LIKE 'iso.%@swiftgrocers.ng'`);
  await c.query(`DELETE FROM customer WHERE id IN ($1,$2)`, [CUST1, CUST2]);
  await c.query(`DELETE FROM product WHERE id IN ($1,$2)`, [P_ONLINE, P_SHOP]);
  await c.query(`DELETE FROM category WHERE id = $1`, [CAT]);
  await c.query(`DELETE FROM branch WHERE id IN ($1,$2)`, [A, B]);
  await c.query(`DELETE FROM org WHERE id = $1`, [ORG]);

  await c.query(`INSERT INTO org (id, name) VALUES ($1,'Isolation Fixture')`, [ORG]);
  await c.query(
    `INSERT INTO branch (id, org_id, code, name, city, state, address, phone, status, latitude, longitude, service_radius_m, delivers_online) VALUES
       ($1,$2,'ZZA','Fixture A','Abuja','FCT','1 A Road','+2340000000001','active', 9.1100, 7.4100, 15000, true),
       ($3,$2,'ZZB','Fixture B','Lagos','Lagos','1 B Road','+2340000000002','active', 6.4400, 3.4700, 15000, true)`,
    [A, ORG, B],
  );
  await c.query(
    `INSERT INTO staff (id, org_id, branch_id, full_name, email, staff_code, role, status) VALUES
       ($1,$2,$3,'Manager A','iso.a@swiftgrocers.ng','ZZA-M01','branch_manager','active'),
       ($4,$2,$5,'Manager B','iso.b@swiftgrocers.ng','ZZB-M01','branch_manager','active'),
       ($6,$2,NULL,'Iso Admin','iso.hq@swiftgrocers.ng','ZZ-HQ1','general_admin','active')`,
    [MGR_A, ORG, A, MGR_B, B, ADMIN],
  );
  await c.query(`INSERT INTO category (id, slug, name) VALUES ($1,'iso-fixture','Isolation Fixture')`, [CAT]);
  await c.query(
    `INSERT INTO product (id, sku, slug, name, category_id, price_kobo, cost_kobo, unit, online_listed) VALUES
       ($1,'ZZ-0001','iso-online','Listed Online',$3, 500000, 300000,'ea', true),
       ($2,'ZZ-0002','iso-shop','Shop Only',$3, 20000, 8000,'ea', false)`,
    [P_ONLINE, P_SHOP, CAT],
  );
  await c.query(
    `INSERT INTO stock_ledger (branch_id, product_id, delta_milli, reason, staff_name) VALUES
       ($1,$3, 40000,'BRANCH_OPENED','System'),
       ($1,$4, 10000,'BRANCH_OPENED','System'),
       ($2,$3, 25000,'BRANCH_OPENED','System')`,
    [A, B, P_ONLINE, P_SHOP],
  );
  await c.query(
    `INSERT INTO customer (id, full_name, phone) VALUES ($1,'Iso Shopper One','+2349000000001'),($2,'Iso Shopper Two','+2349000000002')`,
    [CUST1, CUST2],
  );
  await c.query(
    `INSERT INTO "order" (id, order_no, customer_id, branch_id, status, payment_status, subtotal_kobo, total_kobo) VALUES
       ($1,'ISO-A',$3,$5,'accepted','paid', 500000, 500000),
       ($2,'ISO-B',$4,$6,'accepted','paid', 500000, 500000)`,
    [ORD_A, ORD_B, CUST1, CUST2, A, B],
  );
  await c.query(
    `INSERT INTO sale (id, client_id, receipt_no, branch_id, staff_id, branch_name, staff_name, staff_code, subtotal_kobo, total_kobo, taken_offline)
     VALUES ($1,'iso-cli-1','ISO-ZZA-0001',$2,$3,'Fixture A','Manager A','ZZA-M01', 500000, 500000, true)`,
    [SALE_A, A, MGR_A],
  );

  // Triggers back on before a single assertion runs.
  await c.query(`SET session_replication_role = 'origin'`);
}

/* ── the suite ────────────────────────────────────────────────────────────── */

const c = new Client(URL_STR);
await c.connect();

if (RESET) {
  console.log("\nrebuilding schema from prisma/migrations");
  await resetSchema(c);
}
await seedFixtures(c);

console.log("\nJourney 12 — Branch A's manager against Branch B");
await as(c, staffA, async () => {
  await rows(c, "ledger: only own branch", `SELECT * FROM stock_ledger`, [], 2);
  await rows(c, "ledger: asking for B explicitly returns nothing", `SELECT * FROM stock_ledger WHERE branch_id = $1`, [B], 0);
  await rows(c, "sales: cannot see B's", `SELECT * FROM sale WHERE branch_id = $1`, [B], 0);
  await rows(c, "orders: only own branch", `SELECT * FROM "order"`, [], 1);
  await rows(c, "staff: only own roster", `SELECT * FROM staff WHERE branch_id IS NOT NULL`, [], 1);
  await rows(c, "branch B's shifts are invisible", `SELECT * FROM shift WHERE branch_id = $1`, [B], 0);

  await rejects(c, "cannot append a movement to B",
    `INSERT INTO stock_ledger (branch_id, product_id, delta_milli, reason, staff_name)
     VALUES ($1,$2,-1000,'DAMAGE','Manager A')`, [B, P_ONLINE]);
  await rejects(c, "cannot ring a sale against B",
    `INSERT INTO sale (client_id, receipt_no, branch_id, staff_id, branch_name, staff_name, staff_code, subtotal_kobo, total_kobo)
     VALUES ('x','ISO-X',$1,$2,'B','Manager A','ZZA-M01',1,1)`, [B, MGR_A]);
  await affectsNothing(c, "cannot cancel B's order",
    `UPDATE "order" SET status = 'cancelled' WHERE id = $1`, [ORD_B]);
  await affectsNothing(c, "cannot delete B's order",
    `DELETE FROM "order" WHERE id = $1`, [ORD_B]);
  await affectsNothing(c, "cannot close B's shift",
    `UPDATE shift SET status = 'closed' WHERE branch_id = $1`, [B]);
  await affectsNothing(c, "cannot re-home B's device",
    `UPDATE device SET branch_id = $1 WHERE branch_id = $2`, [A, B]);
  await allows(c, "can append a movement to its own branch",
    `INSERT INTO stock_ledger (branch_id, product_id, delta_milli, reason, staff_name)
     VALUES ($1,$2,-1000,'DAMAGE','Manager A')`, [A, P_ONLINE]);
});

// The count above says the statement matched nothing. This says the row is
// actually still there, still accepted, and still Branch B's — checked from
// outside the session that tried to change it.
{
  const r = await c.query(`SELECT status, branch_id FROM "order" WHERE id = $1`, [ORD_B]);
  if (r.rows.length === 1 && r.rows[0].status === "accepted" && r.rows[0].branch_id === B) {
    ok("B's order survived A's attempts, unchanged");
  } else {
    bad("B's order survived A's attempts", JSON.stringify(r.rows));
  }
}

console.log("\n...and the same in reverse");
await as(c, staffB, async () => {
  await rows(c, "B sees only its own ledger", `SELECT * FROM stock_ledger`, [], 1);
  await rows(c, "B cannot see A's sale", `SELECT * FROM sale WHERE id = $1`, [SALE_A], 0);
  await rejects(c, "B cannot append to A", `INSERT INTO stock_ledger (branch_id, product_id, delta_milli, reason, staff_name)
     VALUES ($1,$2,-1000,'DAMAGE','Manager B')`, [A, P_ONLINE]);
});

console.log("\nHQ sees the chain");
await as(c, admin, async () => {
  await rows(c, "every branch's ledger", `SELECT * FROM stock_ledger WHERE branch_id IN ($1,$2)`, [A, B], 3);
  await rows(c, "every order", `SELECT * FROM "order" WHERE id IN ($1,$2)`, [ORD_A, ORD_B], 2);
});

console.log("\nA session that names nobody sees nothing");
await as(c, {}, async () => {
  await rows(c, "no ledger", `SELECT * FROM stock_ledger`, [], 0);
  await rows(c, "no products", `SELECT * FROM product`, [], 0);
  await rows(c, "no customers", `SELECT * FROM customer`, [], 0);
  await rows(c, "no sales", `SELECT * FROM sale`, [], 0);
});

console.log("\nA branch manager runs their own cashiers, and only those");
await as(c, staffA, async () => {
  await allows(c, "may add a cashier to their own branch",
    `INSERT INTO staff (org_id, branch_id, full_name, email, staff_code, role)
     VALUES ($1,$2,'New Cashier','iso.new@swiftgrocers.ng','ZZA-C01','sales_person')`, [ORG, A]);

  await rejects(c, "may not add a cashier to another branch",
    `INSERT INTO staff (org_id, branch_id, full_name, email, staff_code, role)
     VALUES ($1,$2,'Poached','iso.poach@swiftgrocers.ng','ZZB-C09','sales_person')`, [ORG, B]);

  await rejects(c, "may not appoint another manager",
    `INSERT INTO staff (org_id, branch_id, full_name, email, staff_code, role)
     VALUES ($1,$2,'Rival','iso.rival@swiftgrocers.ng','ZZA-M09','branch_manager')`, [ORG, A]);

  await rejects(c, "may not appoint an admin",
    `INSERT INTO staff (org_id, branch_id, full_name, email, staff_code, role)
     VALUES ($1,NULL,'Usurper','iso.usurp@swiftgrocers.ng','ZZ-HQ9','general_admin')`, [ORG]);

  await affectsNothing(c, "may not amend another branch's roster",
    `UPDATE staff SET status = 'suspended' WHERE id = $1`, [MGR_B]);

  await affectsNothing(c, "may not promote themselves",
    `UPDATE staff SET role = 'general_admin' WHERE id = $1`, [MGR_A]);
});

console.log("\nAppend-only ledgers (rule 3)");
await as(c, staffA, async () => {
  await rejects(c, "no UPDATE on stock_ledger", `UPDATE stock_ledger SET delta_milli = 1 WHERE branch_id = $1`, [A]);
  await rejects(c, "no DELETE on stock_ledger", `DELETE FROM stock_ledger WHERE branch_id = $1`, [A]);
  await rejects(c, "no UPDATE on audit_log", `UPDATE audit_log SET detail = 'x'`, []);
  await rejects(c, "no UPDATE on loyalty_ledger", `UPDATE loyalty_ledger SET delta_points = 1`, []);
  await rejects(c, "a zero movement is not a movement",
    `INSERT INTO stock_ledger (branch_id, product_id, delta_milli, reason, staff_name) VALUES ($1,$2,0,'CORRECTION','A')`, [A, P_ONLINE]);
});

console.log("\nA sale is written once (rule 4)");
await as(c, staffA, async () => {
  await allows(c, "may stamp synced_at on a queued offline sale", `UPDATE sale SET synced_at = now() WHERE id = $1`, [SALE_A]);
  await rejects(c, "may not restate the total", `UPDATE sale SET total_kobo = 1 WHERE id = $1`, [SALE_A]);
  await rejects(c, "may not delete it", `DELETE FROM sale WHERE id = $1`, [SALE_A]);
  await rejects(c, "a retried offline sale lands once",
    `INSERT INTO sale (client_id, receipt_no, branch_id, staff_id, branch_name, staff_name, staff_code, subtotal_kobo, total_kobo)
     VALUES ('iso-cli-1','ISO-ZZA-0002',$1,$2,'Fixture A','Manager A','ZZA-M01',1,1)`, [A, MGR_A]);
});

console.log("\nWhat a shopper can reach");
await as(c, shopper, async () => {
  await rows(c, "only their own order", `SELECT * FROM "order" WHERE id IN ($1,$2)`, [ORD_A, ORD_B], 1);
  await rows(c, "not the shop-only product", `SELECT * FROM product WHERE id = $1`, [P_SHOP], 0);
  await rows(c, "the listed product", `SELECT * FROM product WHERE id = $1`, [P_ONLINE], 1);
  await rows(c, "no stock ledger at all", `SELECT * FROM stock_ledger`, [], 0);
  await rows(c, "no staff", `SELECT * FROM staff`, [], 0);
  await rows(c, "no sales", `SELECT * FROM sale`, [], 0);
  await rows(c, "not another shopper", `SELECT * FROM customer WHERE id = $1`, [CUST2], 0);
  const v = await c.query(`SELECT * FROM app.product_public WHERE id = $1`, [P_ONLINE]);
  if (v.rows.length === 1 && !("cost_kobo" in v.rows[0])) ok("product_public withholds cost_kobo");
  else bad("product_public withholds cost_kobo", JSON.stringify(Object.keys(v.rows[0] ?? {})));
});

await c.end();

console.log(`\n${"—".repeat(66)}`);
if (failures.length) {
  console.log(`${pass} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  ${f}`);
  console.log("\nA single leaked row fails the build (SPEC §18).");
  process.exit(1);
}
console.log(`${pass} passed. No branch leaked a row.`);
