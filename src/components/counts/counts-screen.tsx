"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  EyeOff,
  Layers,
  ListChecks,
  RefreshCcw,
  Store,
  TriangleAlert,
} from "lucide-react";
import { ScopeControls } from "@/components/inventory/scope-controls";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { TableScroller } from "@/components/ui/table-scroller";
import { useWorkspaceProducts } from "@/lib/data/workspace-data";
import { countVariance, cutCountLines, lastCountedByProduct, pickCycleLines, type StockCountSheet } from "@/lib/domain/counting";
import { batchesOnHand } from "@/lib/domain/inventory";
import { formatWhole } from "@/lib/domain/money";
import { formatBasisPoints } from "@/lib/domain/product-master";
import { ZERO_QTY } from "@/lib/domain/quantity";
import { balancesForBranch, isLow, isOversold } from "@/lib/domain/stock";
import { useCostOf, useInventoryScope, useScopedLedger } from "@/lib/hooks/use-inventory";
import { useCountStore, useCountsHydrated } from "@/lib/stores/counts";
import { stamp } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";

/**
 * Stock counts — SPEC §10.3, §15.2.
 *
 * Where shrinkage is found. A manager starts a count, the team walks the
 * shelves with the sheet (on a tablet, scanning, or on paper), and the
 * variances post to the ledger as `COUNT_ADJUSTMENT` movements with the
 * count's reference on every one.
 *
 * Four ways to start, because there are four reasons to count: the annual
 * full stock-take, one aisle that looks wrong, the lines already flagged as
 * problems, and the weekly cycle count that keeps the other three rare.
 */

type ScopeKind = "full" | "category" | "attention" | "cycle";
const CYCLE_SIZE = 12;

