"use client";

import { useMemo, useState } from "react";
import { Banknote, Check, CreditCard, Delete, Gift, Smartphone, X } from "lucide-react";
import { changeDue, quickTenders } from "@/lib/domain/basket";
import { ZERO, format, kobo, naira, type Money } from "@/lib/domain/money";
import { maximumRedeemable } from "@/lib/domain/loyalty";
import { LoyaltyStrip } from "@/components/till/customer-sheet";
import type { LoyaltyLookup } from "@/lib/data/repositories";
import { PAYMENT_METHOD_LABEL } from "@/config/payment-methods";
import type { PaymentMethod } from "@/types/enums";
import { cn } from "@/lib/utils/cn";

/**
 * Taking payment — SPEC §15.1, §11.
 *
 * Cash is the default and gets the keypad, because cash is most of what a
 * Nigerian grocery takes and it is the only method where the cashier has to do
 * arithmetic under pressure. Card and transfer settle on the terminal, so they
 * need a confirmation and nothing else.
 *
 * The change line is the whole screen's reason to exist: it is set in display
 * type, and it never appears until the tender actually covers the total —
 * showing a negative "change" would be read as change owed and money would walk
 * out of the shop.
 */

const METHODS: { id: PaymentMethod; icon: typeof Banknote }[] = [
  { id: "cash", icon: Banknote },
  { id: "card", icon: CreditCard },
  { id: "transfer", icon: Smartphone },
];

