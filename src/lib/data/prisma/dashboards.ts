import type { Actor } from "@/lib/db";
import { dbFor } from "@/lib/db";
import { ZERO, kobo, type Money } from "@/lib/domain/money";
import { formatQty, milli } from "@/lib/domain/quantity";
import { isLow, isOversold } from "@/lib/domain/stock";
import { itemCount } from "@/lib/domain/sale";
import { money } from "./mappers";
import { lagosDayBounds } from "./reads";
import type { DashboardRepository } from "../repositories";
import type { HourlyBucket } from "@/components/shared/hourly-sales-chart";
import type {
  AttentionItem,
  BranchPerformance,
  CashierOverview,
  CashierTransaction,
  HqOverview,
  ManagerOverview,
  ShiftRow,
} from "@/types/dashboard";

/**
 * The three overviews — SPEC §15.
 *
 * Each is one round trip, computed from the same rows the detail screens read.
 * That is the whole point: when the sidebar badge says seven lines are below
 * reorder and the stock screen shows nine, nobody trusts either number again.
 * Every figure here is derived from the ledger and the sales, never stored and
 * never typed in.
 *
 * `asOf` is the caller's day, not `new Date()`, so a server render and a client
 * render produce the same string and nothing flickers on hydration.
 */

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no daylight saving.

/** Which Lagos hour an instant falls in. */
const lagosHour = (at: Date): number =>
  new Date(at.getTime() + LAGOS_OFFSET_MS).getUTCHours();

function bucketByHour(
  sales: readonly { at: Date; totalKobo: bigint }[],
): HourlyBucket[] {
  const totals = new Map<number, { total: number; transactions: number }>();
  for (const sale of sales) {
    const hour = lagosHour(sale.at);
    const cell = totals.get(hour) ?? { total: 0, transactions: 0 };
    cell.total += Number(sale.totalKobo);
    cell.transactions += 1;
    totals.set(hour, cell);
  }
  return HOURS.map((hour) => {
    const cell = totals.get(hour);
    return {
      hour,
      total: cell ? kobo(cell.total) : ZERO,
      transactions: cell?.transactions ?? 0,
    };
  });
}

/** Integer division on kobo, so an average is real Money and never a fraction. */
const average = (total: Money, count: number): Money =>
  count ? kobo(Math.round(total.kobo / count)) : ZERO;

const percent = (part: number, whole: number): number =>
  whole ? Math.round((part / whole) * 1000) / 10 : 0;

