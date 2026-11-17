"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  CircleCheck,
  Eye,
  EyeOff,
  Minus,
  Plus,
  ScanBarcode,
  Search,
  Send,
  TriangleAlert,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportMenu } from "@/components/ui/export-menu";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { TableScroller } from "@/components/ui/table-scroller";
import { useWorkspaceProducts } from "@/lib/data/workspace-data";
import { indexByBarcode, resolveBarcode } from "@/lib/domain/catalog";
import { balanceAt, bumpCount, countVariance, planCountPosting, type VarianceRow } from "@/lib/domain/counting";
import { formatWhole } from "@/lib/domain/money";
import { formatBasisPoints, searchMaster } from "@/lib/domain/product-master";
import { formatQty, units } from "@/lib/domain/quantity";
import { moneyCell, qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
import { useCostOf, useScopedLedger } from "@/lib/hooks/use-inventory";
import { useCountStore, useCountsHydrated } from "@/lib/stores/counts";
import { useLedgerStore } from "@/lib/stores/ledger";
import { useSessionStore } from "@/lib/stores/session";
import { playScanTone } from "@/lib/utils/scan-tone";
import { stamp } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";

/**
 * One count sheet — SPEC §10.3.
 *
 * Three states on one screen. **Counting**: scan items to add one each, or
 * type the figure; blind counts hide what the ledger expects. **Review**: the
 * expected figures come out, variances are valued at cost, and lines far off
 * are flagged for a recount before anything is posted. **Posted**: read-only,
 * with the variance report to export.
 *
 * Posting appends one `COUNT_ADJUSTMENT` per differing line through the same
 * ledger store every other screen reads, so the stock screen moves the moment
 * the count is posted.
 */
export function CountSheetScreen({ id }: { id: string }) {
  const hydrated = useCountsHydrated();
  const sheet = useCountStore((s) => s.sheets[id]);
  const setCounted = useCountStore((s) => s.setCounted);
  const addLine = useCountStore((s) => s.addLine);
  const reveal = useCountStore((s) => s.reveal);
  const markPosted = useCountStore((s) => s.markPosted);
  const abandon = useCountStore((s) => s.abandon);
  const appendMovements = useLedgerStore((s) => s.appendMovements);
  const staff = useSessionStore((s) => s.session?.staff ?? null);

  const products = useWorkspaceProducts();
  const costOf = useCostOf(products);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const index = useMemo(() => indexByBarcode(products), [products]);
  const { entries } = useScopedLedger(sheet?.branchId ?? "none");

  const [reviewing, setReviewing] = useState(false);
  const [query, setQuery] = useState("");
  const [uncountedOnly, setUncountedOnly] = useState(false);
  const [notice, setNotice] = useState<{ tone: "market" | "halt" | "signal"; text: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [abandoning, setAbandoning] = useState(false);

  const now = new Date().toISOString();
  const variance = useMemo(
    () => (sheet ? countVariance(sheet, entries, costOf, sheet.postedAt ?? now) : null),
    // `now` is deliberately not a dependency: re-deriving every render would
    // churn; the figures settle on the next count or ledger change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, entries, costOf],
  );

  if (!hydrated) return <main className="flex-1" />;
  if (!sheet || !variance) {
    return (
      <main className="flex-1 overflow-y-auto p-5">
        <EmptyState
          icon={TriangleAlert}
          title="Count not found on this device"
          detail="Counts are kept on the device they were started on until they sync. Open it from the tablet it was started on."
          action={<BackLink />}
        />
      </main>
    );
  }

  const counting = sheet.status === "counting";
  const showExpected = !sheet.blind || !counting || reviewing;
  const showVariance = !counting || reviewing;
  const rowFor = new Map(variance.rows.map((r) => [r.productId, r]));
  const { summary } = variance;
  const pct = summary.lines ? Math.round((summary.counted / summary.lines) * 100) : 0;

  const lines = sheet.lines
    .map((line) => ({ line, product: byId.get(line.productId), row: rowFor.get(line.productId)! }))
    .filter((x): x is { line: typeof x.line; product: Product; row: VarianceRow } => Boolean(x.product));
  const visibleIds = new Set(searchMaster(lines.map((l) => l.product), query).map((p) => p.id));
  const visible = lines.filter((l) => visibleIds.has(l.product.id) && (!uncountedOnly || !l.line.counted));
  // Counting keeps the walking order of the sheet; review puts the lines that
  // matter first — flagged recounts, then the largest variance by value.
  if (showVariance) {
    visible.sort(
      (a, b) => Number(b.row.recount) - Number(a.row.recount) || Math.abs(b.row.value.kobo) - Math.abs(a.row.value.kobo),
    );
  }

  function handleScan(raw: string) {
    const result = resolveBarcode(index, raw);
    const product = result.ok ? result.product : null;
    if (!product) {
      playScanTone("refused");
      setNotice({ tone: "halt", text: `No product matches ${raw.trim()}.` });
      return;
    }
    const at = new Date().toISOString();
    const existing = sheet.lines.find((l) => l.productId === product.id);
    if (!existing) {
      addLine(sheet.id, {
        productId: product.id,
        expectedAtCut: balanceAt(entries, sheet.branchId, product.id, at),
        counted: null,
        countedAt: null,
      });
    }
    if (product.soldBy === "weight") {
      // A scan cannot count kilograms. Put the line on top and let them weigh it.
      playScanTone("accepted");
      setQuery(product.sku);
      setNotice({ tone: "signal", text: `${product.name} is sold by weight — type the weight in kg.` });
      return;
    }
    setCounted(sheet.id, product.id, bumpCount(existing?.counted ?? null, units(1)), at);
    playScanTone("accepted");
    setFlash(product.id);
    setTimeout(() => setFlash((f) => (f === product.id ? null : f)), 700);
    setNotice({
      tone: "market",
      text: `${product.name} — ${formatQty(bumpCount(existing?.counted ?? null, units(1)))} ${product.unit} counted${existing ? "" : " (added to this count)"}.`,
    });
  }

  function post() {
    if (!staff) return;
    const at = new Date().toISOString();
    const movements = planCountPosting(sheet, entries, { id: staff.id, name: staff.fullName }, at);
    if (movements.length) appendMovements(movements);
    markPosted(sheet.id, staff.fullName, at);
    setConfirming(false);
    setReviewing(false);
    setNotice({
      tone: "market",
      text: movements.length
        ? `${sheet.reference} posted — ${movements.length} count ${movements.length === 1 ? "adjustment" : "adjustments"} on the ledger, net ${formatWhole(summary.netValue)} at cost.`
        : `${sheet.reference} posted — every counted line matched. Nothing to adjust.`,
    });
  }

  const buildSheetReport = (): ReportSpec => ({
    title: "Stock count sheet",
    subtitle: `${sheet.reference} · ${sheet.scopeLabel}`,
    filename: reportFilename("count-sheet", sheet.reference),
    meta: [
      { label: "Reference", value: sheet.reference },
      { label: "Scope", value: sheet.scopeLabel },
      { label: "Started", value: `${stamp(sheet.startedAt)} · ${sheet.startedByName}` },
      { label: "Lines", value: String(sheet.lines.length) },
    ],
    tables: [
      {
        note: sheet.blind
          ? "Blind count: write what is on the shelf. Expected quantities are deliberately not printed."
          : "Write what is on the shelf, not what the expected column says.",
        columns: [
          { header: "Part no.", mono: true, width: 12 },
          { header: "Product", width: 38 },
          { header: "Unit", width: 7 },
          ...(sheet.blind ? [] : [{ header: "Expected", align: "right" as const, width: 11 }]),
          { header: "Counted", align: "right", width: 16 },
          { header: "Initials", width: 12 },
        ],
        rows: lines.map(({ product, line }) => [
          product.sku,
          product.name,
          product.unit,
          ...(sheet.blind ? [] : [qtyCell(line.expectedAtCut)]),
          line.counted ? qtyCell(line.counted) : "",
          "",
        ]),
      },
    ],
    footnote: "Counted by: ____________________    Checked by: ____________________    Date: ____________",
  });

  const buildVarianceReport = (): ReportSpec => ({
    title: "Stock count variance",
    subtitle: `${sheet.reference} · ${sheet.scopeLabel}`,
    filename: reportFilename("count-variance", sheet.reference),
    orientation: "landscape",
    meta: [
      { label: "Reference", value: sheet.reference },
      { label: "Status", value: sheet.status === "posted" ? `Posted ${stamp(sheet.postedAt!)}` : sheet.status === "abandoned" ? "Abandoned" : "In review — not posted" },
      { label: "Started", value: `${stamp(sheet.startedAt)} · ${sheet.startedByName}` },
      { label: "Counted", value: `${summary.counted} of ${summary.lines} lines` },
    ],
    summary: [
      { label: "Accuracy", value: formatBasisPoints(summary.accuracyBp), hint: `${summary.matched} lines matched` },
      { label: "Short", value: formatWhole(summary.shortValue), hint: `${summary.short} lines` },
      { label: "Over", value: formatWhole(summary.overValue), hint: `${summary.over} lines` },
      { label: "Net variance", value: formatWhole(summary.netValue), hint: "At cost" },
    ],
    tables: [
      {
        columns: [
          { header: "Part no.", mono: true, width: 10 },
          { header: "Product", width: 30 },
          { header: "Expected", align: "right", width: 10 },
          { header: "Counted", align: "right", width: 10 },
          { header: "Variance", align: "right", width: 10 },
          { header: "Value at cost", align: "right", width: 12 },
          { header: "Flag", width: 12 },
        ],
        rows: [...lines]
          .sort((a, b) => Math.abs(b.row.value.kobo) - Math.abs(a.row.value.kobo))
          .map(({ product, row }) => [
            product.sku,
            product.name,
            qtyCell(row.expected, product.unit),
            row.counted ? qtyCell(row.counted, product.unit) : { text: "not counted", tone: "muted" },
            row.variance ? qtyCell(row.variance, product.unit, { signed: true, tone: row.variance.milli < 0 ? "halt" : row.variance.milli > 0 ? "market" : undefined }) : "—",
            row.variance ? moneyCell(row.value) : "—",
            row.recount ? { text: "Recount", tone: "signal" } : "",
          ]),
        totals: ["", "Net", "", "", "", moneyCell(summary.netValue, { bold: true }), ""],
      },
    ],
    footnote:
      "Expected is the ledger balance at the moment each line was counted, so sales during the count are not shrinkage. Uncounted lines are not adjusted.",
  });

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <BackLink />
          <div className="min-w-0">
            <p className="font-mono text-mono font-semibold text-ink">{sheet.reference}</p>
            <p className="text-body text-ink-70">
              {sheet.scopeLabel} · started {stamp(sheet.startedAt)} by {sheet.startedByName}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {counting ? (
              <StatusPill tone={reviewing ? "waiting" : "live"}>{reviewing ? "Reviewing" : "Counting"}</StatusPill>
            ) : sheet.status === "posted" ? (
              <StatusPill tone="done">Posted</StatusPill>
            ) : (
              <StatusPill tone="stopped">Abandoned</StatusPill>
            )}
            <ExportMenu build={counting && !reviewing ? buildSheetReport : buildVarianceReport} label={counting && !reviewing ? "Print sheet" : "Export"} />
          </div>
        </div>

        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {sheet.status === "abandoned" && sheet.closedNote && (
          <Alert tone="signal" title={`Abandoned by ${sheet.postedByName}`}>{sheet.closedNote}</Alert>
        )}

        {/* Progress and headline figures */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Figure label="Counted" value={`${summary.counted} / ${summary.lines}`} hint={`${pct}% of the sheet`}>
            <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-pill bg-line">
              <span className="block h-full rounded-pill bg-market" style={{ width: `${pct}%` }} />
            </span>
          </Figure>
          {showVariance ? (
            <>
              <Figure label="Accuracy" value={formatBasisPoints(summary.accuracyBp)} hint={`${summary.matched} matched · ${summary.recounts} to recount`} />
              <Figure label="Short" value={formatWhole(summary.shortValue)} hint={`${summary.short} lines, at cost`} tone={summary.short ? "halt" : undefined} />
              <Figure label="Net variance" value={formatWhole(summary.netValue)} hint={`${summary.over} lines over · ${formatWhole(summary.overValue)}`} tone={summary.netValue.kobo < 0 ? "halt" : undefined} />
            </>
          ) : (
            <div className="flex items-start gap-3 rounded-panel border border-line bg-surface p-4 shadow-raised sm:col-span-1 xl:col-span-3">
              {sheet.blind ? <EyeOff size={20} aria-hidden className="mt-0.5 shrink-0 text-ink-70" /> : <Eye size={20} aria-hidden className="mt-0.5 shrink-0 text-ink-70" />}
              <p className="text-body text-ink-70">
                {sheet.blind
                  ? "Blind count — expected quantities are hidden until you review. Scan each item to add one, or type the figure. Weighed goods: type the weight."
                  : "Scan each item to add one, or type the figure. Weighed goods: type the weight."}
              </p>
            </div>
          )}
        </div>

        <Panel>
          <PanelHeader
            title={showVariance ? "Variances" : "Count"}
            meta={showVariance ? "Largest by value first · flagged lines are worth a second look" : "Every line on the sheet"}
          />

          <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center">
            {counting && <ScanBox onScan={handleScan} />}
            <div className="relative flex-1">
              <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-40" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a line"
                aria-label="Find a line on the sheet"
                className="min-h-touch-admin w-full rounded-input border border-line bg-surface pr-4 pl-10 text-body text-ink placeholder:text-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
              />
            </div>
            <label className="flex min-h-touch-admin items-center gap-2 text-body text-ink-70">
              <input type="checkbox" checked={uncountedOnly} onChange={(e) => setUncountedOnly(e.target.checked)} className="size-4 accent-market" />
              Uncounted only ({summary.uncounted})
            </label>
          </div>

          <TableScroller>
            <table className="w-full min-w-200 text-left">
              <thead>
                <tr className="border-b border-line bg-paper text-label uppercase text-ink-40">
                  <th scope="col" className="py-3 pr-3 pl-5 font-semibold">Product</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Expected</th>
                  <th scope="col" className="px-3 py-3 text-center font-semibold">Counted</th>
                  {showVariance && <th scope="col" className="px-3 py-3 text-right font-semibold">Variance</th>}
                  {showVariance && <th scope="col" className="py-3 pr-5 pl-3 text-right font-semibold">At cost</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map(({ product, line, row }) => (
                  <tr key={product.id} className={cn("transition-colors duration-150", flash === product.id ? "bg-market-tint" : "hover:bg-paper")}>
                    <th scope="row" className="max-w-80 py-3 pr-3 pl-5 font-normal">
                      <span className="block truncate font-medium text-ink">{product.name}</span>
                      <span className="block text-body text-ink-40">
                        <span className="font-mono text-mono">{product.sku}</span> · {product.categoryName}
                      </span>
                    </th>
                    <td className="px-3 py-3 text-right font-numeric text-ink-70">
                      {showExpected ? (
                        <>
                          {formatQty(row.expected)} <span className="text-ink-40">{product.unit}</span>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-ink-40">
                          <EyeOff size={14} aria-hidden /> Hidden
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {counting ? (
                        <CountInput
                          product={product}
                          value={line.counted ? formatQty(line.counted) : ""}
                          onChange={(text) => {
                            const at = new Date().toISOString();
                            if (text.trim() === "") return setCounted(sheet.id, product.id, null, at);
                            const n = Number(text);
                            if (!Number.isFinite(n) || n < 0) return;
                            const rounded = product.soldBy === "weight" ? Math.round(n * 1000) / 1000 : Math.floor(n);
                            setCounted(sheet.id, product.id, units(rounded), at);
                          }}
                          onStep={(by) => setCounted(sheet.id, product.id, bumpCount(line.counted, units(by)), new Date().toISOString())}
                        />
                      ) : (
                        <span className="block text-center font-numeric font-semibold text-ink">
                          {line.counted ? `${formatQty(line.counted)} ${product.unit}` : <span className="font-normal text-ink-40">not counted</span>}
                        </span>
                      )}
                    </td>
                    {showVariance && (
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {row.variance ? (
                          <span className="inline-flex items-center justify-end gap-1.5">
                            {row.recount && (
                              <span className="inline-flex items-center gap-1 rounded-pill bg-sun px-2 py-0.5 text-label font-semibold tracking-normal text-ink">
                                <TriangleAlert size={13} aria-hidden /> Recount
                              </span>
                            )}
                            <span className={cn("font-numeric font-semibold", row.variance.milli < 0 ? "text-halt" : row.variance.milli > 0 ? "text-market" : "text-ink-40")}>
                              {row.variance.milli > 0 ? "+" : ""}
                              {formatQty(row.variance)}
                            </span>
                            {row.variance.milli === 0 && <CircleCheck size={15} aria-label="Matched" className="text-market" />}
                          </span>
                        ) : (
                          <span className="text-ink-40">—</span>
                        )}
                      </td>
                    )}
                    {showVariance && (
                      <td className={cn("py-3 pr-5 pl-3 text-right font-numeric", row.value.kobo < 0 ? "text-halt" : "text-ink-70")}>
                        {row.variance ? formatWhole(row.value) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
          {visible.length === 0 && <p className="px-5 py-8 text-center text-body text-ink-70">No line matches.</p>}
        </Panel>

        {counting && (
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur-sm sm:-mx-5 sm:px-5">
            <Button variant="ghost" onClick={() => setAbandoning(true)}>
              <Ban size={17} aria-hidden />
              Abandon
            </Button>
            <span className="ml-auto text-body text-ink-70">
              {summary.uncounted > 0 ? `${summary.uncounted} lines not counted — they will not be adjusted.` : "Every line counted."}
            </span>
            {!reviewing ? (
              <Button
                onClick={() => {
                  setReviewing(true);
                  if (sheet.blind) reveal(sheet.id);
                  setNotice(null);
                }}
                disabled={summary.counted === 0}
              >
                <Eye size={18} aria-hidden />
                Review variances
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setReviewing(false)}>Keep counting</Button>
                <Button onClick={() => setConfirming(true)} disabled={!staff}>
                  <Send size={18} aria-hidden />
                  Post {summary.short + summary.over} {summary.short + summary.over === 1 ? "adjustment" : "adjustments"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {confirming && (
        <Sheet
          title="Post this count?"
          subtitle={sheet.reference}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)} className="flex-1">Back</Button>
              <Button onClick={post} className="flex-2">
                <Send size={18} aria-hidden />
                Post to the ledger
              </Button>
            </>
          }
        >
          <p className="text-body text-ink-70">
            {summary.short + summary.over} count adjustments will be appended to the stock ledger under{" "}
            <span className="font-mono text-ink">{sheet.reference}</span>, with your name. Net{" "}
            <span className={cn("font-numeric font-semibold", summary.netValue.kobo < 0 ? "text-halt" : "text-ink")}>{formatWhole(summary.netValue)}</span>{" "}
            at cost. {summary.uncounted > 0 && `${summary.uncounted} uncounted lines are left as they are.`}
          </p>
          {summary.recounts > 0 && (
            <Alert tone="signal" title={`${summary.recounts} lines flagged for a recount`}>
              They are more than 10% out. A second count of just those lines catches most miscounts before they become adjustments.
            </Alert>
          )}
          <p className="text-body text-ink-40">
            Posting cannot be undone, only corrected by a later count — both stay on the record.
          </p>
        </Sheet>
      )}

      {abandoning && staff && (
        <AbandonSheet
          onClose={() => setAbandoning(false)}
          onConfirm={(note) => {
            abandon(sheet.id, staff.fullName, new Date().toISOString(), note);
            setAbandoning(false);
          }}
        />
      )}
    </main>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function BackLink() {
  return (
    <Link
      href="/manager/counts"
      className="inline-flex min-h-touch-admin items-center gap-2 rounded-input px-2 font-medium text-ink-70 transition-colors duration-150 hover:bg-market-tint hover:text-ink focus-visible:outline-2 focus-visible:outline-market"
    >
      <ArrowLeft size={18} aria-hidden />
      All counts
    </Link>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
  children,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "halt";
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-panel border border-line bg-surface p-4 shadow-raised">
      <p className="text-label uppercase text-ink-40">{label}</p>
      <p className={cn("mt-1.5 font-display text-display-md whitespace-nowrap", tone === "halt" ? "text-halt" : "text-ink")}>{value}</p>
      <p className="text-body text-ink-40">{hint}</p>
      {children}
    </div>
  );
}

function ScanBox({ onScan }: { onScan: (code: string) => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onScan(value);
        setValue("");
        ref.current?.focus();
      }}
      className="relative md:w-80"
    >
      <ScanBarcode size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-market" />
      <input
        ref={ref}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Scan to count one"
        aria-label="Scan a barcode to count one item"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus
        className="min-h-touch-admin w-full rounded-input border-2 border-market/40 bg-surface pr-4 pl-10 text-body text-ink placeholder:text-ink-40 focus:border-market focus:outline-none"
      />
    </form>
  );
}

function CountInput({
  product,
  value,
  onChange,
  onStep,
}: {
  product: Product;
  value: string;
  onChange: (text: string) => void;
  onStep: (by: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const weighed = product.soldBy === "weight";
  return (
    <div className="mx-auto flex w-fit items-center gap-1">
      {!weighed && (
        <button
          type="button"
          onClick={() => onStep(-1)}
          aria-label={`One fewer ${product.name}`}
          className="grid size-touch-admin place-items-center rounded-input border border-line bg-surface text-ink-70 hover:border-ink-40 focus-visible:outline-2 focus-visible:outline-market"
        >
          <Minus size={16} />
        </button>
      )}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={weighed ? 0.001 : 1}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null) onChange(draft);
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        placeholder="—"
        aria-label={`Counted ${product.name}, in ${product.unit}`}
        className="min-h-touch-admin w-24 rounded-input border border-line bg-surface px-2 text-center font-numeric text-body-lg font-semibold text-ink placeholder:font-normal placeholder:text-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
      />
      {!weighed ? (
        <button
          type="button"
          onClick={() => onStep(1)}
          aria-label={`One more ${product.name}`}
          className="grid size-touch-admin place-items-center rounded-input border border-line bg-surface text-ink-70 hover:border-ink-40 focus-visible:outline-2 focus-visible:outline-market"
        >
          <Plus size={16} />
        </button>
      ) : (
        <span className="w-8 text-ink-40">{product.unit}</span>
      )}
    </div>
  );
}

function AbandonSheet({ onClose, onConfirm }: { onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  return (
    <Sheet
      title="Abandon this count?"
      subtitle="Nothing is posted. The sheet is kept, marked abandoned, with your reason."
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (note.trim().length >= 5) onConfirm(note.trim());
      }}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Keep counting</Button>
          <Button type="submit" variant="danger" className="flex-2">
            <Ban size={17} aria-hidden />
            Abandon count
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-body font-semibold text-ink">Why?</span>
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Delivery arrived mid-count; restarting this afternoon"
          aria-invalid={tried && note.trim().length < 5 ? true : undefined}
          className={cn(
            "rounded-input border bg-surface px-4 py-3 text-body text-ink focus:outline-2 focus:outline-market",
            tried && note.trim().length < 5 ? "border-halt" : "border-line",
          )}
        />
        {tried && note.trim().length < 5 && <span className="text-body text-halt">Say why, so the next person knows.</span>}
      </label>
    </Sheet>
  );
}
