"use client";

import { useSyncExternalStore } from "react";
import { Clock, UserRound } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { TableScroller } from "@/components/ui/table-scroller";
import { formatWhole } from "@/lib/domain/money";
import { shortTime } from "@/lib/utils/format-date";
import type { ShiftRow } from "@/types/dashboard";

/**
 * Who is on the tills, and for how long — SPEC §11.4, §15.2.
 *
 * A sales person's shift opens when they sign in, so this fills itself: nobody
 * presses a button, and a cashier who started at seven reads as having started
 * at seven rather than whenever somebody remembered.
 *
 * The elapsed column ticks. That is the difference between a dashboard and a
 * report — a manager glancing at this at eleven wants to see "4h 12m", not a
 * start time they have to subtract in their head, and certainly not a figure
 * frozen at whatever it was when the page loaded.
 */
export function OnShiftPanel({ rows }: { rows: readonly ShiftRow[] }) {
  return (
    <Panel>
      <PanelHeader
        title="On shift now"
        meta={
          rows.length === 0
            ? "No tills open"
            : `${rows.length} ${rows.length === 1 ? "person" : "people"} · hours run from sign-in`
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No tills are open"
          detail="A shift starts on its own when a sales person signs in."
        />
      ) : (
        <TableScroller>
          <table className="w-full min-w-160 text-left">
            <thead>
              <tr className="border-b border-line text-label uppercase text-ink-40">
                <th scope="col" className="px-5 py-3 font-semibold">Sales person</th>
                <th scope="col" className="px-5 py-3 font-semibold">Till</th>
                <th scope="col" className="px-5 py-3 font-semibold">Since</th>
                <th scope="col" className="px-5 py-3 font-semibold">On shift</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Sales</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Txns</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Cash held</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.staffId} className="hover:bg-paper">
                  <th scope="row" className="px-5 py-3.5">
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <UserRound size={16} aria-hidden className="text-ink-40" />
                      {row.staffName}
                    </span>
                  </th>
                  <td className="px-5 py-3.5 text-ink-70">{row.tillLabel}</td>
                  <td className="font-numeric px-5 py-3.5 text-ink-70">
                    {shortTime(row.since)}
                  </td>
                  <td className="px-5 py-3.5">
                    <Elapsed since={row.since} />
                  </td>
                  <td className="font-numeric px-5 py-3.5 text-right text-ink">
                    {formatWhole(row.sales)}
                  </td>
                  <td className="font-numeric px-5 py-3.5 text-right text-ink-70">
                    {row.transactions}
                  </td>
                  <td className="font-numeric px-5 py-3.5 text-right text-ink">
                    {formatWhole(row.cashHeld)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </Panel>
  );
}

/* ── The clock, as an external store ──────────────────────────────────────── */
//
// The wall clock is not React state — it is a thing outside the component that
// changes on its own, which is exactly what `useSyncExternalStore` is for.
// Writing it as `useState` + `useEffect` means setting state during an effect
// on every mount, and React is right to complain about that.
//
// Ticking every half minute: a shift clock does not need seconds, and a
// per-second re-render on a manager's tablet is heat for no information.

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // One interval for the whole table, however many rows are on it.
  timer ??= setInterval(() => listeners.forEach((notify) => notify()), TICK_MS);

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Quantised to the tick, so the snapshot is stable between them.
 *
 * `Date.now()` raw would return a different number on every render and React
 * would loop forever deciding the store had changed again.
 */
const nowSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;

/**
 * The server has no business guessing what time it is on the manager's tablet,
 * so it renders a dash and the browser fills it in. A figure rendered during
 * SSR is guaranteed to disagree with the first client frame — React calls that
 * a hydration mismatch and a manager calls it a number that flickered.
 */
const serverSnapshot = () => null;

/** Time on shift, counting up. */
function Elapsed({ since }: { since: string }) {
  const now = useSyncExternalStore(subscribe, nowSnapshot, serverSnapshot);

  if (now === null) {
    return <span className="font-numeric text-ink-40">—</span>;
  }

  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  const hours = Math.floor(minutes / 60);

  return (
    <span className="font-numeric font-medium text-ink">
      {hours > 0 ? `${hours}h ` : ""}
      {minutes % 60}m
    </span>
  );
}
