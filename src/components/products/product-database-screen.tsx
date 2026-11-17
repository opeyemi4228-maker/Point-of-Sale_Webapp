"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Barcode,
  Boxes,
  CircleCheck,
  Database,
  QrCode,
  Search,
  Printer,
  ShieldCheck,
  Tags,
  TriangleAlert,
} from "lucide-react";
import { Chip, ScopeControls } from "@/components/inventory/scope-controls";
import { LabelsSheet } from "@/components/products/labels-sheet";
import { ProductDetailSheet } from "@/components/products/product-detail-sheet";
import { EMPTY_STOCK, useProductStock } from "@/components/products/use-product-stock";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportMenu } from "@/components/ui/export-menu";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { TableScroller } from "@/components/ui/table-scroller";
import { useWorkspaceProducts } from "@/lib/data/workspace-data";
import { formatWhole, multiply, sum } from "@/lib/domain/money";
import {
  barcodesOf,
  catalogIssues,
  formatBasisPoints,
  marginBasisPoints,
  searchMaster,
} from "@/lib/domain/product-master";
import { formatQty, toNumber } from "@/lib/domain/quantity";
import { isLow } from "@/lib/domain/stock";
import { moneyCell, qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
import { ALL_BRANCHES, useInventoryScope, useScopedLedger } from "@/lib/hooks/use-inventory";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";

/**
 * Product database — SPEC §7.3.
 *
 * The item master as a register: every product the chain sells, by part
 * number, with every barcode that resolves to it, what it costs and sells for,
 * and how much is on the shelf. It is the screen people open with a code in
 * their hand — off a supplier invoice, a damaged pack, a shelf label — to find
 * out which product it is.
 *
 * Search covers name, part number, category *and* every barcode, because in
 * the back office a product is looked up by whichever code is in front of you.
 *
 * Health checks run over the whole catalog (`catalogIssues`) and surface the
 * records that will cause trouble at the till — missing or mistyped barcodes,
 * a code shared by two products, a line priced under cost — before a cashier
 * finds them with a queue waiting.
 */

type Status = "live" | "attention" | "delisted" | "all";
type SortKey = "sku" | "name" | "price" | "cost" | "margin" | "onHand";
type Sort = { key: SortKey; dir: 1 | -1 };

export function ProductDatabaseScreen({ today }: { today: string }) {
  const scope = useInventoryScope({ allowAll: true });
  const { entries } = useScopedLedger(scope.branchId);
  const products = useWorkspaceProducts();
  const stock = useProductStock(entries, today);
  const issues = useMemo(() => catalogIssues(products), [products]);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<Status>("live");
  const [sort, setSort] = useState<Sort>({ key: "sku", dir: 1 });
  const [openId, setOpenId] = useState<string | null>(null);
  /** Lines ticked for shelf labels. */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [labelling, setLabelling] = useState<Product[] | null>(null);

  const allBranches = scope.branchId === ALL_BRANCHES;
  const scopeLabel = allBranches ? "All branches" : (scope.branch?.name ?? "This branch");
  const branchName = useMemo(() => new Map(scope.branches.map((b) => [b.id, b.name])), [scope.branches]);

  const categories = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const p of products) {
      if (p.delistedAt) continue;
      const c = seen.get(p.categoryId) ?? { id: p.categoryId, name: p.categoryName, count: 0 };
      c.count++;
      seen.set(p.categoryId, c);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const counts = useMemo(() => {
    const live = products.filter((p) => !p.delistedAt);
    const codes = live.flatMap((p) => barcodesOf(p));
    return {
      live: live.length,
      delisted: products.length - live.length,
      attention: issues.size,
      all: products.length,
      codes: codes.length,
      gtin: codes.filter((c) => c.kind === "ean13" || c.kind === "ean8" || c.kind === "upca").length,
      inStore: codes.filter((c) => c.kind === "in_store").length,
      noCode: live.filter((p) => p.barcodes.length === 0).length,
      value: sum(live.map((p) => multiply(p.cost, Math.max(0, toNumber(stock.get(p.id)?.onHand ?? { milli: 0 }))))),
    };
  }, [products, issues, stock]);

  const rows = useMemo(() => {
    const filtered = searchMaster(products, query).filter((p) => {
      if (category !== "all" && p.categoryId !== category) return false;
      if (status === "live") return !p.delistedAt;
      if (status === "delisted") return Boolean(p.delistedAt);
      if (status === "attention") return issues.has(p.id);
      return true;
    });

    const view = filtered.map((product) => {
      const s = stock.get(product.id) ?? EMPTY_STOCK;
      return {
        product,
        stock: s,
        margin: marginBasisPoints(product.price, product.cost),
        codes: barcodesOf(product),
        issues: issues.get(product.id) ?? [],
      };
    });

    const value = (r: (typeof view)[number]): number | string => {
      switch (sort.key) {
        case "sku": return r.product.sku;
        case "name": return r.product.name.toLowerCase();
        case "price": return r.product.price.kobo;
        case "cost": return r.product.cost.kobo;
        case "margin": return r.margin ?? -Infinity;
        case "onHand": return r.stock.onHand.milli;
      }
    };
    return view.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const order = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
      return order * sort.dir || a.product.sku.localeCompare(b.product.sku);
    });
  }, [products, query, category, status, issues, stock, sort]);

  const open = openId ? products.find((p) => p.id === openId) ?? null : null;

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "sku" || key === "name" ? 1 : -1 }));
  }

  const buildReport = (): ReportSpec => {
    const filters = [
      category !== "all" ? categories.find((c) => c.id === category)?.name : null,
      { live: "Live products", delisted: "Delisted products", attention: "Needing attention", all: "All products" }[status],
      query.trim() ? `matching “${query.trim()}”` : null,
    ].filter(Boolean);

    return {
      title: "Product database",
      subtitle: `${scopeLabel} · part numbers, barcodes, prices and stock`,
      filename: reportFilename("product-database", allBranches ? "chain" : scope.branch?.code, today),
      orientation: "landscape",
      meta: [
        { label: "Scope", value: scopeLabel },
        { label: "Showing", value: filters.join(" · ") },
        { label: "Lines", value: `${rows.length} of ${counts.all}` },
        { label: "As at", value: today },
      ],
      summary: [
        { label: "Live products", value: String(counts.live), hint: `${counts.delisted} delisted` },
        { label: "Barcodes", value: String(counts.codes), hint: `${counts.gtin} GTIN · ${counts.inStore} in-store` },
        { label: "Categories", value: String(categories.length) },
        { label: "Needs attention", value: String(counts.attention), hint: counts.attention ? "See last column" : "Catalog is clean" },
      ],
      tables: [
        {
          columns: [
            { header: "Part no.", mono: true, width: 9 },
            { header: "Product", width: 22 },
            { header: "Category", width: 11 },
            { header: "Barcodes", mono: true, width: 17 },
            { header: "Unit", width: 5 },
            { header: "Cost", align: "right", width: 9 },
            { header: "Price", align: "right", width: 9 },
            { header: "Margin %", align: "right", width: 7 },
            { header: "On hand", align: "right", width: 9 },
            { header: "Reorder", align: "right", width: 7 },
            { header: "Sold 30d", align: "right", width: 8 },
            { header: "Status", width: 10 },
          ],
          rows: rows.map((r) => [
            r.product.sku,
            r.product.name,
            r.product.categoryName,
            r.product.barcodes.length
              ? { text: r.product.barcodes.join("\n"), raw: r.product.barcodes.join(" ") }
              : { text: "none", tone: "halt" },
            r.product.unit,
            moneyCell(r.product.cost),
            moneyCell(r.product.price),
            { text: formatBasisPoints(r.margin), raw: r.margin === null ? "" : r.margin / 100, tone: r.margin !== null && r.margin <= 0 ? "halt" : undefined },
            qtyCell(r.stock.onHand),
            qtyCell(r.product.reorderLevel),
            qtyCell(r.stock.sold30),
            r.product.delistedAt
              ? { text: "Delisted", tone: "muted" }
              : r.issues.length
                ? { text: `${r.issues.length} issue${r.issues.length === 1 ? "" : "s"}`, tone: "signal" }
                : "Live",
          ]),
          empty: "No products match this selection.",
        },
        ...(issues.size
          ? [
              {
                heading: "Records needing attention",
                columns: [{ header: "Part no.", mono: true, width: 12 }, { header: "Product", width: 28 }, { header: "Issue", width: 60 }],
                rows: products.flatMap((p) => (issues.get(p.id) ?? []).map((i) => [p.sku, p.name, i.message])),
              },
            ]
          : []),
      ],
      footnote:
        "Margin is gross, on the VAT-inclusive selling price at catalog cost. On hand and units sold are derived from the stock ledger.",
    };
  };

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-400 flex-col gap-5 p-4 sm:p-5">
        <ScopeControls scope={scope} allowAll>
          <div className="ml-auto">
            <ExportMenu build={buildReport} />
          </div>
        </ScopeControls>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Panel>
            <StatTile icon={Database} label="Products" value={String(counts.live)} hint={`${counts.delisted} delisted · ${categories.length} categories`} />
          </Panel>
          <Panel>
            <StatTile icon={Barcode} label="Barcodes" value={String(counts.codes)} hint={`${counts.gtin} GTIN · ${counts.inStore} in-store labels`} />
          </Panel>
          <Panel>
            <StatTile icon={Boxes} label="Stock at cost" value={formatWhole(counts.value)} hint={scopeLabel} />
          </Panel>
          <Panel>
            <button
              type="button"
              onClick={() => setStatus(counts.attention ? "attention" : "live")}
              className="block w-full text-left transition-colors duration-150 ease-out-pos hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-market"
            >
              <StatTile
                icon={counts.attention ? TriangleAlert : ShieldCheck}
                label="Catalog health"
                value={counts.attention ? `${counts.attention} to fix` : "All clear"}
                hint={counts.attention ? "Press to see them" : "Every live line has a valid code, price and cost"}
              />
            </button>
          </Panel>
        </div>

        <Panel>
          <PanelHeader
            title="Item master"
            meta="Every product by part number — press a row for its barcodes, pricing and stock"
          />

          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div className="relative">
              <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-40" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, part number or barcode — or scan one"
                aria-label="Search the product database"
                autoComplete="off"
                spellCheck={false}
                className="min-h-touch-admin w-full rounded-input border border-line bg-surface pr-4 pl-10 text-body text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
                <Chip active={status === "live"} onClick={() => setStatus("live")} count={counts.live}>Live</Chip>
                <Chip active={status === "attention"} onClick={() => setStatus("attention")} count={counts.attention}>Needs attention</Chip>
                <Chip active={status === "delisted"} onClick={() => setStatus("delisted")} count={counts.delisted}>Delisted</Chip>
                <Chip active={status === "all"} onClick={() => setStatus("all")} count={counts.all}>All</Chip>
              </div>

              <label className="flex items-center gap-2 sm:ml-auto">
                <Tags size={18} aria-hidden className="text-ink-40" />
                <span className="sr-only">Category</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="min-h-touch-admin rounded-input border border-line bg-surface px-3 pr-8 text-body font-medium text-ink transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:outline-2 focus:outline-offset-0 focus:outline-market"
                >
                  <option value="all">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.count})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={status === "attention" ? CircleCheck : Search}
              title={status === "attention" ? "Nothing needs fixing" : "No product matches"}
              detail={
                status === "attention"
                  ? "Every live product has a barcode that checks out, a cost, a price above it and a reorder level."
                  : "Try part of the name, the part number (SG-0112) or the full barcode."
              }
            />
          ) : (
            <TableScroller>
              <table className="w-full min-w-240 text-left">
                <thead>
                  <tr className="border-b border-line bg-paper text-label uppercase text-ink-40">
                    <th scope="col" className="w-12 pl-4">
                      <input
                        type="checkbox"
                        aria-label="Select every line shown"
                        checked={rows.length > 0 && rows.every((r) => selected.has(r.product.id))}
                        onChange={(event) => {
                          const on = event.target.checked;
                          setSelected((cur) => {
                            const next = new Set(cur);
                            for (const r of rows) {
                              if (on) next.add(r.product.id);
                              else next.delete(r.product.id);
                            }
                            return next;
                          });
                        }}
                        className="size-5 accent-market"
                      />
                    </th>
                    <SortHeader label="Part no." k="sku" sort={sort} onSort={toggleSort} className="pl-2" />
                    <SortHeader label="Product" k="name" sort={sort} onSort={toggleSort} />
                    <th scope="col" className="px-3 py-3 font-semibold">Barcode</th>
                    <SortHeader label="Cost" k="cost" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Price" k="price" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Margin" k="margin" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="On hand" k="onHand" sort={sort} onSort={toggleSort} align="right" className="pr-5" />

                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const primary = r.codes[0];
                    const extra = r.codes.length - 1;
                    const low = !r.product.delistedAt && isLow(r.stock.onHand, r.product.reorderLevel);
                    return (
                      <tr
                        key={r.product.id}
                        onClick={() => setOpenId(r.product.id)}
                        className={cn("cursor-pointer transition-colors duration-150 hover:bg-market-tint/60", r.product.delistedAt && "text-ink-40")}
                      >
                        <td className="pl-4" onClick={(event) => event.stopPropagation()}>
                          <label className="grid size-touch-admin cursor-pointer place-items-center">
                            <input
                              type="checkbox"
                              aria-label={`Select ${r.product.name}`}
                              checked={selected.has(r.product.id)}
                              onChange={(event) => {
                                const on = event.target.checked;
                                setSelected((cur) => {
                                  const next = new Set(cur);
                                  if (on) next.add(r.product.id);
                                  else next.delete(r.product.id);
                                  return next;
                                });
                              }}
                              className="size-5 accent-market"
                            />
                          </label>
                        </td>
                        <td className="py-3 pr-3 pl-2 whitespace-nowrap">
                          <span className="rounded-input bg-paper px-2 py-1 font-mono text-mono font-semibold text-ink ring-1 ring-line">
                            {r.product.sku}
                          </span>
                        </td>
                        <th scope="row" className="max-w-72 px-3 py-3 font-normal">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenId(r.product.id);
                            }}
                            className="block max-w-full truncate text-left font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
                          >
                            {r.product.name}
                          </button>
                          <span className="flex items-center gap-2 text-ink-40">
                            <span className="truncate">
                              {r.product.categoryName} · {r.product.soldBy === "weight" ? `by weight (${r.product.unit})` : `per ${r.product.unit}`}
                            </span>
                            {/* Status only when it is news — a live, clean line needs no badge. */}
                            {(r.product.delistedAt || r.issues.length > 0) && (
                              <RowStatus product={r.product} issueCount={r.issues.length} />
                            )}
                          </span>
                        </th>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {primary ? (
                            <span className="inline-flex items-center gap-1.5">
                              {primary.kind === "in_store" ? (
                                <QrCode size={15} aria-hidden className="text-ink-40" />
                              ) : (
                                <Barcode size={15} aria-hidden className="text-ink-40" />
                              )}
                              <span className="font-mono text-ink-70">{primary.code}</span>
                              {extra > 0 && (
                                <span className="rounded-pill bg-paper px-1.5 font-numeric text-label tracking-normal text-ink-70 ring-1 ring-line" title={r.codes.slice(1).map((c) => c.code).join(", ")}>
                                  +{extra}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 font-medium text-halt">
                              <TriangleAlert size={15} aria-hidden />
                              No barcode
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-numeric text-ink-70">{formatWhole(r.product.cost)}</td>
                        <td className="px-3 py-3 text-right font-numeric font-semibold text-ink">{formatWhole(r.product.price)}</td>
                        <td className={cn("px-3 py-3 text-right font-numeric", r.margin !== null && r.margin <= 0 ? "font-semibold text-halt" : "text-ink-70")}>
                          {formatBasisPoints(r.margin)}
                        </td>
                        <td className="py-3 pr-5 pl-3 text-right font-numeric whitespace-nowrap">
                          <span className={cn("font-semibold", r.stock.onHand.milli < 0 ? "text-halt" : "text-ink")}>
                            {formatQty(r.stock.onHand)}
                          </span>
                          <span className="ml-1 text-ink-40">{r.product.unit}</span>
                          {low && (
                            <span className="ml-1.5 inline-flex items-center align-middle text-signal" title="At or below reorder level">
                              <TriangleAlert size={14} aria-hidden />
                              <span className="sr-only">At or below reorder level</span>
                            </span>
                          )}
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
          )}

          <p className="border-t border-line px-5 py-3 text-body text-ink-40">
            {rows.length} of {counts.all} products · {counts.codes} barcodes registered
            {counts.noCode > 0 && ` · ${counts.noCode} without a barcode`}
          </p>
        </Panel>
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-sm sm:px-5">
          <div className="mx-auto flex max-w-400 flex-wrap items-center gap-3">
            <span className="font-medium text-ink">
              {selected.size} {selected.size === 1 ? "product" : "products"} selected
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-touch-admin rounded-input px-2 font-medium text-ink-70 hover:bg-paper focus-visible:outline-2 focus-visible:outline-market"
            >
              Clear
            </button>
            <Button
              className="ml-auto"
              onClick={() => setLabelling(products.filter((p) => selected.has(p.id)))}
            >
              <Printer size={18} aria-hidden />
              Print shelf labels
            </Button>
          </div>
        </div>
      )}

      {labelling && (
        <LabelsSheet products={labelling} today={today} onClose={() => setLabelling(null)} />
      )}

      {open && (
        <ProductDetailSheet
          onPrintLabel={() => {
            setOpenId(null);
            setLabelling([open]);
          }}
          product={open}
          stock={stock.get(open.id) ?? EMPTY_STOCK}
          issues={issues.get(open.id) ?? []}
          entries={entries}
          scopeLabel={scopeLabel}
          branchName={branchName}
          onClose={() => setOpenId(null)}
        />
      )}
    </main>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

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
  sort: Sort;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === k;
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

function RowStatus({ product, issueCount }: { product: Product; issueCount: number }) {
  if (product.delistedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-40">
        <span aria-hidden className="size-2 rounded-pill bg-ink-40" />
        Delisted
      </span>
    );
  }
  if (issueCount) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-sun px-2.5 py-0.5 font-medium whitespace-nowrap text-ink">
        <TriangleAlert size={14} aria-hidden />
        {issueCount} {issueCount === 1 ? "issue" : "issues"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-market">
      <CircleCheck size={14} aria-hidden />
      Live
    </span>
  );
}
