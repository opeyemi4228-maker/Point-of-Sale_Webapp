"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Gauge,
  Percent,
  Search,
  Snail,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { CatalogFilter, Chip, ScopeControls, matchesCatalog, useCatalogFilter } from "@/components/inventory/scope-controls";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportMenu } from "@/components/ui/export-menu";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { TableScroller } from "@/components/ui/table-scroller";
import { useWorkspaceProducts } from "@/lib/data/workspace-data";
import {
  FAST_COVER_DAYS,
  SLOW_COVER_DAYS,
  classifyPerformance,
  formatCenti,
  gmroiOf,
  summariseClasses,
  type AbcClass,
  type Movement,
  type PerformanceRow,
} from "@/lib/domain/analytics";
import { daysIn, productActivity } from "@/lib/domain/inventory";
import { ZERO, formatWhole, sum } from "@/lib/domain/money";
import { formatBasisPoints, searchMaster } from "@/lib/domain/product-master";
import { formatQty } from "@/lib/domain/quantity";
import { moneyCell, qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
import { ALL_BRANCHES, useDayRange, useInventoryScope, useScopedLedger } from "@/lib/hooks/use-inventory";
import { isoDay } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";

/**
 * Product performance — SPEC §15.2 "Margin", §15.3 "Chain product performance".
 *
 * Which lines earn the money, which tie it up, and which should leave the
 * shelf. Built on the same per-product activity as the stock-and-sales report,
 * then classified (`classifyPerformance`): ABC by sales, margin, GMROI,
 * sell-through, days of cover and a movement class.
 *
 * Every class is a word as well as a badge — "A", "Dead" — never a colour
 * alone (§14).
 */

type Filter = "all" | AbcClass | "dead" | "slow" | "fast";
type SortKey = "sales" | "profit" | "margin" | "gmroi" | "sellThrough" | "cover" | "name";

const MOVEMENT_LABEL: Record<Movement, string> = {
  fast: "Fast",
  steady: "Steady",
  slow: "Slow",
  dead: "Dead",
  idle: "No stock",
};

export function PerformanceScreen({ today }: { today: string }) {
  const scope = useInventoryScope({ allowAll: true });
  const { entries, sales } = useScopedLedger(scope.branchId);
  const products = useWorkspaceProducts();
  const dates = useDayRange(today, "90d");
  const { range, setPreset } = dates;
  const [catalog, setCatalog] = useCatalogFilter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "sales", desc: true });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const pricing = useMemo(
    () => ({
      costOf: (id: string) => productById.get(id)?.cost ?? ZERO,
      priceOf: (id: string) => productById.get(id)?.price ?? ZERO,
    }),
    [productById],
  );

  // The period runs from the first movement inside it, not from the start of
  // "All time" — otherwise days of cover would be measured over months in
  // which the branch did not yet exist.
  const periodDays = useMemo(() => {
    let first = range.toDay;
    for (const e of entries) {
      const d = isoDay(e.at);
      if (d >= range.fromDay && d < first) first = d;
    }
    return daysIn(first, range.toDay).length;
  }, [entries, range]);

  const performance = useMemo(() => {
    const activity = productActivity(entries, sales, range.instants, pricing);
    const live = [...activity.values()].filter((r) => {
      const p = productById.get(r.productId);
      return p && (!p.delistedAt || r.sold.milli !== 0) && matchesCatalog(p, catalog);
    });
    return classifyPerformance(live, periodDays);
  }, [entries, sales, range.instants, pricing, productById, catalog, periodDays]);

  const totals = useMemo(() => {
    const s = sum(performance.map((r) => r.activity.salesValue));
    const gp = sum(performance.map((r) => r.activity.grossProfit));
    const dead = performance.filter((r) => r.movement === "dead");
    return {
      sales: s,
      profit: gp,
      marginBp: s.kobo > 0 ? Math.round((gp.kobo * 10_000) / s.kobo) : null,
      gmroi: gmroiOf(performance),
      dead: dead.length,
      deadValue: sum(dead.map((r) => r.activity.closingValue)),
      slow: performance.filter((r) => r.movement === "slow").length,
      fast: performance.filter((r) => r.movement === "fast").length,
      classes: summariseClasses(performance),
      stock: sum(performance.map((r) => r.activity.closingValue)),
    };
  }, [performance]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; rows: PerformanceRow[] }>();
    for (const r of performance) {
      const p = productById.get(r.productId)!;
      const c = map.get(p.categoryId) ?? { name: p.categoryName, rows: [] };
      c.rows.push(r);
      map.set(p.categoryId, c);
    }
    return [...map.values()]
      .map((c) => {
        const s = sum(c.rows.map((r) => r.activity.salesValue));
        const gp = sum(c.rows.map((r) => r.activity.grossProfit));
        return { name: c.name, sales: s, profit: gp, marginBp: s.kobo > 0 ? Math.round((gp.kobo * 10_000) / s.kobo) : null, gmroi: gmroiOf(c.rows), lines: c.rows.length };
      })
      .sort((a, b) => b.sales.kobo - a.sales.kobo);
  }, [performance, productById]);

  const rows = useMemo(() => {
    const ids = new Set(searchMaster(products, query).map((p) => p.id));
    const list = performance
      .filter((r) => ids.has(r.productId))
      .filter((r) =>
        filter === "all" ? true
        : filter === "A" || filter === "B" || filter === "C" ? r.abc === filter
        : r.movement === filter,
      )
      .map((r) => ({ r, product: productById.get(r.productId)! }));
    const val = ({ r, product }: (typeof list)[number]): number | string => {
      switch (sort.key) {
        case "sales": return r.activity.salesValue.kobo;
        case "profit": return r.activity.grossProfit.kobo;
        case "margin": return r.marginBp ?? -Infinity;
        case "gmroi": return r.gmroiCenti ?? -Infinity;
        case "sellThrough": return r.sellThroughBp ?? -Infinity;
        case "cover": return r.coverDays ?? (r.movement === "dead" ? Infinity : -Infinity);
        case "name": return product.name;
      }
    };
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "string" ? x.localeCompare(String(y)) : x === y ? 0 : x < (y as number) ? -1 : 1;
      return c * dir || a.product.name.localeCompare(b.product.name);
    });
  }, [performance, products, query, filter, sort, productById]);

  const scopeName = scope.branchId === ALL_BRANCHES ? "All branches" : (scope.branch?.name ?? "Branch");
  const noSales = totals.sales.kobo === 0;
  const maxCategory = Math.max(1, ...byCategory.map((c) => c.sales.kobo));

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));
  }

  const buildReport = (): ReportSpec => ({
    title: "Product performance",
    subtitle: `${scopeName} · ABC, margin, GMROI and stock movement`,
    filename: reportFilename("product-performance", scope.branch?.code ?? "chain", range.fromDay, range.toDay),
    orientation: "landscape",
    meta: [
      { label: "Scope", value: scopeName },
      { label: "Period", value: `${range.label} · ${range.fromDay} to ${range.toDay}` },
      { label: "Trading days", value: String(periodDays) },
      { label: "Showing", value: { all: "All lines", A: "Class A", B: "Class B", C: "Class C", dead: "Dead stock", slow: "Slow movers", fast: "Fast movers" }[filter] },
    ],
    summary: [
      { label: "Sales", value: formatWhole(totals.sales), hint: `${performance.length} lines` },
      { label: "Gross profit", value: formatWhole(totals.profit), hint: `Margin ${formatBasisPoints(totals.marginBp)}` },
      { label: "GMROI", value: formatCenti(totals.gmroi), hint: "Profit per ₦1 of stock" },
      { label: "Dead stock", value: formatWhole(totals.deadValue), hint: `${totals.dead} lines, no sales` },
    ],
    tables: [
      {
        heading: "ABC classes",
        note: "A: the lines making the first 80% of sales. B: the next 15%. C: the rest.",
        columns: [
          { header: "Class", width: 10 },
          { header: "Lines", align: "right", width: 10 },
          { header: "Sales", align: "right", width: 18 },
          { header: "Share", align: "right", width: 10 },
          { header: "Gross profit", align: "right", width: 18 },
          { header: "Stock at close", align: "right", width: 18 },
        ],
        rows: (["A", "B", "C"] as const).map((k) => {
          const c = totals.classes[k];
          return [
            k,
            String(c.lines),
            moneyCell(c.sales),
            formatBasisPoints(totals.sales.kobo ? Math.round((c.sales.kobo * 10_000) / totals.sales.kobo) : null),
            moneyCell(c.grossProfit),
            moneyCell(c.stock),
          ];
        }),
      },
      {
        heading: "By category",
        columns: [
          { header: "Category", width: 26 },
          { header: "Lines", align: "right", width: 8 },
          { header: "Sales", align: "right", width: 16 },
          { header: "Gross profit", align: "right", width: 16 },
          { header: "Margin", align: "right", width: 10 },
          { header: "GMROI", align: "right", width: 10 },
        ],
        rows: byCategory.map((c) => [c.name, String(c.lines), moneyCell(c.sales), moneyCell(c.profit), formatBasisPoints(c.marginBp), formatCenti(c.gmroi)]),
      },
      {
        heading: "Lines",
        columns: [
          { header: "Part no.", mono: true, width: 8 },
          { header: "Product", width: 20 },
          { header: "Class", width: 5 },
          { header: "Sold", align: "right", width: 7 },
          { header: "Sales", align: "right", width: 9 },
          { header: "Gross profit", align: "right", width: 9 },
          { header: "Margin", align: "right", width: 6 },
          { header: "GMROI", align: "right", width: 6 },
          { header: "Sell-through", align: "right", width: 7 },
          { header: "On hand", align: "right", width: 7 },
          { header: "Cover", align: "right", width: 6 },
          { header: "Movement", width: 7 },
        ],
        rows: rows.map(({ r, product }) => [
          product.sku,
          product.name,
          r.abc,
          qtyCell(r.activity.sold, product.unit),
          moneyCell(r.activity.salesValue),
          moneyCell(r.activity.grossProfit),
          formatBasisPoints(r.marginBp),
          { text: formatCenti(r.gmroiCenti), raw: r.gmroiCenti === null ? "" : r.gmroiCenti / 100, tone: r.gmroiCenti !== null && r.gmroiCenti < 100 ? "signal" : undefined },
          formatBasisPoints(r.sellThroughBp),
          qtyCell(r.activity.closing),
          { text: r.coverDays === null ? "—" : `${r.coverDays} d`, raw: r.coverDays ?? "" },
          { text: MOVEMENT_LABEL[r.movement], tone: r.movement === "dead" ? "halt" : r.movement === "slow" ? "signal" : r.movement === "fast" ? "market" : undefined },
        ]),
        empty: "No lines match this selection.",
      },
    ],
    footnote: `GMROI = gross profit ÷ average stock at cost ((opening + closing) ÷ 2). Sell-through = sold ÷ (sold + on hand). Cover = on hand ÷ average daily sales over ${periodDays} trading days. Fast ≤ ${FAST_COVER_DAYS} days, slow > ${SLOW_COVER_DAYS} days. Sales are from receipts where recorded, otherwise shelf price.`,
  });

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-400 flex-col gap-5 p-4 sm:p-5">
        <ScopeControls scope={scope} allowAll dates={dates}>
          <div className="ml-auto">
            <ExportMenu build={buildReport} />
          </div>
        </ScopeControls>
        <CatalogFilter products={products} value={catalog} onChange={setCatalog} />

        {noSales ? (
          <Panel>
            <EmptyState
              icon={TrendingUp}
              title={`No sales in ${range.label.toLowerCase()}`}
              detail="Performance is measured from what sold. Widen the period to see how every line has traded."
              action={range.preset !== "all" ? <Button onClick={() => setPreset("all")}>Show all time</Button> : undefined}
            />
          </Panel>
        ) : (
          <>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Panel><StatTile icon={Wallet} label="Sales" value={formatWhole(totals.sales)} hint={`${range.label} · ${periodDays} trading days`} /></Panel>
              <Panel><StatTile icon={Percent} label="Gross profit" value={formatWhole(totals.profit)} hint={`${formatBasisPoints(totals.marginBp)} margin`} /></Panel>
              <Panel><StatTile icon={Gauge} label="GMROI" value={formatCenti(totals.gmroi)} hint="Gross profit per ₦1 of stock held" /></Panel>
              <Panel><StatTile icon={Snail} label="Dead stock" value={formatWhole(totals.deadValue)} hint={`${totals.dead} lines with stock and no sales`} /></Panel>
            </div>

            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              {/* ABC */}
              <Panel>
                <PanelHeader title="ABC classes" meta="Where the money comes from — and where the stock sits" />
                <ul className="divide-y divide-line">
                  {(["A", "B", "C"] as const).map((k) => {
                    const c = totals.classes[k];
                    const share = totals.sales.kobo ? Math.round((c.sales.kobo * 100) / totals.sales.kobo) : 0;
                    const stockShare = totals.stock.kobo ? Math.round((c.stock.kobo * 100) / totals.stock.kobo) : 0;
                    return (
                      <li key={k}>
                        <button
                          type="button"
                          onClick={() => setFilter(filter === k ? "all" : k)}
                          aria-pressed={filter === k}
                          className={cn(
                            "flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-150 hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-market",
                            filter === k && "bg-market-tint",
                          )}
                        >
                          <AbcBadge abc={k} large />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-ink">
                              {c.lines} {c.lines === 1 ? "line" : "lines"} · {share}% of sales
                            </span>
                            <span className="block text-body text-ink-70">
                              {formatWhole(c.sales)} sales · {stockShare}% of stock held
                            </span>
                          </span>
                          <span className="hidden text-right text-body text-ink-40 sm:block">
                            {k === "A" ? "Never out of stock" : k === "B" ? "Keep steady" : "Review the range"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Panel>

              {/* Categories — one series, one hue, values in ink. */}
              <Panel>
                <PanelHeader title="Sales by category" meta="Bar is sales; margin and GMROI beside it" />
                <ul className="flex flex-col gap-3.5 p-5">
                  {byCategory.map((c) => (
                    <li
                      key={c.name}
                      className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
                      title={`${c.name}: ${formatWhole(c.sales)} sales, ${formatWhole(c.profit)} gross profit, ${formatBasisPoints(c.marginBp)} margin, GMROI ${formatCenti(c.gmroi)}`}
                    >
                      <span className="truncate text-body text-ink-70">{c.name}</span>
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="h-3 rounded-r-sm bg-market" style={{ width: `${Math.max(2, (c.sales.kobo / maxCategory) * 100)}%` }} />
                        <span className="font-numeric text-body font-medium whitespace-nowrap text-ink">{formatWhole(c.sales)}</span>
                      </span>
                      <span className="col-start-2 font-numeric text-body text-ink-40 sm:col-start-auto sm:text-right">
                        {formatBasisPoints(c.marginBp)} · {formatCenti(c.gmroi)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            <Panel>
              <PanelHeader title="Every line" meta={`Press a column to sort · fast ≤ ${FAST_COVER_DAYS} days of cover, slow > ${SLOW_COVER_DAYS}`} />
              <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center">
                <div className="relative flex-1">
                  <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-40" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by name, part number or barcode"
                    aria-label="Search lines"
                    className="min-h-touch-admin w-full rounded-input border border-line bg-surface pr-4 pl-10 text-body text-ink placeholder:text-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
                  />
                </div>
                <div role="group" aria-label="Filter lines" className="flex flex-wrap gap-1.5">
                  <Chip active={filter === "all"} onClick={() => setFilter("all")} count={performance.length}>All</Chip>
                  <Chip active={filter === "fast"} onClick={() => setFilter("fast")} count={totals.fast}>
                    <Zap size={15} aria-hidden /> Fast
                  </Chip>
                  <Chip active={filter === "slow"} onClick={() => setFilter("slow")} count={totals.slow}>Slow</Chip>
                  <Chip active={filter === "dead"} onClick={() => setFilter("dead")} count={totals.dead}>Dead</Chip>
                </div>
              </div>
              <TableScroller>
                <table className="w-full min-w-230 text-left">
                  <thead>
                    <tr className="border-b border-line bg-paper text-label uppercase text-ink-40">
                      <Th label="Product" k="name" sort={sort} onSort={toggleSort} className="pl-5" />
                      <th scope="col" className="px-3 py-3 font-semibold">Class</th>
                      <Th label="Sales" k="sales" sort={sort} onSort={toggleSort} right />
                      <Th label="Gross profit" k="profit" sort={sort} onSort={toggleSort} right />
                      <Th label="Margin" k="margin" sort={sort} onSort={toggleSort} right />
                      <Th label="GMROI" k="gmroi" sort={sort} onSort={toggleSort} right />
                      <Th label="Sell-thru" k="sellThrough" sort={sort} onSort={toggleSort} right />
                      <Th label="Cover" k="cover" sort={sort} onSort={toggleSort} right />
                      <th scope="col" className="py-3 pr-5 pl-3 font-semibold">Movement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map(({ r, product }) => (
                      <tr key={r.productId} className="hover:bg-paper">
                        <th scope="row" className="max-w-60 py-3 pr-3 pl-5 font-normal">
                          <span className="block truncate font-medium text-ink">{product.name}</span>
                          <span className="block text-body text-ink-40">
                            <span className="font-mono text-mono">{product.sku}</span> · {formatQty(r.activity.sold)} {product.unit} sold
                          </span>
                        </th>
                        <td className="px-3 py-3"><AbcBadge abc={r.abc} /></td>
                        <td className="px-3 py-3 text-right font-numeric font-semibold text-ink">{formatWhole(r.activity.salesValue)}</td>
                        <td className={cn("px-3 py-3 text-right font-numeric", r.activity.grossProfit.kobo < 0 ? "text-halt" : "text-ink-70")}>{formatWhole(r.activity.grossProfit)}</td>
                        <td className="px-3 py-3 text-right font-numeric text-ink-70">{formatBasisPoints(r.marginBp)}</td>
                        <td className="px-3 py-3 text-right font-numeric whitespace-nowrap">
                          <span className={r.gmroiCenti !== null && r.gmroiCenti < 100 ? "font-semibold text-signal" : "text-ink-70"}>{formatCenti(r.gmroiCenti)}</span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <SellThrough bp={r.sellThroughBp} />
                        </td>
                        <td className="px-3 py-3 text-right font-numeric whitespace-nowrap text-ink-70">
                          {r.coverDays === null ? "—" : `${r.coverDays} d`}
                        </td>
                        <td className="py-3 pr-5 pl-3"><MovementTag movement={r.movement} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroller>
              {rows.length === 0 && <p className="px-5 py-8 text-center text-body text-ink-70">No line matches.</p>}
            </Panel>
          </>
        )}
      </div>
    </main>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function AbcBadge({ abc, large }: { abc: AbcClass; large?: boolean }) {
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-input font-display font-bold",
        large ? "size-11 text-title" : "size-8 text-body",
        abc === "A" ? "bg-market text-white" : abc === "B" ? "bg-market-tint text-market" : "bg-paper text-ink-70 ring-1 ring-line",
      )}
      aria-label={`Class ${abc}`}
    >
      {abc}
    </span>
  );
}

function MovementTag({ movement }: { movement: Movement }) {
  const shape = {
    fast: { icon: Zap, cls: "bg-market-tint text-market" },
    steady: { icon: TrendingUp, cls: "bg-paper text-ink-70" },
    slow: { icon: Snail, cls: "bg-sun text-ink" },
    dead: { icon: Snail, cls: "bg-halt-tint text-halt" },
    idle: { icon: TrendingUp, cls: "bg-paper text-ink-40" },
  }[movement];
  const Icon = shape.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-label font-semibold tracking-normal whitespace-nowrap", shape.cls)}>
      <Icon size={14} aria-hidden />
      {MOVEMENT_LABEL[movement]}
    </span>
  );
}

function SellThrough({ bp }: { bp: number | null }) {
  if (bp === null) return <span className="text-ink-40">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden className="hidden h-1.5 w-10 overflow-hidden rounded-pill bg-line 2xl:block">
        <span className="block h-full rounded-pill bg-market" style={{ width: `${bp / 100}%` }} />
      </span>
      <span className="w-12 font-numeric text-ink-70">{formatBasisPoints(bp)}</span>
    </span>
  );
}

function Th({
  label,
  k,
  sort,
  onSort,
  right,
  className,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  right?: boolean;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
  return (
    <th scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} className={cn("px-3 py-1 font-semibold", right && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex min-h-touch-admin items-center gap-1 whitespace-nowrap uppercase hover:text-ink focus-visible:outline-2 focus-visible:outline-market",
          active && "text-ink",
          right && "flex-row-reverse",
        )}
      >
        {label}
        <Icon size={13} aria-hidden className={active ? "text-market" : "opacity-50"} />
      </button>
    </th>
  );
}

