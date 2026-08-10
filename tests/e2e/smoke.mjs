/**
 * Layout and access smoke checks.
 *
 * Not the twelve journeys of SPEC §18 — those need the real backend. This is the
 * cheap net that catches the class of bug you cannot see in server-rendered HTML:
 * a guard that never resolves, a table that scrolls the whole page sideways on a
 * phone, or till text that has drifted below the 16px floor (§14).
 *
 *   node tests/e2e/smoke.mjs                  # against http://localhost:3000
 *   BASE=http://localhost:3100 node tests/e2e/smoke.mjs
 *
 * Run it against `next start`, not `next dev` — the dev overlay injects its own
 * fixed-position furniture and muddies the overflow measurements.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";

const ACCOUNTS = {
  cashier: ["blessing.a@swiftgrocers.ng", "blessing-2026", "/till"],
  manager: ["gwarinpa.manager@swiftgrocers.ng", "gwarinpa-2026", "/manager"],
  admin: ["admin@swiftgrocers.ng", "hq-admin-2026", "/hq"],
};

const VIEWPORTS = [
  { tag: "mobile", width: 390, height: 844 },
  { tag: "tablet", width: 834, height: 1112 },
  { tag: "desktop", width: 1440, height: 1000 },
];

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(`${name} ${detail}`.trim());
};

async function signIn(page, who) {
  const [id, password, landing] = ACCOUNTS[who];
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByLabel(/Email address|Staff code/).fill(id);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**${landing}`, { timeout: 10_000 });
}

const sidewaysScroll = (page) =>
  page.evaluate(() => {
    window.scrollTo(9999, 0);
    const x = window.scrollX;
    window.scrollTo(0, 0);
    return x;
  });

const browser = await chromium.launch();

/* Each role lands in its own workspace and the guard actually resolves. */
for (const [who, [, , landing]] of Object.entries(ACCOUNTS)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await signIn(page, who);
  await page.waitForTimeout(400);

  check(`${who} lands on ${landing}`, new URL(page.url()).pathname === landing, page.url());
  check(
    `${who} guard resolves`,
    (await page.getByText("Checking your access").count()) === 0,
  );
  check(`${who} console clean`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* Every image actually loads. Next's optimizer 400s on SVG unless
   `dangerouslyAllowSVG` is set, and a broken logo renders as a silent icon. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const broken = await page.evaluate(() =>
    [...document.images]
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.currentSrc || img.src),
  );
  check("all images load on /login", broken.length === 0, broken.join(" | "));
  await ctx.close();
}

/* A branch manager must not reach HQ. */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, "manager");
  await page.goto(`${BASE}/hq`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check(
    "manager bounced out of /hq",
    new URL(page.url()).pathname === "/manager",
    page.url(),
  );
  await ctx.close();
}

/* Nothing scrolls sideways, at any width. */
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.width < 500,
    hasTouch: vp.width < 500,
  });
  const page = await ctx.newPage();
  await signIn(page, "admin");
  for (const route of ["/hq", "/manager", "/till/history"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const x = await sidewaysScroll(page);
    check(`${route} no sideways scroll @ ${vp.tag}`, x === 0, x ? `${x}px` : "");
  }
  await ctx.close();
}

/* Every role can see who they are and sign out, from any screen — including a
   route that is still a placeholder. */
for (const who of Object.keys(ACCOUNTS)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await signIn(page, who);
  await page.waitForTimeout(300);
  check(
    `${who} has the account menu in the top bar`,
    (await page.getByRole("button", { name: /Sign out|Achike|Nwosu|Adeyemi/ }).count()) > 0,
  );
  await ctx.close();
}

/* The till rail names every icon, permanently — a hover flyout is invisible to
   a finger, and the till is touch hardware. */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page, "cashier");
  await page.goto(`${BASE}/till/history`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const names = await page.locator("nav[aria-label='Workspace'] a").allInnerTexts();
  check(
    "till rail names every icon",
    names.length > 0 && names.every((n) => n.trim().length > 0),
    JSON.stringify(names),
  );
  await ctx.close();
}

/* SPEC §14: nothing on a till screen is below 16px. */
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  await signIn(page, "cashier");
  await page.goto(`${BASE}/till/history`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const small = await page.evaluate(() =>
    [...document.querySelectorAll("[data-surface='till'] *")]
      .filter((el) => {
        const owns = [...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim(),
        );
        if (!owns) return false;
        const cs = getComputedStyle(el);
        return (
          cs.visibility !== "hidden" &&
          cs.display !== "none" &&
          parseFloat(cs.fontSize) < 16
        );
      })
      .map((el) => `${getComputedStyle(el).fontSize} "${el.textContent.trim().slice(0, 30)}"`),
  );
  check("till type floor is 16px", small.length === 0, small.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close();

console.log(
  failures.length ? `\n${failures.length} FAILED:\n- ${failures.join("\n- ")}` : "\nAll smoke checks passed.",
);
process.exit(failures.length ? 1 : 0);
