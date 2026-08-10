"use client";

import { useState } from "react";
import { Check, Gift, Search, UserPlus, X } from "lucide-react";
import { format } from "@/lib/domain/money";
import { TIER_LABEL } from "@/config/loyalty";
import { maskPhone, pointsValue } from "@/lib/domain/loyalty";
import { repositories } from "@/lib/data";
import type { LoyaltyLookup } from "@/lib/data/repositories";
import { cn } from "@/lib/utils/cn";

/**
 * The loyalty card at the till — SPEC §11.
 *
 * The card is the phone number: no plastic, no app, one field. A cashier keys
 * what the customer says, in whatever shape they say it, and the number is
 * normalised before it is looked up — so `0803…`, `+234 803…` and `803…` find
 * one person rather than creating three cards worth nothing.
 *
 * **Nothing here is compulsory.** The sheet opens with a "No card" button as
 * prominent as the search, and every path out of it settles the sale. A prompt
 * a cashier must clear before they can take money is a prompt they will defeat
 * — usually by keying their own number — and then the scheme's data is worse
 * than none.
 *
 * When the number is not on the scheme, enrolling is two fields on the same
 * screen rather than a separate flow. Asking someone to come back later to
 * join is asking them not to join.
 */
export function CustomerSheet({
  onCancel,
  onAttach,
}: {
  onCancel: () => void;
  onAttach: (lookup: LoyaltyLookup) => void;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<
    | { kind: "searching" }
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "missing" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function lookUp() {
    const keyed = phone.trim();
    if (!keyed) return;

    setState({ kind: "busy" });
    const found = await repositories.customers.findByPhone(keyed);

    if (found) {
      onAttach(found);
      return;
    }
    // Not a refusal — an offer. The number is kept and the name field opens.
    setState({ kind: "missing" });
  }

  async function enrol() {
    setState({ kind: "busy" });
    const result = await repositories.customers.enrol({ fullName: name, phone });

    if (result.ok) {
      onAttach(result.lookup);
      return;
    }
    setState({ kind: "error", message: result.message });
  }

  const busy = state.kind === "busy";
  const enrolling = state.kind === "missing" || state.kind === "error";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Loyalty card"
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink/50"
    >
      <div className="flex w-full max-w-152 flex-col overflow-y-auto bg-paper shadow-raised">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-5 py-4">
          <h2 className="font-display text-title font-bold text-ink">Loyalty card</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close without adding a card"
            className="grid size-touch-till place-items-center rounded-input text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
          >
            <X size={26} />
          </button>
        </header>

        <div className="flex flex-col gap-5 p-5">
          <p className="text-body text-ink-70">
            Ask for a phone number if the customer has one. This is optional —
            the sale settles either way.
          </p>

          {/* ── The card is the phone number ─────────────────────────────── */}
          <div>
            <label
              htmlFor="loyalty-phone"
              className="text-label uppercase text-ink-40"
            >
              Phone number
            </label>
            <div className="mt-2 flex gap-3">
              <input
                id="loyalty-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                autoFocus
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  if (state.kind !== "idle") setState({ kind: "idle" });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !enrolling) void lookUp();
                }}
                placeholder="0803 123 4567"
                className="font-numeric min-h-touch-till min-w-0 flex-1 rounded-input border-2 border-line bg-surface px-4 text-title text-ink placeholder:text-ink-40 focus-visible:border-market focus-visible:outline-2 focus-visible:outline-market"
              />
              <button
                type="button"
                onClick={() => void lookUp()}
                disabled={busy || !phone.trim() || enrolling}
                className="flex min-h-touch-till items-center gap-2 rounded-input bg-market px-5 font-medium text-white transition-colors duration-150 ease-out-pos hover:bg-market-dark disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
              >
                <Search size={20} aria-hidden />
                Find
              </button>
            </div>
          </div>

          {/* ── Not on the scheme: join, here, now ───────────────────────── */}
          {enrolling && (
            <div className="rounded-panel border-2 border-market/30 bg-market-tint p-4">
              <p className="flex items-center gap-2 font-medium text-ink">
                <UserPlus size={20} aria-hidden className="text-market" />
                Not on the scheme yet
              </p>
              <p className="mt-1 text-body text-ink-70">
                Add a name and they start earning on this shop.
              </p>

              <label
                htmlFor="loyalty-name"
                className="mt-4 block text-label uppercase text-ink-40"
              >
                Full name
              </label>
              <input
                id="loyalty-name"
                type="text"
                autoComplete="off"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (state.kind === "error") setState({ kind: "missing" });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void enrol();
                }}
                placeholder="Ada Obi"
                className="mt-2 min-h-touch-till w-full rounded-input border-2 border-line bg-surface px-4 text-title text-ink placeholder:text-ink-40 focus-visible:border-market focus-visible:outline-2 focus-visible:outline-market"
              />

              {state.kind === "error" && (
                <p role="alert" className="mt-2 text-body font-medium text-halt">
                  {state.message}
                </p>
              )}

              <button
                type="button"
                onClick={() => void enrol()}
                disabled={busy || !name.trim()}
                className="mt-4 flex min-h-touch-till w-full items-center justify-center gap-2 rounded-input bg-market font-semibold text-white transition-colors duration-150 ease-out-pos hover:bg-market-dark disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
              >
                <Check size={20} aria-hidden />
                Join and continue
              </button>
            </div>
          )}

          {/* ── The way past. As big as everything else. ─────────────────── */}
          <button
            type="button"
            onClick={onCancel}
            className="min-h-touch-till w-full rounded-input border-2 border-line bg-surface font-semibold text-ink-70 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
          >
            No card — continue
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The card, once attached, as it reads on the payment sheet.
 *
 * Shows what they hold and — the part that matters to the person at the
 * counter — whether it is worth anything today, and how far off it is if not.
 * "You have 320 points" means nothing on its own; "180 more before points can
 * be used" is a reason to come back.
 */