export function CountsScreen({ today }: { today: string }) {
  const router = useRouter();
  const scope = useInventoryScope({ allowAll: false });
  const { staff, branch } = scope;
  const { entries } = useScopedLedger(branch?.id ?? "none");
  const products = useWorkspaceProducts();
  const costOf = useCostOf(products);
  const hydrated = useCountsHydrated();
  const allSheets = useCountStore((s) => s.sheets);
  const start = useCountStore((s) => s.start);
  const [starting, setStarting] = useState(false);

  const sheets = useMemo(
    () =>
      Object.values(allSheets)
        .filter((s) => s.branchId === branch?.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [allSheets, branch?.id],
  );
  const open = sheets.filter((s) => s.status === "counting");
  const closed = sheets.filter((s) => s.status !== "counting");
  const now = new Date().toISOString();

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          {scope.canPick && <ScopeControls scope={scope} allowAll={false} />}
          <Button onClick={() => setStarting(true)} disabled={!branch || !staff} className="ml-auto">
            <ClipboardList size={18} aria-hidden />
            Start a count
          </Button>
        </div>

        <Panel>
          <PanelHeader title="In progress" meta="Counts on this device that have not been posted yet" />
          {!hydrated ? null : open.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No count in progress"
              detail="Start a cycle count each week — a dozen lines at a time keeps the stock figures honest without closing the shop."
              action={
                <Button onClick={() => setStarting(true)} disabled={!branch || !staff}>
                  <ClipboardList size={18} aria-hidden />
                  Start a count
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-3 p-4 md:grid-cols-2">
              {open.map((sheet) => {
                const done = sheet.lines.filter((l) => l.counted).length;
                const pct = sheet.lines.length ? Math.round((done / sheet.lines.length) * 100) : 0;
                return (
                  <li key={sheet.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/manager/counts/${sheet.id}`)}
                      className="flex w-full flex-col gap-3 rounded-panel border border-line bg-surface p-4 text-left transition-colors duration-150 ease-out-pos hover:border-market focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block font-mono text-mono font-semibold text-ink">{sheet.reference}</span>
                          <span className="block text-body text-ink-70">
                            {sheet.scopeLabel} · started {stamp(sheet.startedAt)} by {sheet.startedByName}
                          </span>
                        </span>
                        <StatusPill tone="live">Counting</StatusPill>
                      </span>
                      <span className="flex items-center gap-3">
                        <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-pill bg-line">
                          <span className="block h-full rounded-pill bg-market" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="font-numeric text-body text-ink-70">
                          {done} of {sheet.lines.length} counted
                        </span>
                        <ChevronRight size={18} aria-hidden className="text-ink-40" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Finished counts" meta="Posted counts are on the ledger; abandoned ones are kept with the reason" />
          {closed.length === 0 ? (
            <p className="px-5 py-8 text-center text-body text-ink-70">No count has been finished on this device yet.</p>
          ) : (
            <TableScroller>
              <table className="w-full min-w-200 text-left">
                <thead>
                  <tr className="border-b border-line bg-paper text-label uppercase text-ink-40">
                    <th scope="col" className="py-3 pr-3 pl-5 font-semibold">Count</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Lines</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Accuracy</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Net variance</th>
                    <th scope="col" className="py-3 pr-5 pl-3 font-semibold">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {closed.map((sheet) => {
                    const { summary } = countVariance(sheet, entries, costOf, sheet.postedAt ?? now);
                    return (
                      <tr
                        key={sheet.id}
                        onClick={() => router.push(`/manager/counts/${sheet.id}`)}
                        className="cursor-pointer hover:bg-paper"
                      >
                        <th scope="row" className="py-3 pr-3 pl-5 font-normal">
                          <span className="block font-mono text-mono font-semibold text-ink">{sheet.reference}</span>
                          <span className="block text-body text-ink-40">{sheet.scopeLabel}</span>
                        </th>
                        <td className="px-3 py-3">
                          {sheet.status === "posted" ? (
                            <StatusPill tone="done">Posted</StatusPill>
                          ) : (
                            <StatusPill tone="stopped">Abandoned</StatusPill>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-numeric text-ink-70">
                          {summary.counted}/{summary.lines}
                        </td>
                        <td className="px-3 py-3 text-right font-numeric text-ink-70">
                          {sheet.status === "posted" ? formatBasisPoints(summary.accuracyBp) : "—"}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-3 text-right font-numeric font-medium",
                            summary.netValue.kobo < 0 ? "text-halt" : "text-ink",
                          )}
                        >
                          {sheet.status === "posted" ? formatWhole(summary.netValue) : "—"}
                        </td>
                        <td className="py-3 pr-5 pl-3 text-body text-ink-70">
                          {sheet.postedAt ? stamp(sheet.postedAt) : "—"}
                          <span className="block text-ink-40">{sheet.postedByName}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="How a count works" />
          <ol className="grid gap-4 p-5 text-body text-ink-70 md:grid-cols-4">
            {[
              ["Cut the sheet", "The lines to count, with what the ledger says is there."],
              ["Count the shelf", "Scan each item, type the figure, or print the sheet and count on paper."],
              ["Review", "Expected figures are revealed. Lines far out are flagged for a recount."],
              ["Post", "Each difference becomes one count adjustment on the ledger, under the count’s reference."],
            ].map(([title, detail], i) => (
              <li key={title} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-market-tint font-numeric font-semibold text-market">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-semibold text-ink">{title}</span>
                  {detail}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      {starting && staff && branch && (
        <StartCountSheet
          onClose={() => setStarting(false)}
          onStart={(kind, categoryId, blind) => {
            const at = new Date();
            const live = products.filter((p) => !p.delistedAt);
            const balances = balancesForBranch(entries, branch.id);
            const expired = new Set(
              batchesOnHand(entries, { today, soonDays: 7 })
                .filter((b) => b.status === "expired" && b.branchId === branch.id)
                .map((b) => b.productId),
            );

            let ids: string[];
            let label: string;
            if (kind === "category") {
              ids = live.filter((p) => p.categoryId === categoryId).map((p) => p.id);
              label = live.find((p) => p.categoryId === categoryId)?.categoryName ?? "Category";
            } else if (kind === "attention") {
              ids = live
                .filter((p) => {
                  const onHand = balances.get(p.id)?.onHand ?? ZERO_QTY;
                  return isOversold(onHand) || isLow(onHand, p.reorderLevel) || expired.has(p.id);
                })
                .map((p) => p.id);
              label = "Lines needing attention";
            } else if (kind === "cycle") {
              ids = pickCycleLines(live.map((p) => p.id), lastCountedByProduct(sheets), CYCLE_SIZE);
              label = `Cycle count · ${ids.length} lines`;
            } else {
              ids = live.map((p) => p.id);
              label = "Full branch";
            }
            const order = new Map(live.map((p) => [p.id, `${p.categoryName}|${p.name}`]));
            ids.sort((a, b) => (order.get(a) ?? "").localeCompare(order.get(b) ?? ""));

            const sheet: StockCountSheet = {
              id: `cnt_${at.getTime().toString(36)}`,
              reference: countRef(branch.code, at),
              branchId: branch.id,
              scopeLabel: label,
              blind,
              status: "counting",
              startedAt: at.toISOString(),
              startedById: staff.id,
              startedByName: staff.fullName,
              lines: cutCountLines(entries, branch.id, ids, at.toISOString()),
              postedAt: null,
              postedByName: null,
              closedNote: null,
            };
            start(sheet);
            router.push(`/manager/counts/${sheet.id}`);
          }}
          categories={[...new Map(products.filter((p) => !p.delistedAt).map((p) => [p.categoryId, p.categoryName]))]}
        />
      )}
    </main>
  );
}

/** `CNT-GWA-261117-093012` — Lagos date and time, like every other document reference. */
function countRef(branchCode: string, at: Date) {
  const lagos = new Date(at.getTime() + 3_600_000).toISOString();
  return `CNT-${branchCode}-${lagos.slice(2, 10).replaceAll("-", "")}-${lagos.slice(11, 19).replaceAll(":", "")}`;
}

function StartCountSheet({
  categories,
  onClose,
  onStart,
}: {
  categories: [string, string][];
  onClose: () => void;
  onStart: (kind: ScopeKind, categoryId: string, blind: boolean) => void;
}) {
  const [kind, setKind] = useState<ScopeKind>("cycle");
  const [categoryId, setCategoryId] = useState(categories[0]?.[0] ?? "");
  const [blind, setBlind] = useState(true);

  const options: { value: ScopeKind; icon: typeof Store; title: string; detail: string }[] = [
    { value: "cycle", icon: RefreshCcw, title: `Cycle count — ${CYCLE_SIZE} lines`, detail: "The lines counted longest ago. Ten minutes, once a week." },
    { value: "attention", icon: TriangleAlert, title: "Lines needing attention", detail: "Oversold, at or below reorder, or holding expired stock." },
    { value: "category", icon: Layers, title: "One category", detail: "An aisle or a department." },
    { value: "full", icon: Store, title: "Full branch", detail: "Every live line. The year-end stock-take." },
  ];

  return (
    <Sheet
      title="Start a count"
      subtitle="Choose what to count. The sheet is cut from the ledger now."
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        onStart(kind, categoryId, blind);
      }}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" className="flex-2">
            <ListChecks size={18} aria-hidden />
            Cut the sheet
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body font-semibold text-ink">What to count</legend>
        {options.map(({ value, icon: Icon, title, detail }) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-input border px-3.5 py-3 transition-colors duration-150 ease-out-pos",
              kind === value ? "border-market bg-market-tint" : "border-line bg-surface hover:border-ink-40",
            )}
          >
            <input
              type="radio"
              name="count-scope"
              checked={kind === value}
              onChange={() => setKind(value)}
              className="mt-1 size-4 accent-market"
            />
            <Icon size={18} aria-hidden className="mt-0.5 shrink-0 text-market" />
            <span className="min-w-0">
              <span className="block font-medium text-ink">{title}</span>
              <span className="block text-body text-ink-70">{detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {kind === "category" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-body font-semibold text-ink">Category</span>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="min-h-touch-admin rounded-input border border-line bg-surface px-3 text-body text-ink focus:outline-2 focus:outline-market"
          >
            {categories.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-panel border border-line bg-surface p-4">
        <input
          type="checkbox"
          checked={blind}
          onChange={(event) => setBlind(event.target.checked)}
          className="mt-1 size-4 accent-market"
        />
        <span>
          <span className="flex items-center gap-2 font-medium text-ink">
            <EyeOff size={17} aria-hidden className="text-ink-70" />
            Blind count (recommended)
          </span>
          <span className="block text-body text-ink-70">
            Hide the expected quantities while counting, so the team writes down what is on the shelf —
            not what the screen says should be. Revealed when you review.
          </span>
        </span>
      </label>
    </Sheet>
  );
}
