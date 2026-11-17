"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  Banknote,
  Check,
  CreditCard,
  Delete,
  Gift,
  ShieldAlert,
  Smartphone,
  X,
} from "lucide-react";
import { changeBreakdown, changeDue, quickTenders, remainingDue } from "@/lib/domain/basket";
import { ZERO, format, formatWhole, kobo, naira, type Money } from "@/lib/domain/money";
import { maximumRedeemable } from "@/lib/domain/loyalty";
import { LoyaltyStrip } from "@/components/till/customer-sheet";
import type { LoyaltyLookup } from "@/lib/data/repositories";
import { PAYMENT_METHOD_LABEL } from "@/config/payment-methods";
import type { PaymentMethod } from "@/types/enums";
import type { Tender } from "@/types/sale";
import { cn } from "@/lib/utils/cn";

/**
 * Taking payment — SPEC §15.1, §11.
 *
 * Cash is the default and gets the keypad, because cash is most of what a
 * Nigerian grocery takes and it is the only method where the cashier has to do
 * arithmetic under pressure. Card and transfer settle on the terminal or in the
 * bank app, so they default to the amount due and need a confirmation.
 *
 * **Split payment is the normal case, not the edge.** "Let me transfer ten
 * thousand and give you the rest in cash" is said at Swiftgrocers counters
 * every hour. Any method can take part of the bill; each part lands in the list
 * and the amount due shrinks until it is covered. Only cash can go over, and
 * the excess is change.
 *
 * **Cash is keyed in whole naira.** It was keyed in kobo, so ₦5,000 was eight
 * key presses (`5`,`0`,`0`,`0`,`0`,`0`) and a slipped zero was a hundredfold
 * error. Nobody hands over kobo. The `000` key makes ₦5,000 two presses.
 *
 * The change line is the whole screen's reason to exist: it is set in display
 * type, broken down into the notes to hand over, and it never appears until the
 * tender actually covers the total — showing a negative "change" would be read
 * as change owed and money would walk out of the shop.
 */

const METHODS: { id: PaymentMethod; icon: typeof Banknote }[] = [
  { id: "cash", icon: Banknote },
  { id: "transfer", icon: Smartphone },
  { id: "card", icon: CreditCard },
];

/** ₦99,999,999 — beyond any grocery bill, short of a float error. */
const MAX_ENTRY_DIGITS = 8;