export function dashboardRepository(actor: Actor): DashboardRepository {
  const db = dbFor(actor);
  const staffId = actor.kind === "staff" ? actor.staffId : null;

  return {
    /* ── The cashier's own day — SPEC §15.1 ──────────────────────────────── */
    async cashier(day: string): Promise<CashierOverview> {
      const { from, to } = lagosDayBounds(day);

      return db(async (tx) => {
        const me = staffId
          ? await tx.staff.findUnique({
              where: { id: staffId },
              select: { fullName: true, branch: { select: { name: true } } },
            })
          : null;

        const shift = staffId
          ? await tx.shift.findFirst({
              where: { staffId, status: "open" },
              orderBy: { openedAt: "desc" },
              select: { tillLabel: true, openedAt: true, openingFloatKobo: true },
            })
          : null;

        const sales = await tx.sale.findMany({
          where: {
            at: { gte: from, lt: to },
            status: "completed",
            ...(staffId ? { staffId } : {}),
          },
          orderBy: { at: "desc" },
          select: {
            id: true,
            receiptNo: true,
            at: true,
            totalKobo: true,
            lines: { select: { qtyMilli: true, soldBy: true } },
            tenders: { select: { method: true, amountKobo: true } },
            customer: { select: { fullName: true } },
          },
        });

        const takings = kobo(sales.reduce((n, s) => n + Number(s.totalKobo), 0));
        const items = sales.reduce(
          (n, s) =>
            n +
            itemCount(
              s.lines.map((l) => ({
                quantity: milli(l.qtyMilli),
                soldBy: l.soldBy,
              })) as never,
            ),
          0,
        );

        // Cash in the drawer: the float, plus every naira tendered as cash.
        // Card and transfer never reach it.
        const cashTendered = sales.reduce(
          (n, s) =>
            n +
            s.tenders
              .filter((t) => t.method === "cash")
              .reduce((m, t) => m + Number(t.amountKobo), 0),
          0,
        );

        const pointsIssued = staffId
          ? ((
              await tx.loyaltyLedger.aggregate({
                where: { at: { gte: from, lt: to }, reason: "EARN" },
                _sum: { deltaPoints: true },
              })
            )._sum.deltaPoints ?? 0)
          : 0;

        const recent: CashierTransaction[] = sales.slice(0, 12).map((s) => ({
          id: s.id,
          receiptNo: s.receiptNo,
          time: new Date(s.at.getTime() + LAGOS_OFFSET_MS)
            .toISOString()
            .slice(11, 16),
          items: itemCount(
            s.lines.map((l) => ({
              quantity: milli(l.qtyMilli),
              soldBy: l.soldBy,
            })) as never,
          ),
          total: money(s.totalKobo),
          method: s.tenders.length === 1 ? s.tenders[0].method : "split",
          ...(s.customer ? { customerName: s.customer.fullName } : {}),
        }));

        return {
          staffName: me?.fullName ?? "",
          branchName: me?.branch?.name ?? "",
          asOf: to.toISOString(),
          shift: shift
            ? {
                tillLabel: shift.tillLabel,
                openedAt: shift.openedAt.toISOString(),
                openingFloat: money(shift.openingFloatKobo),
              }
            : null,
          today: {
            sales: takings,
            transactions: sales.length,
            itemsSold: items,
            averageBasket: average(takings, sales.length),
            cashPosition: kobo(
              (shift ? Number(shift.openingFloatKobo) : 0) + cashTendered,
            ),
            pointsIssued,
          },
          hourly: bucketByHour(sales),
          recent,
        };
      });
    },

    /* ── The branch — SPEC §15.2 ─────────────────────────────────────────── */
    async manager(day: string): Promise<ManagerOverview> {
      const { from, to } = lagosDayBounds(day);

      return db(async (tx) => {
        // No branch filter anywhere below. Row-level security has already
        // narrowed every one of these to the manager's own branch.
        const branch = await tx.branch.findFirst({
          where: { deletedAt: null },
          orderBy: { position: "asc" },
          select: { id: true, name: true },
        });

        const sales = await tx.sale.findMany({
          where: { at: { gte: from, lt: to }, status: "completed" },
          select: {
            at: true,
            totalKobo: true,
            staffId: true,
            staffName: true,
            lines: { select: { qtyMilli: true, lineTotalKobo: true, productId: true } },
            tenders: { select: { method: true, amountKobo: true } },
          },
        });

        const takings = kobo(sales.reduce((n, s) => n + Number(s.totalKobo), 0));

        // Margin needs cost at the moment of sale. The line carries the price
        // it sold at; cost comes from the product, which is the best available
        // approximation until cost is snapshotted onto the line too.
        const productIds = [
          ...new Set(sales.flatMap((s) => s.lines.map((l) => l.productId))),
        ];
        const costs = new Map(
          (
            await tx.product.findMany({
              where: { id: { in: productIds } },
              select: { id: true, costKobo: true },
            })
          ).map((p) => [p.id, Number(p.costKobo)]),
        );
        const costOfSales = sales.reduce(
          (n, s) =>
            n +
            s.lines.reduce(
              (m, l) => m + ((costs.get(l.productId) ?? 0) * l.qtyMilli) / 1000,
              0,
            ),
          0,
        );

        const [openShifts, lowStock, oversold, approvals] = await Promise.all([
          tx.shift.findMany({
            where: { status: "open" },
            select: {
              staffId: true,
              tillLabel: true,
              openedAt: true,
              openingFloatKobo: true,
              staff: { select: { fullName: true } },
            },
          }),
          countStockExceptions(tx, branch?.id ?? null, "low"),
          countStockExceptions(tx, branch?.id ?? null, "oversold"),
          tx.approval.count({ where: { status: "pending" } }),
        ]);

        const onShift: ShiftRow[] = openShifts.map((s) => {
          const theirs = sales.filter((sale) => sale.staffId === s.staffId);
          const total = kobo(theirs.reduce((n, x) => n + Number(x.totalKobo), 0));
          const cash = theirs.reduce(
            (n, x) =>
              n +
              x.tenders
                .filter((t) => t.method === "cash")
                .reduce((m, t) => m + Number(t.amountKobo), 0),
            0,
          );
          return {
            staffId: s.staffId,
            staffName: s.staff?.fullName ?? "",
            tillLabel: s.tillLabel,
            since: s.openedAt.toISOString(),
            sales: total,
            transactions: theirs.length,
            cashHeld: kobo(Number(s.openingFloatKobo) + cash),
          };
        });

        const attention: AttentionItem[] = [];
        if (oversold.count > 0) {
          attention.push({
            id: "oversold",
            severity: "serious",
            title: `${oversold.count} ${oversold.count === 1 ? "line is" : "lines are"} oversold`,
            detail: oversold.describe(),
            actionLabel: "Count them",
            href: "/manager/counts",
          });
        }
        if (approvals > 0) {
          attention.push({
            id: "approvals",
            severity: "warning",
            title: `${approvals} ${approvals === 1 ? "approval is" : "approvals are"} waiting`,
            detail: "A cashier cannot finish until you clear these.",
            actionLabel: "Review",
            href: "/manager/approvals",
          });
        }
        if (lowStock.count > 0) {
          attention.push({
            id: "low-stock",
            severity: "warning",
            title: `${lowStock.count} ${lowStock.count === 1 ? "line is" : "lines are"} below reorder`,
            detail: lowStock.describe(),
            actionLabel: "Reorder",
            href: "/manager/stock",
          });
        }

        return {
          branchName: branch?.name ?? "",
          asOf: to.toISOString(),
          attention,
          today: {
            sales: takings,
            transactions: sales.length,
            averageBasket: average(takings, sales.length),
            grossMarginPercent: takings.kobo
              ? percent(takings.kobo - Math.round(costOfSales), takings.kobo)
              : 0,
          },
          hourly: bucketByHour(sales),
          onShift,
          badges: {
            approvals,
            lowStock: lowStock.count,
            exceptions: oversold.count,
          },
        };
      });
    },

    /* ── The chain — SPEC §15.3 ──────────────────────────────────────────── */
    async hq(day: string): Promise<HqOverview> {
      const { from, to } = lagosDayBounds(day);
      const lastWeek = lagosDayBounds(shiftDay(day, -7));

      return db(async (tx) => {
        const branches = await tx.branch.findMany({
          where: { deletedAt: null },
          orderBy: [{ position: "asc" }, { name: "asc" }],
          select: { id: true, name: true },
        });

        const sales = await tx.sale.findMany({
          where: { at: { gte: from, lt: to }, status: "completed" },
          select: {
            at: true,
            branchId: true,
            totalKobo: true,
            lines: { select: { qtyMilli: true, productId: true } },
          },
        });

        const priorSales = await tx.sale.groupBy({
          by: ["branchId"],
          where: { at: { gte: lastWeek.from, lt: lastWeek.to }, status: "completed" },
          _sum: { totalKobo: true },
        });
        const priorByBranch = new Map(
          priorSales.map((r) => [r.branchId, Number(r._sum.totalKobo ?? 0)]),
        );

        const productIds = [
          ...new Set(sales.flatMap((s) => s.lines.map((l) => l.productId))),
        ];
        const costs = new Map(
          (
            await tx.product.findMany({
              where: { id: { in: productIds } },
              select: { id: true, costKobo: true },
            })
          ).map((p) => [p.id, Number(p.costKobo)]),
        );

        const costOf = (lines: { qtyMilli: number; productId: string }[]) =>
          lines.reduce(
            (m, l) => m + ((costs.get(l.productId) ?? 0) * l.qtyMilli) / 1000,
            0,
          );

        const perBranch: BranchPerformance[] = await Promise.all(
          branches.map(async (branch) => {
            const theirs = sales.filter((s) => s.branchId === branch.id);
            const total = theirs.reduce((n, s) => n + Number(s.totalKobo), 0);
            const cost = theirs.reduce((n, s) => n + costOf(s.lines), 0);
            const prior = priorByBranch.get(branch.id) ?? 0;

            const [low, over, pending] = await Promise.all([
              countStockExceptions(tx, branch.id, "low"),
              countStockExceptions(tx, branch.id, "oversold"),
              tx.approval.count({ where: { branchId: branch.id, status: "pending" } }),
            ]);

            return {
              id: branch.id,
              name: branch.name,
              sales: kobo(total),
              // Against the same day last week. No prior trading is not a
              // hundred-percent rise — it is no comparison at all.
              deltaPercent: prior ? Math.round(((total - prior) / prior) * 1000) / 10 : 0,
              transactions: theirs.length,
              averageBasket: average(kobo(total), theirs.length),
              marginPercent: total ? percent(total - Math.round(cost), total) : 0,
              alerts: low.count + over.count + pending,
              alertsAreSerious: over.count > 0,
            };
          }),
        );

        const chainTotal = kobo(sales.reduce((n, s) => n + Number(s.totalKobo), 0));
        const chainCost = sales.reduce((n, s) => n + costOf(s.lines), 0);

        const loyaltyIssued =
          (
            await tx.loyaltyLedger.aggregate({
              where: { at: { gte: from, lt: to }, reason: "EARN" },
              _sum: { deltaPoints: true },
            })
          )._sum.deltaPoints ?? 0;

        const attention: AttentionItem[] = [];
        const serious = perBranch.filter((b) => b.alertsAreSerious);
        if (serious.length) {
          attention.push({
            id: "chain-oversold",
            severity: "serious",
            title: `${serious.length} ${serious.length === 1 ? "branch has" : "branches have"} oversold stock`,
            detail: serious.map((b) => b.name).join(", "),
            actionLabel: "Open chain stock",
            href: "/hq/catalog",
          });
        }
        const quiet = perBranch.filter((b) => b.transactions === 0);
        if (quiet.length) {
          attention.push({
            id: "no-trading",
            severity: "warning",
            title: `${quiet.length} ${quiet.length === 1 ? "branch has" : "branches have"} not traded today`,
            detail: quiet.map((b) => b.name).join(", "),
            actionLabel: "Check devices",
            href: "/hq/devices",
          });
        }

        return {
          asOf: to.toISOString(),
          today: {
            sales: chainTotal,
            transactions: sales.length,
            averageBasket: average(chainTotal, sales.length),
            marginPercent: chainTotal.kobo
              ? percent(chainTotal.kobo - Math.round(chainCost), chainTotal.kobo)
              : 0,
            // Points are a count, but the tile is a Money tile: one point is
            // one naira of earned value at Swiftgrocers.
            loyaltyIssued: kobo(loyaltyIssued * 100),
          },
          branches: perBranch,
          attention,
          badges: {
            exceptions: perBranch.reduce((n, b) => n + (b.alertsAreSerious ? 1 : 0), 0),
            approvals: perBranch.reduce((n, b) => n + b.alerts, 0),
          },
        };
      });
    },
  };
}

