"use client";
import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowRight,
  CalendarCheck,
  Package,
  Receipt,
  ShoppingBasket,
} from "lucide-react";
import { AttentionList } from "@/components/shared/attention-list";
import { HourlySalesChart } from "@/components/shared/hourly-sales-chart";
import { OverviewHero } from "@/components/shared/overview-hero";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { format, formatCompact, formatWhole } from "@/lib/domain/money";
import { ZERO_QTY, formatQty } from "@/lib/domain/quantity";
import { isLow, isOversold } from "@/lib/domain/stock";
import { stockValue, useBranchData } from "@/lib/hooks/use-branch-data";
import { useSessionStore } from "@/lib/stores/session";
import { useLiveProducts } from "@/lib/data/workspace-data";
import { shortTime } from "@/lib/utils/format-date";
import type { AttentionItem, ShiftRow } from "@/types/dashboard";
import { OnShiftPanel } from "@/components/manager/on-shift-panel";
import type { HourlyBucket } from "@/components/shared/hourly-sales-chart";
/**
 * Branch manager home — SPEC §15.2.
 *
 * Every figure on this screen is now computed from the same ledger the till
 * writes to. It used to read a fixture, which meant a cashier could ring a
 * hundred sales and the manager's dashboard would not move — three workspaces
 * each holding their own version of the day.
 *
 * The exceptions are derived too, not typed: the low-stock count is the number
 * of lines actually at or below reorder right now, so the sidebar badge, the
 * exception list and the stock screen cannot disagree.
 */
