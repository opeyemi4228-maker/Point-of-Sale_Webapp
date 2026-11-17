"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  PackagePlus,
  Search,
  SlidersHorizontal,
  Tags,
  TriangleAlert,
  X,
} from "lucide-react";
import { AdjustStockSheet } from "@/components/inventory/adjust-stock-sheet";
import {
  ReceiveDeliveryPanel,
  useDeliveryDraft,
} from "@/components/inventory/receive-delivery-panel";
import { Chip, ScopeControls } from "@/components/inventory/scope-controls";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "@/components/ui/export-menu";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TableScroller } from "@/components/ui/table-scroller";
import { balancesAsAt, batchesOnHand, productActivity } from "@/lib/domain/inventory";
import { formatWhole, multiply, sum, type Money } from "@/lib/domain/money";
import { searchMaster } from "@/lib/domain/product-master";
import { ZERO_QTY, addQty, formatQty, toNumber, type Quantity } from "@/lib/domain/quantity";
import { balancesForBranch, isLow, isOversold } from "@/lib/domain/stock";
import { moneyCell, qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
import { useCostOf, useDayRange, useInventoryScope, useScopedLedger } from "@/lib/hooks/use-inventory";
import { shortDate } from "@/lib/utils/format-date";
import type { Product } from "@/types/catalog";
import type { StockSource } from "@/types/stock";
import { cn } from "@/lib/utils/cn";

/**
 * Branch stock — SPEC §10, §15.2.
 *
 * Three jobs on one screen: see what is on hand, put more of it in, and take
 * it out when it is spoiled, broken or miscounted. They belong together because
 * they are one loop — a manager checks a line, finds it short or past its date,
 * and fixes it without navigating anywhere.
 *
 * The table owns the width. Receiving opens as a drawer over it rather than
 * sitting in a permanent side column: the column squeezed the table until
 * product names wrapped over three lines and the row actions fell off the
 * edge, to keep a form on screen that is used a few times a day. The draft
 * survives closing the drawer, and the header button says how many lines are
 * waiting in it, so nothing is lost by putting it away.
 *
 * **Every figure here is derived.** There is no editable quantity on this
 * screen and no code path that sets one. Receiving appends `PURCHASE_RECEIPT`
 * movements; adjusting appends one movement with a reason. Balances recompute
 * from the ledger (CLAUDE.md rule 3).
 */

type StateFilter = "all" | "attention" | "oversold" | "expired" | "low" | "ok";
type SortKey = "name" | "onHand" | "value" | "moved" | "in" | "out";
type Sort = { key: SortKey; dir: 1 | -1 };

type Row = {
  product: Product;
  /** Current on-hand — what the state flags are judged on. */
  current: Quantity;
  /** On hand at the close of the selected period; current when it ends today. */
  onHand: Quantity;
  /** Into the shelf during the period: deliveries and transfers in. */
  inbound: Quantity;
  /** Out of it: sales, write-offs and transfers out. Positive. */
  outbound: Quantity;
  lastMovedAt: string | null;
  low: boolean;
  oversold: boolean;
  expired: boolean;
  value: Money;
  state: Exclude<StateFilter, "all" | "attention">;
};

export function StockScreen({
  products,
  isoDay,
}: {
  products: Product[];
  isoDay: string;
}) {
  // Who is acting and in which branch comes from the session. HQ, who has no
  // branch, picks one — stock always moves in a branch.
  const scope = useInventoryScope({ allowAll: false });
  const { staff, branch } = scope;
  const branchId = branch?.id ?? null;

  const { entries, sales } = useScopedLedger(branchId ?? "none");
  const balances = useMemo(
    () => (branchId ? balancesForBranch(entries, branchId) : new Map()),
    [entries, branchId],
  );

  // The period. Stock *state* (reorder, oversold, expired) is always judged on
  // today's shelf — a line that was low last month is not a problem now — but
  // the on-hand figure, its value and the in/out columns follow the period.
  const dates = useDayRange(isoDay, "all");
  const { range } = dates;
  const historic = range.toDay !== isoDay;
  const costOf = useCostOf(products);
  const priceOf = useMemo(() => {
    const prices = new Map(products.map((p) => [p.id, p.price]));
    return (id: string) => prices.get(id) ?? { kobo: 0 };
  }, [products]);
  const asAt = useMemo(
    () => (branchId && historic ? balancesAsAt(entries, branchId, range.instants.to) : balances),
    [branchId, historic, entries, range.instants.to, balances],
  );
  const activity = useMemo(
    () => productActivity(entries, sales, range.instants, { costOf, priceOf }),
    [entries, sales, range.instants, costOf, priceOf],
  );

  const draft = useDeliveryDraft();
  const [receiving, setReceiving] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StateFilter>("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<Sort | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Lines with stock at or past its date, so the table can flag them.
  const expiredLines = useMemo(() => {
    const ids = new Set<string>();
    for (const batch of batchesOnHand(entries, { today: isoDay, soonDays: 7 })) {
      if (batch.status === "expired") ids.add(batch.productId);
    }
    return ids;
  }, [entries, isoDay]);

  const knownSources = useMemo(() => {
    const seen = new Map<string, StockSource>();
    for (const e of entries) if (e.source) seen.set(`${e.source.kind}|${e.source.name}`, e.source);
    return [...seen.values()];
  }, [entries]);

  const live = useMemo(() => products.filter((p) => !p.delistedAt), [products]);

  /** Every live line with its derived state — the one list everything else filters. */
  const all = useMemo<Row[]>(
    () =>
      live.map((product) => {
        const current: Quantity = balances.get(product.id)?.onHand ?? ZERO_QTY;
        const then = asAt.get(product.id);
        const onHand: Quantity = then?.onHand ?? ZERO_QTY;
        const act = activity.get(product.id);
        const transfers = act?.transfers.milli ?? 0;
        const oversold = isOversold(current);
        const expired = expiredLines.has(product.id);
        const low = isLow(current, product.reorderLevel);
        return {
          product,
          current,
          onHand,
          inbound: addQty(act?.purchased ?? ZERO_QTY, { milli: Math.max(0, transfers) }),
          outbound: addQty(addQty(act?.sold ?? ZERO_QTY, act?.wasted ?? ZERO_QTY), { milli: Math.max(0, -transfers) }),
          lastMovedAt: then?.lastMovedAt ?? null,
          low,
          oversold,
          expired,
          value: multiply(product.cost, toNumber(onHand)),
          state: oversold ? "oversold" : expired ? "expired" : low ? "low" : "ok",
        };
      }),
    [live, balances, asAt, activity, expiredLines],
  );

  const counts = useMemo(() => {
    const by = (s: Row["state"]) => all.filter((r) => r.state === s).length;
    return {
      all: all.length,
      oversold: by("oversold"),
      expired: by("expired"),
      low: by("low"),
      ok: by("ok"),
      attention: all.filter((r) => r.state !== "ok").length,
      value: sum(all.map((r) => r.value)),
      units: all.reduce((n, r) => n + Math.max(0, r.onHand.milli), 0),
      inbound: all.reduce((n, r) => n + r.inbound.milli, 0),
      outbound: all.reduce((n, r) => n + r.outbound.milli, 0),
    };
  }, [all]);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of live) seen.set(p.categoryId, p.categoryName);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [live]);

  const rows = useMemo(() => {
    const ids = new Set(searchMaster(live, query).map((p) => p.id));
    const shown = all.filter(
      (r) =>
        ids.has(r.product.id) &&
        (category === "all" || r.product.categoryId === category) &&
        (filter === "all" || (filter === "attention" ? r.state !== "ok" : r.state === filter)),
    );

    const rank = { oversold: 0, expired: 1, low: 2, ok: 3 } as const;
    return shown.sort((a, b) => {
      if (sort) {
        const x =
          sort.key === "name" ? a.product.name.localeCompare(b.product.name)
          : sort.key === "onHand" ? a.onHand.milli - b.onHand.milli
          : sort.key === "value" ? a.value.kobo - b.value.kobo
          : sort.key === "in" ? a.inbound.milli - b.inbound.milli
          : sort.key === "out" ? a.outbound.milli - b.outbound.milli
          : (a.lastMovedAt ?? "").localeCompare(b.lastMovedAt ?? "");
        if (x !== 0) return x * sort.dir;
      }
      // Default: problems first — oversold, expired on the shelf, low — then by name.
      return rank[a.state] - rank[b.state] || a.product.name.localeCompare(b.product.name);
    });
  }, [all, live, query, category, filter, sort]);

  const shownValue = useMemo(() => sum(rows.map((r) => r.value)), [rows]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s?.key === key
        ? s.dir === (key === "name" ? 1 : -1)
          ? { key, dir: key === "name" ? -1 : 1 }
          : null // third press returns to "problems first"
        : { key, dir: key === "name" ? 1 : -1 },
    );
  }

  function receive(product: Product) {
    setNotice(null);
    draft.add(product);
    setReceiving(true);
  }

  const buildReport = (): ReportSpec => {
    const label = {
      all: "All lines",
      attention: "Lines needing attention",
      oversold: "Oversold lines",
      expired: "Lines with expired stock",
      low: "Lines at or below reorder",
      ok: "Lines in stock",
    }[filter];
    const categoryName = categories.find(([id]) => id === category)?.[1];
    return {
      title: "Stock on hand",
      subtitle: `${branch?.name ?? "Branch"} · ${historic ? `as at close of ${range.toDay}` : "now"} · valued at catalog cost`,
      filename: reportFilename("stock-on-hand", branch?.code, historic ? range.toDay : isoDay),
      orientation: "landscape",
      meta: [
        { label: "Branch", value: branch?.name ?? "—" },
        { label: "Period", value: `${range.label} · ${range.fromDay} to ${range.toDay}` },
        { label: "On hand as at", value: historic ? `Close of ${range.toDay}` : `Now (${isoDay})` },
        { label: "Showing", value: [label, categoryName, query.trim() ? `matching “${query.trim()}”` : null].filter(Boolean).join(" · ") },
        { label: "Lines", value: `${rows.length} of ${counts.all}` },
      ],
      summary: [
        { label: "Stock value", value: formatWhole(counts.value), hint: "All lines, at cost" },
        { label: "Below reorder", value: String(counts.low), hint: `of ${counts.all} lines` },
        { label: "Expired on shelf", value: String(counts.expired), hint: "Lines to write off" },
        { label: "Oversold", value: String(counts.oversold), hint: "Below zero on hand" },
      ],
      tables: [
        {
          columns: [
            { header: "Part no.", mono: true, width: 9 },
            { header: "Product", width: 26 },
            { header: "Category", width: 12 },
            { header: "State now", width: 11 },
            { header: "In", align: "right", width: 7 },
            { header: "Out", align: "right", width: 7 },
            { header: historic ? `On hand ${range.toDay}` : "On hand", align: "right", width: 9 },
            { header: "Unit", width: 5 },
            { header: "Reorder at", align: "right", width: 8 },
            { header: "Unit cost", align: "right", width: 9 },
            { header: "Value", align: "right", width: 11 },
          ],
          rows: rows.map((r) => [
            r.product.sku,
            r.product.name,
            r.product.categoryName,
            STATE_LABEL[r.state].pdf,
            qtyCell(r.inbound),
            qtyCell(r.outbound),
            qtyCell(r.onHand),
            r.product.unit,
            qtyCell(r.product.reorderLevel),
            moneyCell(r.product.cost),
            moneyCell(r.value),
          ]),
          totals: ["", `${rows.length} lines`, "", "", "", "", "", "", "", "", moneyCell(shownValue, { bold: true })],
          empty: "No lines match this selection.",
        },
      ],
      footnote:
        "On hand is the sum of every movement in the stock ledger for this branch; nothing on this sheet was typed in. Negative figures are sales recorded ahead of a delivery and are shown, never hidden.",
    };
  };

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-400 flex-col gap-5 p-4 sm:p-5">
        {/* Toolbar: scope on the left, the screen's two actions on the right. */}
        <div className="flex flex-wrap items-center gap-3">
          <ScopeControls scope={scope} allowAll={false} dates={dates} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ExportMenu build={buildReport} disabled={!branchId} />
            <Button onClick={() => setReceiving(true)} disabled={!branchId || !staff}>
              <PackagePlus size={18} aria-hidden />
              Receive delivery
              {draft.lines.length > 0 && (
                <span className="rounded-pill bg-white/20 px-2 font-numeric text-label tracking-normal">
                  {draft.lines.length} in draft
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Headline figures. The three counts are also the quickest filters. */}
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Tile
            icon={Banknote}
            label={historic ? `Value at ${shortDate(range.toDay)}` : "Stock value"}
            value={formatWhole(counts.value)}
            hint={historic ? `${counts.all} lines at close, at cost` : `${counts.all} lines at cost`}
          />
          <Tile
            icon={TriangleAlert}
            tone="signal"
            label="Below reorder"
            value={String(counts.low)}
            hint={`of ${counts.all} lines`}
            active={filter === "low"}
            onClick={() => setFilter(filter === "low" ? "all" : "low")}
          />
          <Tile
            icon={CalendarClock}
            tone="halt"
            label="Expired on shelf"
            value={String(counts.expired)}
            hint="Lines to write off"
            active={filter === "expired"}
            onClick={() => setFilter(filter === "expired" ? "all" : "expired")}
          />
          <Tile
            icon={CircleAlert}
            tone="halt"
            label="Oversold"
            value={String(counts.oversold)}
            hint="Below zero on hand"
            active={filter === "oversold"}
            onClick={() => setFilter(filter === "oversold" ? "all" : "oversold")}
          />
        </div>

        {notice && (
          <Alert tone="market" className="items-center">
            <span className="flex-1">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="grid size-touch-admin shrink-0 place-items-center rounded-input text-ink-70 hover:bg-surface"
            >
              <X size={18} />
            </button>
          </Alert>
        )}

        <Panel>
          <PanelHeader
            title="Stock on hand"
            meta="Derived from the ledger — never edited directly. Correct a figure by receiving or adjusting."
          />

          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative flex-1">
                <Search
                  size={18}
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-40"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name, part number or barcode"
                  aria-label="Search stock"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-h-touch-admin w-full rounded-input border border-line bg-surface pr-4 pl-10 text-body text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
                />
              </div>
              <label className="flex items-center gap-2">
                <Tags size={18} aria-hidden className="text-ink-40" />
                <span className="sr-only">Category</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="min-h-touch-admin w-full rounded-input border border-line bg-surface px-3 pr-8 text-body font-medium text-ink transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:outline-2 focus:outline-offset-0 focus:outline-market md:w-auto"
                >
                  <option value="all">All categories</option>
                  {categories.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div role="group" aria-label="Filter by state" className="flex flex-wrap gap-1.5">
              <Chip active={filter === "all"} onClick={() => setFilter("all")} count={counts.all}>All</Chip>
              <Chip active={filter === "attention"} onClick={() => setFilter("attention")} count={counts.attention}>Needs attention</Chip>
              <Chip active={filter === "low"} onClick={() => setFilter("low")} count={counts.low}>Reorder</Chip>
              <Chip active={filter === "expired"} onClick={() => setFilter("expired")} count={counts.expired}>Expired</Chip>
              <Chip active={filter === "oversold"} onClick={() => setFilter("oversold")} count={counts.oversold}>Oversold</Chip>
              <Chip active={filter === "ok"} onClick={() => setFilter("ok")} count={counts.ok}>In stock</Chip>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <CircleCheck size={28} aria-hidden className="text-market" />
              <p className="text-body-lg font-medium text-ink">
                {filter !== "all" && !query ? "Nothing in this state" : "Nothing matches"}
              </p>
              <p className="max-w-md text-body text-ink-70">
                {filter !== "all" && !query
                  ? "Good news — no line is in that state right now."
                  : "Try part of the name, the part number (SG-0112) or the full barcode."}
              </p>
            </div>
          ) : (
            <TableScroller>
              <table className="w-full min-w-220 text-left">
                <thead>
                  <tr className="border-b border-line bg-paper text-label uppercase text-ink-40">
                    <SortHeader label="Product" k="name" sort={sort} onSort={toggleSort} className="pl-5" />
                    <th scope="col" className="px-3 py-3 font-semibold">State</th>
                    <SortHeader label="In" k="in" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Out" k="out" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label={historic ? `At ${shortDate(range.toDay)}` : "On hand"} k="onHand" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Value" k="value" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Moved" k="moved" sort={sort} onSort={toggleSort} align="right" />
                    <th scope="col" className="py-3 pr-4 pl-3 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => (
                    <tr key={row.product.id} className="group transition-colors duration-150 hover:bg-paper">
                      <th scope="row" className="max-w-88 py-3 pr-3 pl-5 font-normal">
                        <span className="block truncate font-medium text-ink" title={row.product.name}>
                          {row.product.name}
                        </span>
                        <span className="flex items-center gap-1.5 text-body text-ink-40">
                          <span className="font-mono text-mono">{row.product.sku}</span>
                          <span aria-hidden>·</span>
                          <span className="truncate">{row.product.categoryName}</span>
                        </span>
                      </th>
                      <td className="px-3 py-3">
                        <StockState state={row.state} />
                      </td>
                      <td className="px-3 py-3 text-right font-numeric whitespace-nowrap">
                        {row.inbound.milli ? (
                          <span className="text-market">+{formatQty(row.inbound)}</span>
                        ) : (
                          <span className="text-ink-40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-numeric whitespace-nowrap">
                        {row.outbound.milli ? (
                          <span className="text-ink-70">−{formatQty(row.outbound)}</span>
                        ) : (
                          <span className="text-ink-40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <span
                          className={cn(
                            "font-numeric text-body-lg font-semibold",
                            row.onHand.milli < 0 ? "text-halt" : "text-ink",
                          )}
                        >
                          {formatQty(row.onHand)}
                        </span>
                        <span className="ml-1 text-ink-40">{row.product.unit}</span>
                        <LevelBar onHand={row.current} reorderLevel={row.product.reorderLevel} state={row.state} />
                        <span className="mt-0.5 block text-body text-ink-40">
                          {historic ? `${formatQty(row.current)} now · ` : ""}reorder {formatQty(row.product.reorderLevel)}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right font-numeric font-medium whitespace-nowrap",
                          row.value.kobo < 0 ? "text-halt" : "text-ink",
                        )}
                      >
                        {formatWhole(row.value)}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-ink-70">
                        {row.lastMovedAt ? shortDate(row.lastMovedAt) : "—"}
                      </td>
                      <td className="py-2 pr-4 pl-3">
                        <div className="flex justify-end gap-1.5">
                          <RowAction
                            onClick={() => receive(row.product)}
                            icon={PackagePlus}
                            label="Receive"
                            product={row.product.name}
                            disabled={!branchId || !staff}
                            primary
                          />
                          <RowAction
                            onClick={() => setAdjusting(row.product)}
                            icon={SlidersHorizontal}
                            label="Adjust"
                            product={row.product.name}
                            disabled={!branchId || !staff}
                            iconOnly
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroller>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-paper px-5 py-3 text-body">
            <span className="text-ink-70">
              Showing {rows.length} of {counts.all} lines
            </span>
            <span className="text-ink-70">
              Value shown{" "}
              <span className="font-numeric font-semibold text-ink">{formatWhole(shownValue)}</span>
            </span>
          </div>
        </Panel>
      </div>

      {receiving && staff && branch && (
        <Drawer label="Receive a delivery" onClose={() => setReceiving(false)}>
          <ReceiveDeliveryPanel
            draft={draft}
            products={products}
            branchId={branch.id}
            branchCode={branch.code}
            staff={staff}
            today={isoDay}
            knownSources={knownSources}
            onReceived={(ref) => {
              setReceiving(false);
              setNotice(`${ref} received. Balances on this screen are updated.`);
            }}
          />
        </Drawer>
      )}

      {adjusting && staff && branch && (
        <AdjustStockSheet
          product={adjusting}
          branchId={branch.id}
          branchCode={branch.code}
          onHand={balances.get(adjusting.id)?.onHand ?? ZERO_QTY}
          staff={staff}
          onClose={() => setAdjusting(null)}
          onDone={(message) => {
            setAdjusting(null);
            setNotice(message);
          }}
        />
      )}
    </main>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

const STATE_LABEL: Record<Row["state"], { label: string; pdf: { text: string; tone?: "halt" | "signal" | "market" } }> = {
  oversold: { label: "Oversold", pdf: { text: "Oversold", tone: "halt" } },
  expired: { label: "Expired stock", pdf: { text: "Expired stock", tone: "halt" } },
  low: { label: "Reorder", pdf: { text: "Reorder", tone: "signal" } },
  ok: { label: "In stock", pdf: { text: "In stock" } },
};

/**
 * A headline figure that can also be a filter. The value is never truncated:
 * on a narrow column it steps down a size rather than being clipped, which is
 * what happened to "₦2,518,220" when four tiles shared a squeezed column.
 */
function Tile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  active,
  onClick,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
  hint: string;
  tone?: "signal" | "halt";
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-input",
            tone === "halt" ? "bg-halt-tint text-halt" : tone === "signal" ? "bg-signal-tint text-signal" : "bg-market-tint text-market",
          )}
        >
          <Icon size={17} />
        </span>
        <p className="min-w-0 text-label uppercase text-ink-40">{label}</p>
      </div>
      <p className="mt-2.5 font-display text-title leading-tight font-bold whitespace-nowrap text-ink sm:text-display-md">
        {value}
      </p>
      <p className="mt-0.5 text-body text-ink-40">{hint}</p>
    </>
  );

  const frame = cn(
    "min-w-0 rounded-panel border bg-surface px-4 py-4 text-left shadow-raised sm:px-5",
    active ? "border-market ring-2 ring-market" : "border-line",
  );

  if (!onClick) return <div className={frame}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        frame,
        "transition-colors duration-150 ease-out-pos hover:border-market focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
      )}
    >
      {body}
    </button>
  );
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  k: SortKey;
  sort: Sort | null;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort?.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-1 font-semibold", align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex min-h-touch-admin items-center gap-1 whitespace-nowrap uppercase transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-market",
          active && "text-ink",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        <Icon size={13} aria-hidden className={active ? "text-market" : "opacity-50"} />
      </button>
    </th>
  );
}

