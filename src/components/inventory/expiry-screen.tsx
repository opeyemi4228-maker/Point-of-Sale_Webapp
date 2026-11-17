"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  CalendarX2,
  History,
  CircleCheck,
  Lock,
  PackageMinus,
  ScrollText,
  Undo2,
} from "lucide-react";
import { AdjustStockSheet, type AdjustPreset } from "@/components/inventory/adjust-stock-sheet";
import {
  CatalogFilter,
  Chip,
  ScopeControls,
  matchesCatalog,
  useCatalogFilter,
} from "@/components/inventory/scope-controls";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportMenu } from "@/components/ui/export-menu";
import { moneyCell, qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { TableScroller } from "@/components/ui/table-scroller";
import {
  daysBetween,
  batchesOnHand,
  planAdjustment,
  writeOffRegister,
  type Batch,
  type WriteOff,
} from "@/lib/domain/inventory";
import { formatWhole, multiply, sum } from "@/lib/domain/money";
import { ZERO_QTY, formatQty, toNumber, units } from "@/lib/domain/quantity";
import { STOCK_REASON_LABEL, balancesForBranch } from "@/lib/domain/stock";
import { useWorkspaceProducts } from "@/lib/data/workspace-data";
import {
  ALL_BRANCHES,
  documentRef,
  useCostOf,
  useDayRange,
  useInventoryScope,
  useScopedLedger,
} from "@/lib/hooks/use-inventory";
import { useLedgerStore } from "@/lib/stores/ledger";
import { dayDate, dayHeading, isoDay, longDate, relativeTime, shortTime, stamp } from "@/lib/utils/format-date";
import { useNow } from "@/lib/hooks/use-now";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";
import type { StockEntry } from "@/types/stock";
import type { StockReason } from "@/types/enums";

/**
 * Expiry and write-offs — SPEC §10.
 *
 * Two halves of one job. The top half finds stock whose date has come — every
 * dated batch still estimated to be on the shelf — and lets the manager say how
 * many units they actually pulled, then writes them off in one action. The
 * bottom half is the write-off register: every expired, damaged, stolen or
 * sampled unit, with who, when and why.
 *
 * The register is protected. Nothing in it can be edited or deleted (CLAUDE.md
 * rule 4); a write-off made in error is reversed by a correction that points
 * at it, and both stay on the record side by side.
 */

const SOON_DAYS = 7;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How long after its best-before a batch came off the shelf, in words. */
function pulledAfter(expiresOn: string, at: string): string {
  const late = daysBetween(expiresOn, isoDay(at));
  if (late === 0) return "Pulled on its expiry day";
  if (late < 0) return `Pulled ${plural(-late, "day", "days")} before expiry`;
  return `Pulled ${plural(late, "day", "days")} after expiry`;
}

/**
 * When something came off the shelf: the time large, the date under it, and
 * how long ago — the three things a manager checking the register looks for,
 * in the order they look.
 */
function RemovedAt({ at, now }: { at: string; now: number | null }) {
  return (
    <time dateTime={at} className="block whitespace-nowrap">
      <span className="block font-numeric text-title font-bold leading-tight text-ink">{shortTime(at)}</span>
      <span className="block text-label tracking-normal text-ink-70">{dayDate(at)}</span>
      {now !== null && (
        <span className="block text-label tracking-normal text-ink-40">{relativeTime(at, now)}</span>
      )}
    </time>
  );
}

type Tab = "expired" | "soon" | "register";

export function ExpiryScreen({ today }: { today: string }) {
  const scope = useInventoryScope({ allowAll: true });
  const { entries } = useScopedLedger(scope.branchId);
  const products = useWorkspaceProducts();
  const costOf = useCostOf(products);
  const appendMovements = useLedgerStore((s) => s.appendMovements);
  const dates = useDayRange(today, "all");
  const now = useNow();
  const { range } = dates;
  const [catalog, setCatalog] = useCatalogFilter();

  const [tab, setTab] = useState<Tab>("expired");
  const [notice, setNotice] = useState<string | null>(null);
  const [reversing, setReversing] = useState<WriteOff | null>(null);
  const [reasonFilter, setReasonFilter] = useState<StockReason | "all">("all");

  /** Picked batches and how many units the manager says they pulled. */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const branchById = useMemo(() => new Map(scope.branches.map((b) => [b.id, b])), [scope.branches]);
  const showBranch = scope.branchId === ALL_BRANCHES;

  const inCatalog = useCallback(
    (productId: string) => {
      const p = productById.get(productId);
      return p ? matchesCatalog(p, catalog) : false;
    },
    [productById, catalog],
  );

  const batches = useMemo(
    () =>
      batchesOnHand(entries, { today, soonDays: SOON_DAYS }).filter((b) => inCatalog(b.productId)),
    [entries, today, inCatalog],
  );
  const expired = batches.filter((b) => b.status === "expired");
  const soon = batches.filter((b) => b.status === "soon");

  const register = useMemo(
    () => writeOffRegister(entries, costOf).filter((w) => inCatalog(w.entry.productId)),
    [entries, costOf, inCatalog],
  );
  const registerInRange = useMemo(() => {
    const from = Date.parse(range.instants.from);
    const to = Date.parse(range.instants.to);
    return register.filter((w) => {
      const t = Date.parse(w.entry.at);
      return t >= from && t < to;
    });
  }, [register, range]);
  const registerShown = registerInRange.filter(
    (w) => reasonFilter === "all" || w.entry.reason === reasonFilter,
  );

  /** On hand per branch-and-product, for capping removals at the ledger. */
  const onHandOf = useMemo(() => {
    const byBranch = new Map(
      [...new Set(entries.map((e) => e.branchId))].map((id) => [id, balancesForBranch(entries, id)]),
    );
    return (branchId: string, productId: string) =>
      byBranch.get(branchId)?.get(productId)?.onHand ?? ZERO_QTY;
  }, [entries]);

  const valueOf = (batch: Batch) => multiply(costOf(batch.productId), toNumber(batch.remaining));
  const expiredValue = sum(expired.map(valueOf));
  const soonValue = sum(soon.map(valueOf));
  const writtenOff = registerInRange.filter((w) => !w.reversedBy);

  /** Every expired-stock removal that stands (not reversed), newest first. */
  const removals = useMemo(
    () => register.filter((w) => w.entry.reason === "EXPIRY" && !w.reversedBy),
    [register],
  );
  const lastRemoval = removals[0] ?? null;

  /** What has already been pulled from each batch, and when it last was. */
  const pulledFromBatch = useMemo(() => {
    const map = new Map<string, { last: WriteOff; milli: number; times: number }>();
    for (const w of removals) {
      if (!w.entry.expiresOn) continue;
      const key = `${w.entry.branchId}|${w.entry.productId}|${w.entry.expiresOn}`;
      const cur = map.get(key);
      if (cur) {
        cur.milli += -w.entry.delta.milli;
        cur.times += 1;
      } else {
        map.set(key, { last: w, milli: -w.entry.delta.milli, times: 1 });
      }
    }
    return map;
  }, [removals]);

  /** The register, one group per Lagos day, newest day first. */
  const registerByDay = useMemo(() => {
    const groups: { day: string; items: WriteOff[] }[] = [];
    for (const w of registerShown) {
      const day = isoDay(w.entry.at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(w);
      else groups.push({ day, items: [w] });
    }
    return groups;
  }, [registerShown]);
  const expiryWrittenOff = sum(
    writtenOff.filter((w) => w.entry.reason === "EXPIRY").map((w) => w.value),
  );

  /* ── Selecting what to pull ─────────────────────────────────────────────── */

  const pickedBatches = expired.filter((b) => picked[b.entryId] !== undefined);
  const allPicked = expired.length > 0 && pickedBatches.length === expired.length;

  function toggle(batch: Batch) {
    setProblems([]);
    setPicked((current) => {
      const next = { ...current };
      if (next[batch.entryId] !== undefined) delete next[batch.entryId];
      else next[batch.entryId] = String(toNumber(batch.remaining));
      return next;
    });
  }

  function toggleAll() {
    setProblems([]);
    setPicked(
      allPicked
        ? {}
        : Object.fromEntries(expired.map((b) => [b.entryId, String(toNumber(b.remaining))])),
    );
  }

  const pickedValue = sum(
    pickedBatches.map((b) => multiply(costOf(b.productId), Number(picked[b.entryId]) || 0)),
  );

  /**
   * Validate every picked line, then append one `EXPIRY` movement each under a
   * single write-off reference per branch. Two batches of the same product are
   * checked against on-hand together, so they cannot jointly remove more than
   * the shelf holds.
   */
  function writeOff() {
    if (!scope.staff) return;
    const found: string[] = [];
    const claimed = new Map<string, number>();
    const movements: Omit<StockEntry, "id">[] = [];
    const at = new Date();
    const refs = new Map<string, string>();

    for (const batch of pickedBatches) {
      const product = productById.get(batch.productId);
      if (!product) continue;
      const key = `${batch.branchId}|${batch.productId}`;
      const already = claimed.get(key) ?? 0;
      const onHand = onHandOf(batch.branchId, batch.productId);
      const quantity = Number(picked[batch.entryId]);

      const plan = planAdjustment({
        direction: "remove",
        reason: "EXPIRY",
        quantity,
        soldBy: product.soldBy,
        onHand: { milli: onHand.milli - already },
        note: "",
      });
      if (!plan.ok) {
        found.push(`${product.name}: ${plan.problems[0].message}`);
        continue;
      }
      claimed.set(key, already + units(quantity).milli);

      let ref = refs.get(batch.branchId);
      if (!ref) {
        ref = documentRef("WO", branchById.get(batch.branchId)?.code ?? "BR", at);
        refs.set(batch.branchId, ref);
      }

      movements.push({
        branchId: batch.branchId,
        productId: batch.productId,
        delta: plan.delta,
        reason: "EXPIRY",
        at: at.toISOString(),
        staffId: scope.staff.id,
        staffName: scope.staff.fullName,
        ref,
        note: `Best before ${dayDate(batch.expiresOn)}${batch.ref ? ` · batch ${batch.ref}` : ""}`,
        expiresOn: batch.expiresOn,
      });
    }

    if (found.length > 0) {
      setProblems(found);
      setConfirming(false);
      return;
    }

    appendMovements(movements);
    setPicked({});
    setConfirming(false);
    setProblems([]);
    setNotice(
      `Removed ${movements.length} expired ${movements.length === 1 ? "line" : "lines"} at ${shortTime(at.toISOString())} on ${longDate(at.toISOString())} — ${formatWhole(pickedValue)} at cost. Recorded under ${[...refs.values()].join(", ")} in the protected register.`,
    );
  }

  /* ── Reversal ───────────────────────────────────────────────────────────── */

  const reversingProduct: Product | undefined = reversing
    ? productById.get(reversing.entry.productId)
    : undefined;
  const reversePreset: AdjustPreset | undefined = reversing
    ? {
        direction: "add",
        reason: "CORRECTION",
        quantity: -reversing.entry.delta.milli / 1000,
        note: `Reversal of ${reversing.entry.ref ?? "write-off"} — `,
        ref: reversing.entry.id,
        locked: true,
        title: "Reverse a write-off",
      }
    : undefined;

  /** Expiry and loss report: what to pull, what to sell first, what was lost. */
  const buildReport = (): ReportSpec => {
    const scopeName = showBranch ? "All branches" : (scope.branch?.name ?? "Branch");
    const batchRows = (list: Batch[]) =>
      list.map((b) => {
        const p = productById.get(b.productId);
        return [
          p?.sku ?? "—",
          p?.name ?? b.productId,
          ...(showBranch ? [branchById.get(b.branchId)?.name ?? b.branchId] : []),
          b.expiresOn,
          b.daysLeft <= 0 ? { text: b.daysLeft === 0 ? "Today" : `${-b.daysLeft} days ago`, tone: "halt" as const } : `${b.daysLeft} days`,
          qtyCell(b.remaining, p?.unit),
          moneyCell(valueOf(b)),
          b.ref ?? "—",
        ];
      });
    const batchColumns = [
      { header: "Part no.", mono: true, width: 9 },
      { header: "Product", width: 24 },
      ...(showBranch ? [{ header: "Branch", width: 11 }] : []),
      { header: "Best before", width: 10 },
      { header: "When", width: 10 },
      { header: "Est. on shelf", align: "right" as const, width: 10 },
      { header: "Value at cost", align: "right" as const, width: 11 },
      { header: "Delivered on", mono: true, width: 15 },
    ];
    return {
      title: "Expiry & write-offs",
      subtitle: `${scopeName} · stock past or near its date, and the write-off register`,
      filename: reportFilename("expiry-write-offs", showBranch ? "chain" : scope.branch?.code, today),
      orientation: "landscape",
      meta: [
        { label: "Scope", value: scopeName },
        { label: "As at", value: today },
        { label: "Register period", value: `${range.label} · ${range.fromDay} to ${range.toDay}` },
        { label: "Register reasons", value: reasonFilter === "all" ? "Every reason" : STOCK_REASON_LABEL[reasonFilter] },
      ],
      summary: [
        { label: "Expired on shelf", value: formatWhole(expiredValue), hint: plural(expired.length, "batch", "batches") },
        { label: `Expiring in ${SOON_DAYS} days`, value: formatWhole(soonValue), hint: plural(soon.length, "batch", "batches") },
        {
          label: "Written off",
          value: formatWhole(sum(registerShown.filter((w) => !w.reversedBy).map((w) => w.value))),
          hint: `${registerShown.length} entries in the period`,
        },
      ],
      tables: [
        { heading: "Expired — pull from the shelf", columns: batchColumns, rows: batchRows(expired), empty: "Nothing on the shelf is past its date." },
        { heading: `Expiring in the next ${SOON_DAYS} days — sell first`, columns: batchColumns, rows: batchRows(soon), empty: "Nothing is close to its date." },
        {
          heading: "Write-off register",
          note: "Protected: entries are never edited or deleted, only reversed. Reversed entries are shown and excluded from the total.",
          columns: [
            { header: "Removed at", width: 13 },
            { header: "Part no.", mono: true, width: 9 },
            { header: "Product", width: 18 },
            ...(showBranch ? [{ header: "Branch", width: 10 }] : []),
            { header: "Reason", width: 15 },
            { header: "Qty", align: "right" as const, width: 8 },
            { header: "Value", align: "right" as const, width: 9 },
            { header: "By", width: 11 },
            { header: "Status", width: 10 },
          ],
          rows: registerShown.map((w) => {
            const p = productById.get(w.entry.productId);
            return [
              stamp(w.entry.at),
              p?.sku ?? "—",
              p?.name ?? w.entry.productId,
              ...(showBranch ? [branchById.get(w.entry.branchId)?.name ?? w.entry.branchId] : []),
              w.entry.expiresOn
                ? `${STOCK_REASON_LABEL[w.entry.reason]} — best before ${dayDate(w.entry.expiresOn)}, ${pulledAfter(w.entry.expiresOn, w.entry.at).toLowerCase()}`
                : STOCK_REASON_LABEL[w.entry.reason],
              qtyCell(w.entry.delta, p?.unit),
              moneyCell(w.value, { tone: w.reversedBy ? "muted" : undefined }),
              w.entry.staffName,
              w.reversedBy ? { text: "Reversed", tone: "muted" as const } : "Stands",
            ];
          }),
          empty: "No write-offs in this period.",
        },
      ],
      footnote:
        "On-shelf quantities per batch are estimated first-in, first-out from the ledger; confirm on the shelf before writing off.",
    };
  };

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-5 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <ScopeControls scope={scope} allowAll />
        <CatalogFilter products={products} value={catalog} onChange={setCatalog} />
        <div className="ml-auto">
          <ExportMenu build={buildReport} />
        </div>
      </div>

      <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <StatTile icon={CalendarX2} label="Expired on shelf" value={formatWhole(expiredValue)} hint={`${plural(expired.length, "batch", "batches")} to pull`} />
        </Panel>
        <Panel>
          <StatTile icon={CalendarClock} label={`Expiring in ${SOON_DAYS} days`} value={formatWhole(soonValue)} hint={`${plural(soon.length, "batch", "batches")} — sell first`} />
        </Panel>
        <Panel>
          <StatTile
            icon={PackageMinus}
            label="Expired, written off"
            value={formatWhole(expiryWrittenOff)}
            hint={lastRemoval ? `Last removed ${stamp(lastRemoval.entry.at)}` : `${range.label} · nothing removed yet`}
          />
        </Panel>
        <Panel>
          <StatTile icon={ScrollText} label="All write-offs" value={formatWhole(sum(writtenOff.map((w) => w.value)))} hint={`${plural(writtenOff.length, "record", "records")} · ${range.label}`} />
        </Panel>
      </div>

      {notice && <Alert tone="market">{notice}</Alert>}

      <div role="tablist" aria-label="Expiry views" className="flex flex-wrap gap-2">
        <Chip active={tab === "expired"} onClick={() => setTab("expired")} count={expired.length}>
          Expired — pull now
        </Chip>
        <Chip active={tab === "soon"} onClick={() => setTab("soon")} count={soon.length}>
          Expiring soon
        </Chip>
        <Chip active={tab === "register"} onClick={() => setTab("register")} count={registerInRange.length}>
          Write-off register
        </Chip>
      </div>

      {tab === "expired" && (
        <Panel>
          <PanelHeader
            title="Expired stock still on the shelf"
            meta="Estimated first-in, first-out from deliveries. Count what you actually pull and key that number."
          />

          {expired.length === 0 ? (
            <EmptyState
              icon={CircleCheck}
              title="Nothing past its date"
              detail="Every dated batch received is either sold through or still in date. Batches appear here on their expiry day."
            />
          ) : (
            <>
              <TableScroller>
                <table className="w-full min-w-200 text-left">
                  <thead>
                    <tr className="border-b border-line text-label uppercase text-ink-40">
                      <th scope="col" className="w-12 py-3 pl-5">
                        <input
                          type="checkbox"
                          checked={allPicked}
                          onChange={toggleAll}
                          aria-label="Select every expired batch"
                          className="size-5 accent-market"
                        />
                      </th>
                      <th scope="col" className="px-3 py-3 font-semibold">Product</th>
                      {showBranch && <th scope="col" className="px-3 py-3 font-semibold">Branch</th>}
                      <th scope="col" className="px-3 py-3 font-semibold">Best before</th>
                      <th scope="col" className="px-3 py-3 font-semibold">Batch</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">Est. on shelf</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">Remove</th>
                      <th scope="col" className="px-5 py-3 text-right font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {expired.map((batch) => {
                      const product = productById.get(batch.productId);
                      const isPicked = picked[batch.entryId] !== undefined;
                      return (
                        <tr key={batch.entryId} className={cn("hover:bg-paper", isPicked && "bg-halt-tint/40")}>
                          <td className="py-3 pl-5">
                            <input
                              type="checkbox"
                              checked={isPicked}
                              onChange={() => toggle(batch)}
                              aria-label={`Select ${product?.name ?? batch.productId}, best before ${dayDate(batch.expiresOn)}`}
                              className="size-5 accent-market"
                            />
                          </td>
                          <th scope="row" className="px-3 py-3 font-medium text-ink">
                            {product?.name ?? batch.productId}
                            <span className="block font-mono text-label tracking-normal text-ink-40">{product?.sku}</span>
                          </th>
                          {showBranch && (
                            <td className="px-3 py-3 text-ink-70">{branchById.get(batch.branchId)?.name}</td>
                          )}
                          <td className="px-3 py-3">
                            <span className="block whitespace-nowrap text-ink">{dayDate(batch.expiresOn)}</span>
                            <span className="inline-flex items-center gap-1 text-label tracking-normal font-semibold text-halt">
                              <CalendarX2 size={13} aria-hidden />
                              {batch.daysLeft === 0 ? "Expires today" : `Expired ${-batch.daysLeft} ${batch.daysLeft === -1 ? "day" : "days"} ago`}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="block font-mono text-label tracking-normal text-ink-70">{batch.ref ?? "—"}</span>
                            <span className="block text-label tracking-normal text-ink-40">
                              {batch.source?.name ?? "Opening stock"} · {dayDate(batch.receivedAt)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className="block font-numeric text-ink-70">
                              {formatQty(batch.remaining)} {product?.unit}
                            </span>
                            {(() => {
                              const pulled = pulledFromBatch.get(`${batch.branchId}|${batch.productId}|${batch.expiresOn}`);
                              return pulled ? (
                                <span className="mt-1 inline-flex items-center gap-1 text-label tracking-normal text-ink-40">
                                  <History size={13} aria-hidden />
                                  {formatQty({ milli: pulled.milli })} pulled · last {stamp(pulled.last.entry.at)}
                                </span>
                              ) : null;
                            })()}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step={product?.soldBy === "weight" ? 0.001 : 1}
                              disabled={!isPicked}
                              value={isPicked ? picked[batch.entryId] : ""}
                              placeholder="—"
                              onChange={(event) =>
                                setPicked((current) => ({ ...current, [batch.entryId]: event.target.value }))
                              }
                              aria-label={`Units of ${product?.name ?? batch.productId} to write off`}
                              className="min-h-touch-admin w-24 rounded-input border border-line bg-surface px-3 text-right font-numeric text-body text-ink transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market disabled:bg-paper"
                            />
                          </td>
                          <td className="px-5 py-3 text-right font-numeric text-ink">{formatWhole(valueOf(batch))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroller>

              {problems.length > 0 && (
                <div className="border-t border-line p-4">
                  <Alert tone="halt" title="Nothing was written off — fix these first">
                    <ul className="list-disc pl-4">
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </Alert>
                </div>
              )}

              <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-4">
                <p className="text-body text-ink-70">
                  {pickedBatches.length === 0 ? (
                    "Tick the batches you have pulled, and correct the count if the shelf differs."
                  ) : (
                    <>
                      <span className="font-semibold text-ink">{pickedBatches.length}</span> selected ·{" "}
                      <span className="font-numeric font-semibold text-ink">{formatWhole(pickedValue)}</span> at cost
                    </>
                  )}
                </p>
                {confirming ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 text-body font-medium text-ink">
                      <Lock size={16} aria-hidden />
                      Permanent record. Write off?
                    </span>
                    <Button variant="secondary" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                    <Button variant="danger" onClick={writeOff}>
                      <PackageMinus size={18} aria-hidden />
                      Confirm write-off
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="danger"
                    disabled={pickedBatches.length === 0 || !scope.staff}
                    onClick={() => setConfirming(true)}
                  >
                    <PackageMinus size={18} aria-hidden />
                    Write off {pickedBatches.length || ""} as expired
                  </Button>
                )}
              </div>
            </>
          )}
        </Panel>
      )}

      {tab === "expired" && removals.length > 0 && (
        <Panel>
          <PanelHeader
            title="Recently removed"
            meta="Expired stock taken off the shelf — newest first"
            action={
              <Button variant="ghost" onClick={() => setTab("register")}>
                Full register
              </Button>
            }
          />
          <ul className="divide-y divide-line">
            {removals.slice(0, 5).map((w) => {
              const product = productById.get(w.entry.productId);
              return (
                <li key={w.entry.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3">
                  <RemovedAt at={w.entry.at} now={now} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{product?.name ?? w.entry.productId}</span>
                    <span className="block truncate text-label tracking-normal text-ink-40">
                      {w.entry.expiresOn ? `${pulledAfter(w.entry.expiresOn, w.entry.at)} · ` : ""}
                      by {w.entry.staffName}
                      {showBranch ? ` · ${branchById.get(w.entry.branchId)?.name ?? ""}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-numeric font-semibold whitespace-nowrap text-ink">
                      {formatQty({ milli: -w.entry.delta.milli })} {product?.unit}
                    </span>
                    <span className="block font-numeric text-label tracking-normal text-ink-40">{formatWhole(w.value)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {tab === "soon" && (
        <Panel>
          <PanelHeader
            title={`Expiring in the next ${SOON_DAYS} days`}
            meta="Move these to the front of the shelf, or mark them down, before they become a write-off"
          />
          {soon.length === 0 ? (
            <EmptyState icon={CircleCheck} title="Nothing close to its date" detail={`No dated batch on the shelf expires in the next ${SOON_DAYS} days.`} />
          ) : (
            <TableScroller>
              <table className="w-full min-w-160 text-left">
                <thead>
                  <tr className="border-b border-line text-label uppercase text-ink-40">
                    <th scope="col" className="px-5 py-3 font-semibold">Product</th>
                    {showBranch && <th scope="col" className="px-3 py-3 font-semibold">Branch</th>}
                    <th scope="col" className="px-3 py-3 font-semibold">Best before</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Batch</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Est. on shelf</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Value at risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {soon.map((batch) => {
                    const product = productById.get(batch.productId);
                    return (
                      <tr key={batch.entryId} className="hover:bg-paper">
                        <th scope="row" className="px-5 py-3 font-medium text-ink">{product?.name ?? batch.productId}</th>
                        {showBranch && <td className="px-3 py-3 text-ink-70">{branchById.get(batch.branchId)?.name}</td>}
                        <td className="px-3 py-3">
                          <span className="block text-ink">{dayDate(batch.expiresOn)}</span>
                          <StatusPill tone="warning" className="mt-1">
                            {batch.daysLeft} {batch.daysLeft === 1 ? "day" : "days"} left
                          </StatusPill>
                        </td>
                        <td className="px-3 py-3 font-mono text-label tracking-normal text-ink-70">{batch.ref ?? "—"}</td>
                        <td className="px-3 py-3 text-right font-numeric text-ink-70">
                          {formatQty(batch.remaining)} {product?.unit}
                        </td>
                        <td className="px-5 py-3 text-right font-numeric text-ink">{formatWhole(valueOf(batch))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
          )}
        </Panel>
      )}

      {tab === "register" && (
        <Panel>
          <PanelHeader
            title="Write-off register"
            meta={
              <span className="inline-flex items-center gap-1.5">
                <Lock size={14} aria-hidden />
                Protected — entries are never edited or deleted, only reversed
              </span>
            }
          />
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
            <ScopeControls allowAll dates={dates} />
            <span aria-hidden className="mx-1 h-6 w-px bg-line" />
            {(["all", "EXPIRY", "DAMAGE", "THEFT", "SAMPLE"] as const).map((r) => (
              <Chip key={r} active={reasonFilter === r} onClick={() => setReasonFilter(r)}>
                {r === "all" ? "Every reason" : STOCK_REASON_LABEL[r]}
              </Chip>
            ))}
          </div>

          {registerShown.length === 0 ? (
            <EmptyState icon={ScrollText} title="No write-offs in this window" detail="Expired, damaged, stolen and sampled stock is recorded here the moment it is written off." />
          ) : (
            <TableScroller>
              <table className="w-full min-w-240 text-left">
                <thead>
                  <tr className="border-b border-line text-label uppercase text-ink-40">
                    <th scope="col" className="px-5 py-3 font-semibold">Removed at</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Product</th>
                    {showBranch && <th scope="col" className="px-3 py-3 font-semibold">Branch</th>}
                    <th scope="col" className="px-3 py-3 font-semibold">Reason</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Qty</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Value</th>
                    <th scope="col" className="px-3 py-3 font-semibold">By · note</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                {registerByDay.map((group) => {
                  const standing = group.items.filter((w) => !w.reversedBy);
                  return (
                    <tbody key={group.day} className="divide-y divide-line">
                      <tr className="bg-paper">
                        <th scope="rowgroup" colSpan={showBranch ? 8 : 7} className="px-5 py-2.5 text-left">
                          <span className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="flex items-center gap-2 font-semibold text-ink">
                              <CalendarDays size={16} aria-hidden className="text-ink-40" />
                              {dayHeading(group.day, today)}
                              {dayHeading(group.day, today) !== longDate(`${group.day}T12:00:00Z`) && (
                                <span className="font-normal text-ink-40">· {longDate(`${group.day}T12:00:00Z`)}</span>
                              )}
                            </span>
                            <span className="text-label font-normal tracking-normal text-ink-70">
                              {plural(group.items.length, "removal", "removals")} ·{" "}
                              <span className="font-numeric font-semibold text-ink">
                                {formatWhole(sum(standing.map((w) => w.value)))}
                              </span>
                            </span>
                          </span>
                        </th>
                      </tr>
                      {group.items.map((w) => {
                        const product = productById.get(w.entry.productId);
                        return (
                          <tr key={w.entry.id} className={cn("align-top hover:bg-paper", w.reversedBy && "text-ink-40")}>
                            <td className="px-5 py-3">
                              <RemovedAt at={w.entry.at} now={now} />
                              <span className="mt-1 block font-mono text-label tracking-normal text-ink-40">{w.entry.ref ?? "—"}</span>
                            </td>
                            <th scope="row" className="px-3 py-3 font-medium text-ink">{product?.name ?? w.entry.productId}</th>
                            {showBranch && <td className="px-3 py-3 text-ink-70">{branchById.get(w.entry.branchId)?.name}</td>}
                            <td className="px-3 py-3">
                              <span className="block text-ink-70">{STOCK_REASON_LABEL[w.entry.reason]}</span>
                              {w.entry.expiresOn && (
                                <span className="block text-label tracking-normal text-ink-40">
                                  Best before {dayDate(w.entry.expiresOn)}
                                  <span className="block font-semibold text-ink-70">{pulledAfter(w.entry.expiresOn, w.entry.at)}</span>
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-numeric font-semibold whitespace-nowrap text-ink">
                              {formatQty(w.entry.delta)} {product?.unit}
                            </td>
                            <td className={cn("px-3 py-3 text-right font-numeric", w.reversedBy ? "line-through" : "text-ink")}>
                              {formatWhole(w.value)}
                            </td>
                            <td className="px-3 py-3 text-ink-70">
                              {w.entry.staffName}
                              {w.entry.note && <span className="block text-body text-ink-40">{w.entry.note}</span>}
                            </td>
                            <td className="px-5 py-2">
                              {w.reversedBy ? (
                                <span className="block">
                                  <StatusPill tone="stopped">Reversed</StatusPill>
                                  <span className="mt-1 block text-label tracking-normal text-ink-40">
                                    {w.reversedBy.staffName} · {stamp(w.reversedBy.at)}
                                  </span>
                                </span>
                              ) : (
                                <span className="flex flex-wrap items-center gap-2">
                                  <StatusPill tone="done">
                                    <Lock size={12} aria-hidden className="-ml-0.5" />
                                    Protected
                                  </StatusPill>
                                  {scope.staff && product && (
                                    <button
                                      type="button"
                                      onClick={() => setReversing(w)}
                                      aria-label={`Reverse write-off of ${product.name}`}
                                      className="inline-flex min-h-touch-admin items-center gap-1 rounded-input px-2 font-medium text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-market-tint hover:text-ink focus-visible:outline-2 focus-visible:outline-market"
                                    >
                                      <Undo2 size={15} aria-hidden />
                                      Reverse
                                    </button>
                                  )}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  );
                })}
              </table>
            </TableScroller>
          )}
        </Panel>
      )}

      {reversing && reversingProduct && reversePreset && scope.staff && (
        <AdjustStockSheet
          product={reversingProduct}
          branchId={reversing.entry.branchId}
          branchCode={branchById.get(reversing.entry.branchId)?.code ?? "BR"}
          onHand={onHandOf(reversing.entry.branchId, reversing.entry.productId)}
          staff={scope.staff}
          preset={reversePreset}
          onClose={() => setReversing(null)}
          onDone={(message) => {
            setReversing(null);
            setNotice(`${message} The original write-off stays in the register, marked reversed.`);
          }}
        />
      )}
    </div>
    </main>
  );
}
