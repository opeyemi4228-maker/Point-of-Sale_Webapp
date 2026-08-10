"use client";

import { useState } from "react";
import { Printer, Receipt as ReceiptIcon, WifiOff, X } from "lucide-react";
import { Receipt } from "@/components/till/receipt";
import { format } from "@/lib/domain/money";
import { useBranchData } from "@/lib/hooks/use-branch-data";
import { useSessionStore } from "@/lib/stores/session";
import { PAYMENT_METHOD_LABEL } from "@/config/payment-methods";
import { shortTime, todayInLagos } from "@/lib/utils/format-date";
import type { Sale } from "@/types/sale";
import { cn } from "@/lib/utils/cn";

/**
 * My sales — SPEC §15.1.
 *
 * The cashier's own record of the shift, and the screen they open when a
 * customer comes back with a receipt. So it is ordered newest first, the
 * receipt number is the most prominent thing on each row, and any row can be
 * reprinted: a customer with a faded thermal receipt is the single most common
 * reason this screen is opened at all.
 *
 * Reads the same local ledger the till writes to, filtered to this person.
 */
export function SalesHistory() {
  const staff = useSessionStore((s) => s.session?.staff ?? null);
  const { ready, sales, today } = useBranchData(
    staff?.branchId ?? null,
    todayInLagos(),
  );
  const [open, setOpen] = useState<Sale | null>(null);

  const mine = sales.filter((sale) => sale.staffId === staff?.id);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 gap-px border-b border-line bg-line sm:grid-cols-3">
        <Figure label="Sales today" value={format(today.sales)} />
        <Figure label="Transactions" value={String(mine.length)} />
        <Figure label="Items sold" value={String(today.items)} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!ready ? (
          <p className="p-8 text-center text-body-lg text-ink-70">Loading your sales…</p>
        ) : mine.length === 0 ? (
          <div className="grid place-items-center gap-2 p-12 text-center">
            <ReceiptIcon size={40} aria-hidden className="text-ink-40" />
            <p className="text-body-lg font-medium text-ink">No sales yet today</p>
            <p className="text-body text-ink-70">
              Everything you ring at the till appears here, and can be reprinted.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((sale) => (
              <li key={sale.id}>
                <button
                  type="button"
                  onClick={() => setOpen(sale)}
                  className={cn(
                    "flex min-h-touch-till w-full items-center gap-4 px-4 py-3 text-left",
                    "transition-colors duration-150 ease-out-pos hover:bg-market-tint",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-market",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-mono block truncate font-medium text-ink">
                      {sale.receiptNo}
                    </span>
                    <span className="block text-ink-70">
                      {shortTime(sale.at)} · {sale.lines.length}{" "}
                      {sale.lines.length === 1 ? "line" : "lines"} ·{" "}
                      {PAYMENT_METHOD_LABEL[sale.tenders[0]?.method ?? "cash"]}
                    </span>
                  </span>

                  {sale.takenOffline && (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-pill bg-signal-tint px-2.5 py-1 text-label text-signal">
                      <WifiOff size={14} aria-hidden />
                      Offline
                    </span>
                  )}

                  <span className="font-numeric shrink-0 font-display text-title font-bold text-ink tabular-nums">
                    {format(sale.total)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && <ReceiptSheet sale={open} onClose={() => setOpen(null)} />}
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

function ReceiptSheet({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Receipt ${sale.receiptNo}`}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="my-auto w-full max-w-116 overflow-hidden rounded-panel bg-surface shadow-raised">
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="font-mono font-semibold text-ink">{sale.receiptNo}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt"
            className="grid size-touch-till place-items-center rounded-input text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
          >
            <X size={24} />
          </button>
        </header>

        <div className="bg-paper px-4 py-5">
          <div className="mx-auto w-max rounded-card bg-white px-3 py-4 shadow-raised">
            <Receipt sale={sale} />
          </div>
        </div>

        <div className="border-t border-line p-4">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-touch-till w-full rounded-input bg-market text-body-lg font-semibold text-white shadow-raised transition-colors duration-150 ease-out-pos hover:bg-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
          >
            <span className="inline-flex items-center gap-2">
              <Printer size={20} aria-hidden />
              Reprint receipt
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