export function PaymentSheet({
  total: billTotal,
  customer,
  onCancel,
  onSettle,
  onFindCustomer,
  onRemoveCustomer,
}: {
  total: Money;
  /** The loyalty card on this sale, if the cashier attached one. */
  customer: LoyaltyLookup | null;
  onCancel: () => void;
  onSettle: (method: PaymentMethod, tendered: Money, redeemedPoints: number) => void;
  onFindCustomer: () => void;
  onRemoveCustomer: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  /** Kobo, as typed. A string so a leading zero and an empty field are distinct. */
  const [entry, setEntry] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  // The most this card can take off this bill: bounded by the balance, by the
  // bill, and by whole blocks so the receipt reads "₦400 off" (lib/domain/loyalty).
  const redeemable = useMemo(
    () => (customer ? maximumRedeemable(customer.pointsBalance, billTotal) : null),
    [customer, billTotal],
  );

  const pointsApplied = redeeming && redeemable ? redeemable.points : 0;
  const pointsOff = redeeming && redeemable ? redeemable.value : ZERO;

  // What is left to pay in money. Points are a tender like any other, so the
  // rest of this screen works on the remainder and needs no special case.
  const total = useMemo(
    () => kobo(billTotal.kobo - pointsOff.kobo),
    [billTotal, pointsOff],
  );

  const tendered = useMemo(() => kobo(Number(entry || 0)), [entry]);
  const change = changeDue(total, tendered);
  const covered = change.kobo >= 0;
  const suggestions = useMemo(() => quickTenders(total), [total]);

  // Card and transfer settle for the exact amount on the terminal — there is no
  // tender to key and no change to give.
  const exactMethod = method !== "cash";
  // Points can cover the bill outright, and then there is nothing left to key.
  const settledByPoints = total.kobo === 0;
  const canSettle = settledByPoints || exactMethod || (entry !== "" && covered);

  const press = (digit: string) => setEntry((current) => (current + digit).slice(0, 9));
  const backspace = () => setEntry((current) => current.slice(0, -1));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Take payment"
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink/50"
    >
      <div className="flex w-full max-w-152 flex-col overflow-y-auto bg-paper shadow-raised">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-5 py-4">
          <h2 className="font-display text-title font-bold text-ink">Take payment</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel payment and return to the sale"
            className="grid size-touch-till place-items-center rounded-input text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
          >
            <X size={26} />
          </button>
        </header>

        <div className="flex flex-col gap-5 p-5">
          {/* ── Amount due ─────────────────────────────────────────────────── */}
          <div className="rounded-panel bg-linear-to-br from-market-dark via-market to-market px-6 py-5">
            <p className="text-label uppercase text-white/75">Amount due</p>
            <p className="font-numeric mt-1 font-display text-display-lg font-black text-white">
              {format(total)}
            </p>
            {pointsApplied > 0 && (
              <p className="font-numeric mt-1 text-body text-white/80">
                {format(billTotal)} less {format(pointsOff)} in points
              </p>
            )}
          </div>

          {/* ── The card ───────────────────────────────────────────────────── */}
          {/* Offered on every sale, required on none (SPEC §11). */}
          <LoyaltyStrip
            lookup={customer}
            onChange={onFindCustomer}
            onRemove={() => {
              setRedeeming(false);
              onRemoveCustomer();
            }}
          />

          {redeemable && redeemable.points > 0 && (
            <button
              type="button"
              onClick={() => {
                setRedeeming((on) => !on);
                setEntry("");
              }}
              aria-pressed={redeeming}
              className={cn(
                "flex min-h-touch-till w-full items-center justify-between gap-3 rounded-input border-2 px-4 text-left font-medium",
                "transition-colors duration-150 ease-out-pos",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
                redeeming
                  ? "border-market bg-market-tint text-market"
                  : "border-line bg-surface text-ink hover:border-market",
              )}
            >
              <span className="flex items-center gap-2">
                {redeeming ? <Check size={20} aria-hidden /> : <Gift size={20} aria-hidden />}
                {redeeming ? "Using" : "Use"} {redeemable.points} points
              </span>
              <span className="font-numeric font-semibold">
                −{format(redeemable.value)}
              </span>
            </button>
          )}

          {/* ── Method ─────────────────────────────────────────────────────── */}
          <div>
            <p className="text-label uppercase text-ink-40">Payment method</p>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {METHODS.map(({ id, icon: Icon }) => {
                const active = method === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setMethod(id);
                      setEntry("");
                    }}
                    aria-pressed={active}
                    className={cn(
                      "flex min-h-touch-till flex-col items-center justify-center gap-1 rounded-input border-2 font-medium",
                      "transition-colors duration-150 ease-out-pos",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
                      active
                        ? "border-market bg-market-tint text-market"
                        : "border-line bg-surface text-ink-70 hover:border-market",
                    )}
                  >
                    <Icon size={22} aria-hidden />
                    {PAYMENT_METHOD_LABEL[id]}
                    {/* Selection is never colour alone (§14) — the chosen method
                        carries a tick as well as the tint. */}
                    {active && <Check size={14} aria-hidden className="sr-only" />}
                  </button>
                );
              })}
            </div>
          </div>

          {settledByPoints ? (
            <p className="rounded-panel border border-line bg-surface px-5 py-4 text-body-lg text-ink-70">
              Points cover the whole bill. Nothing to collect.
            </p>
          ) : method === "cash" ? (
            <>
              {/* ── Quick tenders ──────────────────────────────────────────── */}
              <div>
                <p className="text-label uppercase text-ink-40">Cash received</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestions.map((amount, index) => (
                    <button
                      key={amount.kobo}
                      type="button"
                      onClick={() => setEntry(String(amount.kobo))}
                      className="min-h-touch-till rounded-input border-2 border-line bg-surface px-4 font-numeric font-semibold text-ink transition-colors duration-150 ease-out-pos hover:border-market hover:bg-market-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
                    >
                      {index === 0 ? "Exact" : format(amount)}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Tendered and change ────────────────────────────────────── */}
              <div className="rounded-panel border border-line bg-surface px-5 py-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-body-lg text-ink-70">Tendered</span>
                  <span className="font-numeric font-display text-title font-bold text-ink">
                    {entry === "" ? format(naira(0)) : format(tendered)}
                  </span>
                </div>

                <div className="mt-3 border-t border-line pt-3">
                  {entry === "" ? (
                    <p className="text-body text-ink-40">
                      Key the cash received, or tap an amount above.
                    </p>
                  ) : covered ? (
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-body-lg font-medium text-market">
                        Change due
                      </span>
                      <span className="font-numeric font-display text-display-lg leading-none font-black text-market">
                        {format(change)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-body-lg font-medium text-halt">
                        Still to pay
                      </span>
                      <span className="font-numeric font-display text-title font-bold text-halt">
                        {format({ kobo: -change.kobo })}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Keypad ─────────────────────────────────────────────────── */}
              <div className="grid grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                  <Key key={digit} onClick={() => press(digit)}>
                    {digit}
                  </Key>
                ))}
                <Key onClick={() => press("00")}>00</Key>
                <Key onClick={() => press("0")}>0</Key>
                <Key onClick={backspace} label="Delete the last digit">
                  <Delete size={24} aria-hidden />
                </Key>
              </div>
            </>
          ) : (
            <p className="rounded-panel border border-line bg-surface px-5 py-4 text-body-lg text-ink-70">
              Settle {format(total)} on the {PAYMENT_METHOD_LABEL[method].toLowerCase()}{" "}
              terminal, then confirm below. The sale is not recorded until you do.
            </p>
          )}
        </div>

        <footer className="mt-auto flex shrink-0 gap-3 border-t border-line bg-surface p-5">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-touch-till flex-1 rounded-input border border-line bg-surface px-5 text-body-lg font-medium text-ink transition-colors duration-150 ease-out-pos hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
          >
            Back to sale
          </button>
          <button
            type="button"
            disabled={!canSettle}
            onClick={() =>
              onSettle(
                method,
                settledByPoints ? ZERO : exactMethod ? total : tendered,
                pointsApplied,
              )
            }
            className="min-h-touch-till flex-2 rounded-input bg-market px-5 text-body-lg font-semibold text-white shadow-raised transition-colors duration-150 ease-out-pos hover:bg-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market disabled:cursor-not-allowed disabled:opacity-50"
          >
            {settledByPoints
              ? "Finish — paid with points"
              : exactMethod
                ? "Confirm payment"
                : "Finish sale"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Key({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid min-h-16 place-items-center rounded-input border border-line bg-surface font-display text-title font-bold text-ink transition-colors duration-150 ease-out-pos hover:border-market hover:bg-market-tint active:bg-market-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
    >
      {children}
    </button>
  );
}
