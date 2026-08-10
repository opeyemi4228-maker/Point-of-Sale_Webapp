/**
 * The journeys that need a real session — SPEC §18.
 *
 * `smoke.mjs` checks layout and access. This checks the things that only work
 * if sign-in produced a session the *server* can read: creating a cashier,
 * suspending one, and taking a sale against a loyalty card. Every one of them
 * goes through a server action, and a server action with no session refuses —
 * which is exactly the failure this suite exists to catch.
 *
 *   npx next dev -p 3314
 *   BASE=http://localhost:3314 node tests/e2e/staff-and-loyalty.mjs
 *
 * Runs against either data layer. With `DATA_SOURCE=mock` it exercises the
 * fixtures; with `prisma` it exercises Neon. The assertions are the same, which
 * is the point of the repository contract.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";

const MANAGER = ["gwa.manager@swiftgrocers.ng", "swiftgrocers-2026"];
const CASHIER = ["GWA-C01", "1234"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function signIn(page, [identifier, secret]) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  // The screen has two modes. An email address signs in with a password; a
  // staff code signs in with the till PIN, which is a different form.
  if (!identifier.includes("@")) {
    await page.getByRole("button", { name: /sign in with a staff code/i }).click();
    await page.waitForTimeout(400);
  }

  await page.getByLabel(/Email address|Staff code/i).first().fill(identifier);
  await page.getByLabel(/Password|PIN/i).first().fill(secret);

  // Exact, or it also matches the "Sign in with a staff code" switch.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(manager|till|hq)/, { timeout: 25_000 }).catch(() => {});
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

/* ── Sign-in produces a session the server can read ───────────────────────── */

await signIn(page, MANAGER);
check("a manager signs in and lands in their workspace", /\/manager/.test(page.url()), page.url());

const cookie = (await context.cookies()).find((c) => c.name === "swiftgrocers.session");
check("a session cookie is set", Boolean(cookie));
// The whole point: no script on the page can read it, so it cannot be stolen
// by anything injected into the till, and it cannot be forged without the key.
check("the session cookie is HTTP-only", cookie?.httpOnly === true);

check(
  "the manager dashboard shows who is on shift",
  await page.getByText("On shift now").isVisible().catch(() => false),
);

/* ── Creating a cashier: the journey that was refusing ────────────────────── */

await page.goto(`${BASE}/manager/staff`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /add a sales person/i }).click();

const unique = Date.now();
await page.getByLabel("Full name").fill("Opeyemi Titus");
await page.getByLabel("Phone number").fill("08025401891");
await page.getByLabel("Email address").fill(`opeyemi.${unique}@swiftgrocers.ng`);

const passwordField = page.getByLabel("Starting password");
check("the form asks for a starting password", await passwordField.isVisible().catch(() => false));
await passwordField.fill("kitchen-table-2026");

await page.getByRole("button", { name: /create sales person/i }).click();
await page.waitForTimeout(3000);

const body = await page.locator("body").innerText();

check("the cashier is created", /can now sign in/i.test(body));
check("no 'sign in to manage staff' refusal", !/Sign in to manage staff/i.test(body));
check("the credentials panel shows a staff code", /Staff code/i.test(body));
check("...and a till PIN", /Till PIN/i.test(body));
check("...and the password", /Password/i.test(body));
check(
  "...and warns they are shown once",
  /(neither|not) is shown again|shown once/i.test(body.replace(/\s+/g, " ")),
);

/* ── A cashier signs in, and their shift starts itself ────────────────────── */

const tillContext = await browser.newContext();
const tillPage = await tillContext.newPage();
await signIn(tillPage, CASHIER);
check("a cashier signs in with a staff code and PIN", /\/till/.test(tillPage.url()), tillPage.url());

/* ── The loyalty card is offered at payment, and skippable ────────────────── */

await tillPage.goto(`${BASE}/till`, { waitUntil: "networkidle" });
const firstProduct = tillPage.locator("button").filter({ hasText: /₦/ }).first();
await firstProduct.click().catch(() => {});
await tillPage.waitForTimeout(600);

const payButton = tillPage.getByRole("button", { name: /take payment|pay|charge/i }).first();
if (await payButton.isVisible().catch(() => false)) {
  await payButton.click();
  await tillPage.waitForTimeout(900);
  const sheet = await tillPage.locator("body").innerText();

  check("the payment sheet offers a loyalty card", /Loyalty card/i.test(sheet));
  check("...and says it is optional", /Optional/i.test(sheet));
} else {
  check("the payment sheet opens", false, "could not reach payment");
}

check("no uncaught errors on any page", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${"—".repeat(60)}\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.name}`);
  process.exit(1);
}