export function LoyaltyStrip({
  lookup,
  onChange,
  onRemove,
}: {
  lookup: LoyaltyLookup | null;
  onChange: () => void;
  onRemove: () => void;
}) {
  if (!lookup) {
    return (
      <button
        type="button"
        onClick={onChange}
        className="flex min-h-touch-till w-full items-center justify-between gap-3 rounded-input border-2 border-dashed border-line bg-surface px-4 text-left transition-colors duration-150 ease-out-pos hover:border-market focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
      >
        <span className="flex items-center gap-2 font-medium text-ink-70">
          <Gift size={20} aria-hidden className="text-ink-40" />
          Loyalty card
        </span>
        <span className="text-body text-ink-40">Optional — add</span>
      </button>
    );
  }

  const { customer, pointsBalance, canRedeem, pointsToRedemption, tier } = lookup;

  return (
    <div className="rounded-input border-2 border-market/30 bg-market-tint px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">
            {customer.fullName}
            <span className="ml-2 rounded-pill border border-market/40 px-2 py-0.5 text-label uppercase text-market">
              {TIER_LABEL[tier]}
            </span>
          </p>
          <p className="font-numeric mt-0.5 text-body text-ink-70">
            {maskPhone(customer.phone)}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${customer.fullName}'s card from this sale`}
          className="grid size-11 shrink-0 place-items-center rounded-input text-ink-40 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
        >
          <X size={20} />
        </button>
      </div>

      <p
        className={cn(
          "font-numeric mt-2 text-body font-medium",
          canRedeem ? "text-market" : "text-ink-70",
        )}
      >
        {pointsBalance.toLocaleString("en-NG")} points
        {canRedeem ? (
          <span className="text-ink-70">
            {" "}
            · worth {format(pointsValue(pointsBalance))}
          </span>
        ) : (
          <span className="text-ink-70">
            {" "}
            · {pointsToRedemption} more before they can be used
          </span>
        )}
      </p>
    </div>
  );
}
