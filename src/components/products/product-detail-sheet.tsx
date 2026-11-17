"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CircleCheck,
  CircleX,
  Copy,
  Info,
  Printer,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { ExportMenu } from "@/components/ui/export-menu";
import { BarcodeGraphic } from "@/components/products/barcode-graphic";
import { daysOfCover, type ProductStock } from "@/components/products/use-product-stock";
import { formatWhole, subtract } from "@/lib/domain/money";
import { barcodesOf, formatBasisPoints, marginBasisPoints, type CatalogIssue } from "@/lib/domain/product-master";
import { formatQty } from "@/lib/domain/quantity";
import { STOCK_REASON_LABEL, isLow } from "@/lib/domain/stock";
import { qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
import { stamp } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";
import type { StockEntry } from "@/types/stock";

/**
 * One product, everything known about it — SPEC §7.3.
 *
 * Read-only by design: the catalog is owned by HQ and changed through the
 * catalog workflow, not by editing a field here. What this sheet is for is the
 * question a manager actually has in hand — "which product is this code, what
 * do we sell it for, and how much have we got" — answered in one place.
 */
export function ProductDetailSheet({
  product,
  stock,
  issues,
  entries,
  scopeLabel,
  branchName,
  onClose,
  onPrintLabel,
}: {
  product: Product;
  stock: ProductStock;
  issues: readonly CatalogIssue[];
  /** Ledger in scope; filtered to this product here. */
  entries: readonly StockEntry[];
  /** "Gwarinpa" or "All branches". */
  scopeLabel: string;
  /** Branch id → name, for the per-branch split and the movement list. */
  branchName: ReadonlyMap<string, string>;
  onClose: () => void;
  onPrintLabel?: () => void;
}) {
  const codes = barcodesOf(product);
  const margin = marginBasisPoints(product.price, product.cost);
  const profit = subtract(product.price, product.cost);
  const cover = daysOfCover(stock.onHand, stock.sold30);
  const low = isLow(stock.onHand, product.reorderLevel);
  const showBranches = stock.byBranch.size > 1;

  const recent = useMemo(
    () =>
      entries
        .filter((e) => e.productId === product.id)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 8),
    [entries, product.id],
  );

  const buildSheet = (): ReportSpec => ({
    title: product.name,
    subtitle: `Product sheet · part no. ${product.sku} · ${scopeLabel}`,
    filename: reportFilename("product", product.sku),
    meta: [
      { label: "Part number", value: product.sku },
      { label: "Category", value: product.categoryName },
      { label: "Sold by", value: product.soldBy === "weight" ? `Weight (${product.unit})` : `Unit (${product.unit})` },
      { label: "Status", value: product.delistedAt ? `Delisted ${stamp(product.delistedAt)}` : "Live" },
    ],
    summary: [
      { label: "Price", value: formatWhole(product.price), hint: "VAT inclusive" },
      { label: "Cost", value: formatWhole(product.cost) },
      { label: "Margin", value: formatBasisPoints(margin), hint: `${formatWhole(profit)} a unit` },
      { label: "On hand", value: `${formatQty(stock.onHand)} ${product.unit}`, hint: scopeLabel },
    ],
    tables: [
      {
        heading: "Barcodes",
        columns: [{ header: "Code", mono: true }, { header: "Type" }, { header: "Check digit" }, { header: "Origin" }, { header: "Use" }],
        rows: codes.map((c) => [
          c.code,
          c.label,
          c.valid === null ? "n/a" : c.valid ? "Valid" : { text: "Fails", tone: "halt" },
          c.origin ?? "—",
          c.primary ? "Shelf label" : "Also scans",
        ]),
        empty: "No barcode registered — this product can only be found by name.",
      },
      ...(showBranches
        ? [
            {
              heading: "On hand by branch",
              columns: [{ header: "Branch" }, { header: "On hand", align: "right" as const }],
              rows: [...stock.byBranch].map(([id, qty]) => [branchName.get(id) ?? id, qtyCell(qty, product.unit)]),
            },
          ]
        : []),
      {
        heading: "Recent movements",
        columns: [
          { header: "When" },
          { header: "Movement" },
          { header: "Change", align: "right" as const },
          { header: "By" },
          { header: "Reference", mono: true },
        ],
        rows: recent.map((e) => [
          stamp(e.at),
          STOCK_REASON_LABEL[e.reason],
          qtyCell(e.delta, product.unit, { signed: true }),
          e.staffName,
          e.ref ?? "—",
        ]),
        empty: "No movements recorded.",
      },
      ...(issues.length
        ? [{ heading: "Needs attention", columns: [{ header: "Issue" }], rows: issues.map((i) => [i.message]) }]
        : []),
    ],
    footnote: `Valued at catalog cost ${formatWhole(product.cost)}. Stock is derived from the ledger, never typed in.`,
  });

  return (
    <Sheet
      title={product.name}
      subtitle={`${product.categoryName} · sold by ${product.soldBy === "weight" ? "weight" : "the unit"}`}
      onClose={onClose}
      width="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-body text-ink-40">Catalog details are managed by HQ.</p>
          <div className="flex flex-wrap gap-2">
            {onPrintLabel && (
              <Button variant="secondary" onClick={onPrintLabel}>
                <Printer size={18} aria-hidden />
                Shelf label
              </Button>
            )}
            <ExportMenu build={buildSheet} label="Product sheet" />
          </div>
        </div>
      }
    >
      {/* Identity — the part number first, because it is how this line is named everywhere. */}
      <section className="grid gap-4 rounded-panel border border-line bg-surface p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <p className="text-label uppercase text-ink-40">Part number</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-display-md text-ink">{product.sku}</span>
            <CopyButton value={product.sku} label="part number" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {product.delistedAt ? (
              <StatusPill tone="stopped">Delisted</StatusPill>
            ) : (
              <StatusPill tone="done">Live</StatusPill>
            )}
            {issues.length > 0 ? (
              <StatusPill tone="warning">
                {issues.length} {issues.length === 1 ? "issue" : "issues"}
              </StatusPill>
            ) : (
              <StatusPill tone="idle">Record complete</StatusPill>
            )}
          </div>
        </div>
        {codes[0] && <BarcodeGraphic code={codes[0].code} className="sm:w-56" />}
      </section>

      {issues.length > 0 && (
        <section className="rounded-panel border border-signal/40 bg-signal-tint p-4">
          <h3 className="flex items-center gap-2 font-sans text-body font-semibold text-ink">
            <TriangleAlert size={18} aria-hidden className="text-signal" />
            Needs attention
          </h3>
          <ul className="mt-2 flex flex-col gap-1 pl-7 text-body text-ink-70">
            {issues.map((issue, i) => (
              <li key={i} className="list-disc">{issue.message}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Pricing */}
      <SheetSection title="Pricing">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-4">
          <Fact label="Selling price" value={formatWhole(product.price)} hint="VAT inclusive" />
          <Fact label="Cost" value={formatWhole(product.cost)} hint="Catalog cost" />
          <Fact
            label="Gross margin"
            value={formatBasisPoints(margin)}
            hint={`${formatWhole(profit)} a unit`}
            tone={margin !== null && margin <= 0 ? "halt" : undefined}
          />
          <Fact label="Unit" value={product.unit} hint={product.soldBy === "weight" ? "Weighed at the till" : "Counted"} />
        </dl>
      </SheetSection>

      {/* Stock */}
      <SheetSection title={`Stock · ${scopeLabel}`}>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-4">
          <Fact
            label="On hand"
            value={`${formatQty(stock.onHand)} ${product.unit}`}
            hint={stock.onHand.milli < 0 ? "Oversold" : low ? "At or below reorder" : "Above reorder"}
            tone={stock.onHand.milli < 0 ? "halt" : undefined}
          />
          <Fact label="Reorder at" value={`${formatQty(product.reorderLevel)} ${product.unit}`} />
          <Fact label="Sold, 30 days" value={`${formatQty(stock.sold30)} ${product.unit}`} />
          <Fact
            label="Days of cover"
            value={cover === null ? "—" : String(cover)}
            hint={cover === null ? "No recent sales" : "At the 30-day pace"}
          />
        </dl>
        <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-body text-ink-70">
          <span>Last received: {stock.lastReceivedAt ? stamp(stock.lastReceivedAt) : "never"}</span>
          <span>Last sold: {stock.lastSoldAt ? stamp(stock.lastSoldAt) : "never"}</span>
        </p>

        {showBranches && (
          <ul className="mt-3 divide-y divide-line rounded-panel border border-line bg-surface">
            {[...stock.byBranch].map(([id, qty]) => (
              <li key={id} className="flex items-center justify-between px-4 py-2.5 text-body">
                <span className="text-ink-70">{branchName.get(id) ?? id}</span>
                <span className={cn("font-numeric font-semibold", qty.milli < 0 ? "text-halt" : "text-ink")}>
                  {formatQty(qty)} <span className="font-normal text-ink-40">{product.unit}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SheetSection>

      {/* Barcodes */}
      <SheetSection
        title="Barcodes"
        meta={`${codes.length} registered · the first is printed on the shelf label`}
      >
        {codes.length === 0 ? (
          <p className="flex items-start gap-2 rounded-panel border border-line bg-surface p-4 text-body text-ink-70">
            <Info size={18} aria-hidden className="mt-0.5 shrink-0 text-ink-40" />
            No barcode. The till can still sell it — search by name or part number.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {codes.map((c) => (
              <li key={c.code} className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
                <BarcodeGraphic code={c.code} className="mx-auto max-w-52" />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-mono text-mono text-ink">
                      <span className="truncate">{c.code}</span>
                      <CopyButton value={c.code} label="barcode" small />
                    </p>
                    <p className="text-body text-ink-70">
                      {c.label}
                      {c.origin && <span className="text-ink-40"> · {c.origin}</span>}
                    </p>
                  </div>
                  {c.primary && (
                    <span className="shrink-0 rounded-pill bg-market-tint px-2 py-0.5 text-label font-semibold tracking-normal text-market">
                      Shelf label
                    </span>
                  )}
                </div>
                <CheckDigit valid={c.valid} />
              </li>
            ))}
          </ul>
        )}
      </SheetSection>

      {/* Movements */}
      <SheetSection title="Recent movements" meta="Newest first, from the stock ledger">
        {recent.length === 0 ? (
          <p className="rounded-panel border border-line bg-surface p-4 text-body text-ink-70">
            Nothing has moved yet in {scopeLabel.toLowerCase()}.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
            {recent.map((e) => {
              const inbound = e.delta.milli > 0;
              const Icon = inbound ? ArrowDownLeft : ArrowUpRight;
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-input",
                      inbound ? "bg-market-tint text-market" : "bg-paper text-ink-70",
                    )}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-ink">{STOCK_REASON_LABEL[e.reason]}</span>
                    <span className="block truncate text-body text-ink-40">
                      {stamp(e.at)} · {e.staffName}
                      {showBranches && ` · ${branchName.get(e.branchId) ?? e.branchId}`}
                    </span>
                  </span>
                  <span className={cn("font-numeric font-semibold whitespace-nowrap", inbound ? "text-market" : "text-ink")}>
                    {inbound ? "+" : ""}
                    {formatQty(e.delta)} {product.unit}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SheetSection>
    </Sheet>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function SheetSection({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-sans text-label uppercase text-ink-70">{title}</h3>
        {meta && <p className="text-body text-ink-40">{meta}</p>}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "halt" }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-label uppercase text-ink-40">{label}</dt>
      <dd className={cn("mt-1 font-numeric text-title font-bold", tone === "halt" ? "text-halt" : "text-ink")}>{value}</dd>
      {hint && <dd className="text-body text-ink-40">{hint}</dd>}
    </div>
  );
}

function CheckDigit({ valid }: { valid: boolean | null }) {
  if (valid === null) {
    return (
      <p className="flex items-center gap-1.5 text-body text-ink-40">
        <Info size={16} aria-hidden />
        No check digit — internal code
      </p>
    );
  }
  return valid ? (
    <p className="flex items-center gap-1.5 text-body text-market">
      <CircleCheck size={16} aria-hidden />
      Check digit valid
    </p>
  ) : (
    <p className="flex items-center gap-1.5 text-body text-halt">
      <CircleX size={16} aria-hidden />
      Check digit fails — likely mistyped
    </p>
  );
}

function CopyButton({ value, label, small }: { value: string; label: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* Clipboard blocked (insecure origin) — the code is on screen to copy by hand. */
        }
      }}
      aria-label={copied ? `Copied ${label}` : `Copy ${label} ${value}`}
      className={cn(
        "grid shrink-0 place-items-center rounded-input text-ink-40 transition-colors duration-150 ease-out-pos hover:bg-market-tint hover:text-market focus-visible:outline-2 focus-visible:outline-market",
        "size-touch-admin",
      )}
    >
      {copied ? <Check size={small ? 15 : 18} className="text-market" /> : <Copy size={small ? 15 : 18} />}
    </button>
  );
}