/* ── Stock exceptions ─────────────────────────────────────────────────────── */

/**
 * Lines below reorder, or oversold, for one branch.
 *
 * Derived from `app.branch_stock` — the same view the stock screen reads — so
 * the badge and the screen cannot disagree (rule 3, applied to the counts as
 * well as to the balances).
 */
async function countStockExceptions(
  tx: { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> },
  branchId: string | null,
  kind: "low" | "oversold",
): Promise<{ count: number; describe: () => string }> {
  if (!branchId) return { count: 0, describe: () => "" };

  const rows = await tx.$queryRaw<
    { name: string; available_milli: bigint; reorder_level_milli: number }[]
  >`SELECT p.name, s.available_milli, p.reorder_level_milli
      FROM app.branch_stock s
      JOIN product p ON p.id = s.product_id
     WHERE s.branch_id = ${branchId}::uuid
       AND p.delisted_at IS NULL`;

  const matching = rows.filter((row) => {
    const onHand = milli(Number(row.available_milli));
    return kind === "oversold"
      ? isOversold(onHand)
      : !isOversold(onHand) && isLow(onHand, milli(row.reorder_level_milli));
  });

  return {
    count: matching.length,
    // "Peak Milk 400g (3 left), Sugar 1kg (1 left), and 5 more" — built from
    // the rows, never typed, so it cannot describe a state that is not true.
    describe: () => {
      const named = matching
        .slice(0, 2)
        .map((r) => `${r.name} (${formatQty(milli(Number(r.available_milli)))} left)`)
        .join(", ");
      const rest = matching.length - 2;
      return rest > 0 ? `${named}, and ${rest} more` : named;
    },
  };
}

/** Move an ISO day by whole days, without touching a clock. */
function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