export function ManagerOverviewScreen({
  isoDay,
  onShift,
}: {
  isoDay: string;
  /**
   * Who is on the tills, read on the server. A shift is opened by somebody
   * else's sign-in on somebody else's device, so the local ledger this screen
   * otherwise runs on has no way of knowing about it.
   */
  onShift: readonly ShiftRow[];
}) {
  const staff = useSessionStore((s) => s.session?.staff ?? null);
  const branchId = staff?.branchId ?? null;
  const { ready, balances, sales, today } = useBranchData(branchId, isoDay);
  const live = useLiveProducts();
  const stock = useMemo(() => {
    const low = live.filter((product) => {
      const onHand = balances.get(product.id)?.onHand ?? ZERO_QTY;
      return !isOversold(onHand) && isLow(onHand, product.reorderLevel);
    });
    const oversold = live.filter((product) =>
      isOversold(balances.get(product.id)?.onHand ?? ZERO_QTY),
    );
    return { low, oversold, value: stockValue(balances, live) };
  }, [balances, live]);
  /** Sales bucketed by the hour they were rung — the shape of the day. */
  const hourly = useMemo<HourlyBucket[]>(() => {
    const buckets = new Map<number, { total: number; transactions: number }>();
    for (const sale of sales) {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          hour12: false,
          timeZone: "Africa/Lagos",
        }).format(new Date(sale.at)),
      );
      const current = buckets.get(hour) ?? { total: 0, transactions: 0 };
      buckets.set(hour, {
        total: current.total + sale.total.kobo,
        transactions: current.transactions + 1,
      });
    }
    // A fixed 08:00–19:00 window, so the axis does not jump around as the day
    // fills in and an empty hour reads as a gap rather than being skipped.
    return Array.from({ length: 12 }, (_, index) => {
      const hour = 8 + index;
      const bucket = buckets.get(hour);
      return {
        hour,
        total: { kobo: bucket?.total ?? 0 },
        transactions: bucket?.transactions ?? 0,
      };
    });
  }, [sales]);
  const attention = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if (stock.oversold.length > 0) {
      items.push({
        id: "att_oversell",
        severity: "serious",
        title: `${stock.oversold.length} ${stock.oversold.length === 1 ? "line is" : "lines are"} oversold`,
        detail: `${stock.oversold.map((p) => p.name).slice(0, 2).join(", ")} below zero on hand`,
        actionLabel: "Review",
        href: "/manager/stock",
      });
    }
    if (stock.low.length > 0) {
      const named = stock.low
        .slice(0, 2)
        .map((product) => {
          const onHand = balances.get(product.id)?.onHand ?? ZERO_QTY;
          return `${product.name} (${formatQty(onHand)} left)`;
        })
        .join(", ");
      const rest = stock.low.length - 2;
      items.push({
        id: "att_reorder",
        severity: "warning",
        title: `${stock.low.length} products below reorder level`,
        detail: rest > 0 ? `${named}, and ${rest} more` : named,
        actionLabel: "Order",
        href: "/manager/stock",
      });
    }
    const offline = sales.filter((sale) => sale.takenOffline && !sale.syncedAt);
    if (offline.length > 0) {
      items.push({
        id: "att_offline",
        severity: "warning",
        title: `${offline.length} ${offline.length === 1 ? "sale" : "sales"} rung offline`,
        detail: "Recorded on the till and waiting to sync to the server",
        actionLabel: "Review",
        href: "/till/history",
      });
    }
    return items;
  }, [stock, balances, sales]);
  const serious = attention.filter((item) => item.severity === "serious").length;
  return (
    <main className="min-h-0 flex-1 overflow-y-auto grid min-w-0 items-start gap-5 p-5 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <OverviewHero
          eyebrow={`Today · as at ${shortTime(new Date().toISOString())}`}
          value={formatCompact(today.sales)}
          valueLabel={format(today.sales)}
          detail={
            today.transactions === 0
              ? "No sales rung yet today"
              : `${format(today.sales)} across ${today.transactions} ${today.transactions === 1 ? "sale" : "sales"}`
          }
          alert={
            serious > 0
              ? {
                  count: serious,
                  href: "#needs-you-now",
                  label: `${serious} over a limit and waiting on you`,
                }
              : undefined
          }
          action={
            <Button
              variant="secondary"
              size="till"
              className="border-transparent bg-white text-ink hover:bg-market-tint"
            >
              <CalendarCheck size={18} aria-hidden />
              Close day
            </Button>
          }
        />
        <div className="grid min-w-0 gap-5 sm:grid-cols-3">
          <Panel>
            <StatTile
              icon={Receipt}
              label="Transactions"
              value={today.transactions.toLocaleString("en-NG")}
              hint="Rung today"
            />
          </Panel>
          <Panel>
            <StatTile
              icon={ShoppingBasket}
              label="Average basket"
              value={formatWhole(today.averageBasket)}
              hint="Sales ÷ transactions"
            />
          </Panel>
          <Panel>
            <StatTile
              icon={Package}
              label="Stock value"
              value={formatWhole(stock.value)}
              hint="On hand, at cost"
            />
          </Panel>
        </div>
        <Panel id="needs-you-now" className="scroll-mt-20">
          <PanelHeader
            title="Needs you now"
            meta={
              attention.length === 0
                ? "Nothing over a limit"
                : `${attention.length} ${attention.length === 1 ? "thing" : "things"} to look at`
            }
            action={
              <Link
                href="/manager/stock"
                className="inline-flex min-h-touch-admin items-center gap-1 rounded-input px-1 font-medium text-market transition-colors duration-150 ease-out-pos hover:text-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
              >
                Stock
                <ArrowRight size={16} aria-hidden />
              </Link>
            }
          />
          <AttentionList items={attention} />
        </Panel>

        {/* Who is on the tills. Server-read: a shift is opened by somebody
            else's sign-in on another device (SPEC §11.4). */}
        <OnShiftPanel rows={onShift} />
      </div>
      <div className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-20">
        <Panel>
          <PanelHeader
            title="Sales by hour"
            meta={ready ? "Rung on this till today" : "Loading"}
          />
          <div className="pb-5">
            <HourlySalesChart buckets={hourly} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Recent sales" meta="Newest first" />
          {sales.length === 0 ? (
            <p className="px-5 py-8 text-center text-body text-ink-70">
              Nothing rung yet. Sales appear here the moment a till settles one.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {sales.slice(0, 8).map((sale) => (
                <li
                  key={sale.id}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-mono block truncate text-label tracking-normal text-ink">
                      {sale.receiptNo}
                    </span>
                    <span className="block text-label tracking-normal text-ink-40">
                      {shortTime(sale.at)} · {sale.staffName}
                    </span>
                  </span>
                  <span className="font-numeric shrink-0 font-semibold text-ink">
                    {formatWhole(sale.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </main>
  );
}