export function PaymentSheet({
  total: billTotal,
  customer,
  active = true,
  onCancel,
  onSettle,
  onFindCustomer,
  onRemoveCustomer,
}: {
  total: Money;
  /** The loyalty card on this sale, if the cashier attached one. */
  customer: LoyaltyLookup | null;
  /** False while another sheet is open on top, so its keys are its own. */
  active?: boolean;
  onCancel: () => void;
  /** Money tenders in the order taken. Points are passed separately. */
  onSettle: (tenders: Tender[], redeemedPoints: number) => void;
  onFindCustomer: () => void;
  onRemoveCustomer: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  /** Whole naira, as typed. A string so an empty field and ₦0 are distinct. */
  const [entry, setEntry] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  /** Parts of a split payment already taken. */
  const [parts, setParts] = useState<Tender[]>([]);

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
  const payable = kobo(billTotal.kobo - pointsOff.kobo);
  const due = remainingDue(payable, parts);
  const paidSoFar = kobo(payable.kobo - due.kobo);

  const keyed: Money | null = entry === "" ? null : naira(Number(entry));
  const isCash = method === "cash";
  // Card and transfer default to the whole remainder: the usual case is one tap.
  const amount: Money = keyed ?? (isCash ? ZERO : due);

  const change = changeDue(due, amount);
  const covers = amount.kobo > 0 && change.kobo >= 0;
  // Card and transfer settle exactly. More than is due would be change from a
  // terminal, which does not exist — it is a typing error.
  const overByNonCash = !isCash && amount.kobo > due.kobo;
  const nothingDue = due.kobo === 0;

  const suggestions = quickTenders(due);

  /* ── Actions ──────────────────────────────────────────────────────────── */

  type Primary =
    | { kind: "finish"; tenders: Tender[]; label: string }
    | { kind: "part"; tender: Tender; label: string }
    | { kind: "blocked"; label: string };

  const primary: Primary = (() => {
    if (nothingDue) {
      return {
        kind: "finish",
        tenders: parts,
        label: parts.length === 0 ? "Finish — paid with points" : "Finish sale",
      };
    }
    if (amount.kobo <= 0) {
      return { kind: "blocked", label: "Key the cash received" };
    }
    if (overByNonCash) {
      return { kind: "blocked", label: `No more than ${format(due)} by ${label(method)}` };
    }
    const tender: Tender = { method, amount };
    if (covers) {
      return {
        kind: "finish",
        tenders: [...parts, tender],
        label: isCash ? "Finish sale" : `Confirm ${format(amount)} received`,
      };
    }
    return {
      kind: "part",
      tender,
      label: `Take ${formatWhole(amount)} ${label(method)} · ${formatWhole(
        kobo(due.kobo - amount.kobo),
      )} left`,
    };
  })();

  function choose(next: PaymentMethod) {
    setMethod(next);
    setEntry("");
  }

  function act() {
    if (primary.kind === "finish") {
      onSettle(primary.tenders, pointsApplied);
    } else if (primary.kind === "part") {
      setParts((current) => [...current, primary.tender]);
      setEntry("");
      // What is left is most often settled in cash — the transfer came first.
      setMethod("cash");
    }
  }

  const press = (digits: string) =>
    setEntry((current) => {
      const next = current === "" && /^0+$/.test(digits) ? "" : current + digits;
      return next.slice(0, MAX_ENTRY_DIGITS);
    });
  const backspace = () => setEntry((current) => current.slice(0, -1));

  // A till has a keyboard as often as a touch screen. Digits, Backspace, Enter
  // and Escape all work, so a cashier with a hand on the number pad never has
  // to reach for the screen. An effect event, so the listener is bound once and
  // still sees this render's amounts.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    if (/^\d$/.test(event.key)) press(event.key);
    else if (event.key === "Backspace") backspace();
    // A focused button would also fire on Enter; one action, not two.
    else if (event.key === "Enter") act();
    else if (event.key === "Escape") onCancel();
    else return;
    event.preventDefault();
  });

  useEffect(() => {
    if (!active) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const breakdown = isCash && covers && change.kobo > 0 ? changeBreakdown(change) : null;

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
          <div
            aria-live="polite"
            className="rounded-panel bg-linear-to-br from-market-dark via-market to-market px-6 py-5"
          >
            <p className="text-label uppercase text-white/75">
              {parts.length > 0 ? "Still to pay" : "Amount due"}
            </p>
            <p className="font-numeric mt-1 font-display text-display-lg font-black text-white">
              {format(due)}
            </p>
            {pointsApplied > 0 && (
              <p className="font-numeric mt-1 text-body text-white/80">
                {format(billTotal)} less {format(pointsOff)} in points
              </p>
            )}
            {parts.length > 0 && (
              <p className="font-numeric mt-1 text-body text-white/80">
                {format(paidSoFar)} paid of {format(payable)}
              </p>
            )}
          </div>

          {/* ── Parts already taken ────────────────────────────────────────── */}
          {parts.length > 0 && (
            <div>
              <p className="text-label uppercase text-ink-40">Paid so far</p>
              <ul className="mt-2 flex flex-col gap-2">
                {parts.map((part, index) => {
                  const Icon = METHODS.find((m) => m.id === part.method)?.icon ?? Banknote;
                  return (
                    <li
                      key={index}
                      className="flex min-h-touch-till items-center justify-between gap-3 rounded-input border border-line bg-surface pr-1 pl-4"
                    >
                      <span className="flex items-center gap-2 font-medium text-ink">
                        <Check size={18} aria-hidden className="text-market" />
                        <Icon size={18} aria-hidden className="text-ink-70" />
                        {PAYMENT_METHOD_LABEL[part.method]}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="font-numeric font-semibold text-ink">
                          {format(part.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setParts((current) => current.filter((_, i) => i !== index))}
                          aria-label={`Undo the ${format(part.amount)} ${label(part.method)} payment`}
                          className="grid size-12 place-items-center rounded-input text-ink-40 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
                        >
                          <X size={20} />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* ── The card ───────────────────────────────────────────────────── */}
          {/* Offered on every sale, required on none (SPEC §11). */}
          <LoyaltyStrip
            lookup={customer}
            onChange={onFindCustomer}
            onRemove={() => {
              setRedeeming(false);
              setParts([]);
              onRemoveCustomer();
            }}
          />

          {/* Points are fixed before money is taken: changing them after a part
              payment would move the amount due under a payment already made. */}
          {redeemable && redeemable.points > 0 && parts.length === 0 && (
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

          {nothingDue ? (
            <p className="flex items-center gap-2 rounded-panel border border-market/30 bg-market-tint px-5 py-4 text-body-lg font-medium text-market">
              <Check size={22} aria-hidden />
              {parts.length === 0
                ? "Points cover the whole bill. Nothing to collect."
                : "Fully paid. Finish the sale."}
            </p>
          ) : (
            <>
              {/* ── Method ─────────────────────────────────────────────────── */}
              <div>
                <p className="text-label uppercase text-ink-40">
                  {parts.length > 0 ? "Pay the rest by" : "Payment method"}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  {METHODS.map(({ id, icon: Icon }) => {
                    const selected = method === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => choose(id)}
                        aria-pressed={selected}
                        className={cn(
                          "relative flex min-h-touch-till flex-col items-center justify-center gap-1 rounded-input border-2 py-2 font-medium",
                          "transition-colors duration-150 ease-out-pos",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
                          selected
                            ? "border-market bg-market-tint text-market"
                            : "border-line bg-surface text-ink-70 hover:border-market",
                        )}
                      >
                        {/* Selection is never colour alone (§14): the chosen
                            method carries a visible tick as well as the tint. */}
                        {selected && (
                          <Check
                            size={18}
                            aria-hidden
                            className="absolute top-1.5 right-1.5"
                          />
                        )}
                        <Icon size={22} aria-hidden />
                        {PAYMENT_METHOD_LABEL[id]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Fake alerts ────────────────────────────────────────────── */}
              {/* The commonest till fraud in Nigeria is not a forged note, it
                  is a forged transfer: a doctored screenshot or a spoofed SMS
                  alert shown with confidence while the queue waits. The only
                  proof is the shop's own account. Said on every transfer, at
                  the moment it matters, so the cashier never has to be the one
                  to doubt the customer out loud. */}
              {method === "transfer" && (
                <p className="flex gap-3 rounded-panel border border-signal/40 bg-signal-tint px-4 py-3 text-body text-ink">
                  <ShieldAlert size={22} aria-hidden className="mt-0.5 shrink-0 text-signal" />
                  <span>
                    <strong className="font-semibold">Check it has landed</strong> — in the
                    shop&apos;s bank app or on the terminal. A screenshot or an SMS alert
                    on the customer&apos;s phone is not payment.
                  </span>
                </p>
              )}

              {/* ── Quick tenders ──────────────────────────────────────────── */}
              {isCash && (
                <div>
                  <p className="text-label uppercase text-ink-40">Cash received</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={suggestion.kobo}
                        type="button"
                        onClick={() => setEntry(String(Math.ceil(suggestion.kobo / 100)))}
                        className="min-h-touch-till rounded-input border-2 border-line bg-surface px-4 font-numeric font-semibold text-ink transition-colors duration-150 ease-out-pos hover:border-market hover:bg-market-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
                      >
                        {index === 0 ? "Exact" : formatWhole(suggestion)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Amount and change ──────────────────────────────────────── */}
              <div className="rounded-panel border border-line bg-surface px-5 py-4" aria-live="polite">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-body-lg text-ink-70">
                    {isCash ? "Tendered" : `By ${label(method)}`}
                  </span>
                  <span className="font-numeric font-display text-title font-bold text-ink">
                    {format(amount)}
                  </span>
                </div>

                <div className="mt-3 border-t border-line pt-3">
                  {isCash && keyed === null ? (
                    <p className="text-body text-ink-40">
                      Key the cash received, or tap an amount above.
                    </p>
                  ) : overByNonCash ? (
                    <p className="text-body font-medium text-halt">
                      More than is due. {PAYMENT_METHOD_LABEL[method]} gives no change —
                      key {format(due)} or less.
                    </p>
                  ) : covers && isCash ? (
                    <>
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="text-body-lg font-medium text-market">
                          Change due
                        </span>
                        <span className="font-numeric font-display text-display-lg leading-none font-black text-market">
                          {format(change)}
                        </span>
                      </div>
                      {breakdown && <NotesToGive breakdown={breakdown} />}
                    </>
                  ) : covers ? (
                    <p className="flex items-center gap-2 text-body font-medium text-market">
                      <Check size={18} aria-hidden />
                      Settles the bill
                    </p>
                  ) : (
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-body-lg font-medium text-signal">
                        Part payment · left after this
                      </span>
                      <span className="font-numeric font-display text-title font-bold text-signal">
                        {format(kobo(due.kobo - amount.kobo))}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Keypad ─────────────────────────────────────────────────── */}
              {/* For card and transfer the keypad is only for a part payment —
                  left alone, the whole remainder is taken. */}
              <div className="grid grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                  <Key key={digit} onClick={() => press(digit)}>
                    {digit}
                  </Key>
                ))}
                <Key onClick={() => press("000")} label="Three zeros">
                  000
                </Key>
                <Key onClick={() => press("0")}>0</Key>
                <Key onClick={backspace} label="Delete the last digit">
                  <Delete size={24} aria-hidden />
                </Key>
              </div>
            </>
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
            disabled={primary.kind === "blocked"}
            onClick={act}
            className={cn(
              "min-h-touch-till flex-2 rounded-input px-5 text-body-lg font-semibold shadow-raised",
              "transition-colors duration-150 ease-out-pos",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
              "disabled:cursor-not-allowed disabled:opacity-50",
              primary.kind === "part"
                ? "border-2 border-market bg-market-tint text-market hover:bg-surface"
                : "bg-market text-white hover:bg-market-dark",
            )}
          >
            {primary.label}
          </button>
        </footer>
      </div>
    </div>
  );
}

const label = (method: PaymentMethod) => PAYMENT_METHOD_LABEL[method].toLowerCase();

/**
 * The notes to hand back, read off while the hand is in the drawer. A cashier
 * who counts out ₦3,650 under pressure gets it wrong a few times a week; one
 * who reads "3 × ₦1,000, 1 × ₦500, 1 × ₦100, 1 × ₦50" does not.
 */
export function NotesToGive({ breakdown }: { breakdown: ReturnType<typeof changeBreakdown> }) {
  return (
    <div className="mt-3">
      <p className="text-label uppercase text-ink-40">Give back</p>
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {breakdown.notes.map((note) => (
          <li
            key={note.naira}
            className="font-numeric rounded-input border border-market/30 bg-market-tint px-3 py-1.5 font-semibold text-market"
          >
            {note.count} × {formatWhole(naira(note.naira))}
          </li>
        ))}
        {breakdown.remainder.kobo > 0 && (
          <li className="font-numeric rounded-input border border-line px-3 py-1.5 text-ink-70">
            + {format(breakdown.remainder)} in coins
          </li>
        )}
      </ul>
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
