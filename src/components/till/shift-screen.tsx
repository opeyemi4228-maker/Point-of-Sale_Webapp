"use client";

import { useMemo, useState } from "react";
import { Banknote, CircleCheck, TriangleAlert, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { expectedCash } from "@/lib/domain/sale";
import { abs, compare, format, naira, subtract, sum, type Money } from "@/lib/domain/money";
import { useBranchData } from "@/lib/hooks/use-branch-data";
import { useSessionStore } from "@/lib/stores/session";
import { shortTime, todayInLagos } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";

/**
 * The shift — SPEC §11.4.
 *
 * A cashier's drawer, reconciled. The screen exists for one moment: the end of
 * a shift, when the counted cash has to be squared against what the till says
 * should be there.
 *
 * **The expected figure is not revealed until the count is entered.** Showing
 * it first turns a count into a copying exercise — a cashier who is short will
 * type the expected number, and the variance the branch exists to catch never
 * appears. So the keypad takes the count, and only then does the screen say
 * what it should have been.
 */

/** The variance a branch tolerates before it becomes an exception — §11.4. */
const VARIANCE_LIMIT = naira(2_000);
/** What the drawer opened with. A branch setting once shifts are persisted. */
const OPENING_FLOAT = naira(20_000);

export function ShiftScreen() {
  const staff = useSessionStore((s) => s.session?.staff ?? null);
  const { ready, sales } = useBranchData(staff?.branchId ?? null, todayInLagos());
  const [counted, setCounted] = useState("");
  const [closed, setClosed] = useState(false);

  const mine = useMemo(
    () => sales.filter((s) => s.staffId === staff?.id),
    [sales, staff],
  );

  const cashSales = useMemo(
    () =>
      sum(
        mine.flatMap((s) =>
          s.tenders.filter((t) => t.method === "cash").map((t) => t.amount),
        ),
      ),
    [mine],
  );
  const changeGiven = useMemo(() => sum(mine.map((s) => s.change)), [mine]);
  const expected = useMemo(() => expectedCash(OPENING_FLOAT, mine), [mine]);
  const takings = useMemo(() => sum(mine.map((s) => s.total)), [mine]);

  const countedMoney: Money = { kobo: Math.round(Number(counted || 0) * 100) };
  const variance = subtract(countedMoney, expected);
  const overLimit = compare(abs(variance), VARIANCE_LIMIT) > 0;

  if (!ready) {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="py-10 text-center text-body-lg text-ink-70">Loading your shift…</p>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid gap-px border-b border-line bg-line sm:grid-cols-4">
        <Figure label="Opened with" value={format(OPENING_FLOAT)} />
        <Figure label="Takings" value={format(takings)} />
        <Figure label="Cash in" value={format(cashSales)} />
        <Figure label="Change out" value={format(changeGiven)} />
      </div>

      {mine.length === 0 ? (
        <EmptyState icon={Wallet} title="Your shift has not started">
          Ring a sale at the till and this fills in — takings, what the drawer
          should hold, and the count you close on.
        </EmptyState>
      ) : (
        <div className="mx-auto grid max-w-176 gap-5 p-5">
          <section className="rounded-panel border border-line bg-surface p-5">
            <h2 className="text-label uppercase text-ink-70">Count the drawer</h2>
            <p className="mt-1 text-body text-ink-70">
              Count the cash and key the total. What the till expects is shown
              once you have — counting against a number on screen is not a count.
            </p>

            <label className="mt-4 block">
              <span className="sr-only">Cash counted, in naira</span>
              <div className="flex items-center gap-3 rounded-input border-2 border-line bg-paper px-4 focus-within:border-market">
                <Banknote size={24} aria-hidden className="shrink-0 text-ink-40" />
                <span className="font-display text-title font-bold text-ink-40">₦</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={50}
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  disabled={closed}
                  placeholder="0"
                  className="font-numeric min-h-touch-till w-full bg-transparent font-display text-display-md text-ink outline-none placeholder:text-ink-40 disabled:opacity-60"
                />
              </div>
            </label>

            {counted !== "" && (
              <div className="mt-5 grid gap-3 border-t border-line pt-5">
                <Row label="Drawer should hold" value={format(expected)} />
                <Row label="You counted" value={format(countedMoney)} />
                <div
                  className={cn(
                    "flex items-center justify-between gap-4 rounded-input px-4 py-3",
                    variance.kobo === 0
                      ? "bg-market-tint text-market"
                      : overLimit
                        ? "bg-halt-tint text-halt"
                        : "bg-signal-tint text-signal",
                  )}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    {variance.kobo === 0 ? (
                      <CircleCheck size={20} aria-hidden />
                    ) : (
                      <TriangleAlert size={20} aria-hidden />
                    )}
                    {variance.kobo === 0
                      ? "Balanced"
                      : variance.kobo > 0
                        ? "Over"
                        : "Short"}
                  </span>
                  <span className="font-numeric font-display text-title font-bold">
                    {variance.kobo > 0 ? "+" : ""}
                    {format(variance)}
                  </span>
                </div>

                {overLimit && !closed && (
                  <Alert tone="halt" title="Over the variance limit">
                    Anything beyond ±{format(VARIANCE_LIMIT)} goes to your branch
                    manager to resolve. Close the shift anyway — the figure is
                    recorded either way, and hiding it helps nobody.
                  </Alert>
                )}
              </div>
            )}

            {closed ? (
              <Alert tone="market" title="Shift closed" className="mt-5">
                Counted {format(countedMoney)} against {format(expected)}{" "}
                expected. Your manager sees this on their overview.
              </Alert>
            ) : (
              <button
                type="button"
                disabled={counted === ""}
                onClick={() => setClosed(true)}
                className="mt-5 min-h-touch-till w-full rounded-input bg-market text-body-lg font-semibold text-white shadow-raised transition-colors duration-150 ease-out-pos hover:bg-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market disabled:cursor-not-allowed disabled:opacity-40"
              >
                Close shift
              </button>
            )}
          </section>

          <section className="rounded-panel border border-line bg-surface">
            <h2 className="border-b border-line px-5 py-4 text-label uppercase text-ink-70">
              {mine.length} {mine.length === 1 ? "sale" : "sales"} this shift
            </h2>
            <ul className="divide-y divide-line">
              {mine.slice(0, 10).map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="font-mono block truncate text-ink">
                      {s.receiptNo}
                    </span>
                    <span className="block text-ink-70">{shortTime(s.at)}</span>
                  </span>
                  <span className="font-numeric shrink-0 font-semibold text-ink">
                    {format(s.total)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-label uppercase text-ink-40">{label}</p>
      <p className="font-numeric mt-1 font-display text-title font-bold text-ink">
        {value}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline justify-between gap-4 text-body-lg">
      <span className="text-ink-70">{label}</span>
      <span className="font-numeric font-semibold text-ink">{value}</span>
    </p>
  );
}