/**
 * How full the shelf is against its reorder level — the bar fills at twice the
 * reorder level, which is roughly where a line is comfortably stocked. A cue
 * for scanning a long table; the number beside it is the figure.
 */
function LevelBar({ onHand, reorderLevel, state }: { onHand: Quantity; reorderLevel: Quantity; state: Row["state"] }) {
  const full = Math.max(reorderLevel.milli * 2, 1);
  const ratio = Math.min(1, Math.max(0, onHand.milli / full));
  return (
    <span aria-hidden className="mt-1.5 ml-auto block h-1 w-20 overflow-hidden rounded-pill bg-line">
      <span
        className={cn(
          "block h-full rounded-pill",
          state === "oversold" || state === "expired" ? "bg-halt" : state === "low" ? "bg-sun" : "bg-leaf",
        )}
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </span>
  );
}

function RowAction({
  onClick,
  icon: Icon,
  label,
  product,
  disabled,
  primary,
  iconOnly,
}: {
  onClick: () => void;
  icon: typeof PackagePlus;
  label: string;
  product: string;
  disabled?: boolean;
  primary?: boolean;
  /** Secondary actions only. The accessible name and tooltip still say what it does. */
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label} ${product}`}
      title={iconOnly ? `${label} stock` : undefined}
      className={cn(
        "inline-flex min-h-touch-admin items-center justify-center gap-1.5 rounded-input border font-medium whitespace-nowrap",
        iconOnly ? "min-w-touch-admin" : "px-3",
        "transition-colors duration-150 ease-out-pos focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market disabled:opacity-40",
        primary
          ? "border-market/30 bg-market-tint text-market hover:border-market hover:bg-market hover:text-white"
          : "border-line bg-surface text-ink-70 hover:border-ink-40 hover:text-ink",
      )}
    >
      <Icon size={17} aria-hidden />
      {!iconOnly && label}
    </button>
  );
}

/** Never colour alone — an icon and a word carry the state too (§14). */
function StockState({ state }: { state: Row["state"] }) {
  const shape = {
    oversold: { icon: CircleAlert, tone: "bg-halt-tint text-halt" },
    expired: { icon: CalendarClock, tone: "bg-halt-tint text-halt" },
    low: { icon: TriangleAlert, tone: "bg-sun text-ink" },
    ok: { icon: CircleCheck, tone: "bg-market-tint text-market" },
  }[state];
  const Icon = shape.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-label font-semibold tracking-normal whitespace-nowrap",
        shape.tone,
      )}
    >
      <Icon size={14} aria-hidden />
      {STATE_LABEL[state].label}
    </span>
  );
}

/**
 * The receive drawer. The panel inside brings its own heading, so this adds
 * only the frame, the close control and Escape — the draft lives in the
 * screen, so closing loses nothing.
 */
function Drawer({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink/50"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-140 overflow-y-auto bg-paper p-3 shadow-raised sm:p-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close — the draft is kept"
          className="absolute top-5 right-5 z-10 grid size-touch-admin place-items-center rounded-input bg-surface text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-market sm:top-6 sm:right-6"
        >
          <X size={22} />
        </button>
        {children}
      </div>
    </div>
  );
}
