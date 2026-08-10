"use client";

import { CURRENCY_SYMBOL } from "@/config/currency";
import { PAYMENT_METHOD_LABEL } from "@/config/payment-methods";
import { formatBare } from "@/lib/domain/money";
import { formatQty } from "@/lib/domain/quantity";
import { itemCount } from "@/lib/domain/sale";
import { stamp } from "@/lib/utils/format-date";
import type { Sale } from "@/types/sale";

/**
 * The customer receipt — SPEC §12. Built for the mini thermal printer, not the
 * screen.
 *
 * A 58mm roll gives about 32 monospace characters at 9pt; an 80mm roll about
 * 48. Everything here is sized in `ch` against a monospace face so the columns
 * land on the same character positions the printer will use, and the whole
 * thing is set to the narrower 58mm so it cannot overflow on either roll.
 *
 * Three things thermal printing forces, all of them visible in this file:
 *
 * - **No colour and no grey.** A thermal head burns black or it does not. Tints
 *   come out as muddy dither or as nothing, so hierarchy is carried by weight,
 *   case, rules and spacing alone.
 * - **No background fills, no borders, no shadow.** Filling a block means
 *   burning every dot in it: slow, hot, and it eats the roll. Rules are drawn
 *   with dashed characters, which is what the printer is good at.
 * - **Reverse-cut margin at the foot.** The cutter sits roughly 12mm above the
 *   print head, so anything in the last few lines is cut off. The trailing feed
 *   is deliberate blank roll, not a styling accident.
 *
 * On screen this renders as a preview of the paper, at the paper's width, so
 * what the cashier sees is what comes out.
 */
export function Receipt({ sale }: { sale: Sale }) {
  const items = itemCount(sale.lines);

  return (
    <div data-receipt className="receipt">
      <header className="receipt-center">
        {/* The monochrome cut of the mark, not the colour one: a thermal head
            is 1-bit and the brand greens print as nothing. `print-color-adjust`
            in the stylesheet stops the browser helpfully lightening it. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- vector, and the
            optimizer refuses SVG unless dangerouslyAllowSVG is set */}
        <img
          src="/logo-mark-print.svg"
          alt=""
          aria-hidden
          width={48}
          height={48}
          className="receipt-mark"
        />
        <p className="receipt-shout">SWIFTGROCERS</p>
        <p>{sale.branchName} Branch</p>
        <p>VAT inclusive · RC 1043882</p>
      </header>

      <Rule />

      {/* Label and value on one line each. At 32 characters a label plus a long
          value does not fit, and a wrapped *label* — "Served" / "by" — reads as
          a printer fault rather than as text. The staff code gets its own row
          for the same reason. */}
      <div className="receipt-meta">
        <Row label="Receipt" value={sale.receiptNo} />
        <Row label="Date" value={stamp(sale.at)} />
        <Row label="Served by" value={sale.staffName} />
        <Row label="Staff code" value={sale.staffCode} />
      </div>

      <Rule />

      {/* Lines. The name gets its own row when it is long, so the quantity and
          the amount never wrap into each other's columns. */}
      <ul className="receipt-lines">
        {sale.lines.map((line, index) => (
          <li key={`${line.productId}-${index}`}>
            <p className="receipt-item">{line.name}</p>
            <p className="receipt-row">
              <span>
                {formatQty(line.quantity)}
                {line.soldBy === "weight" ? ` ${line.unit}` : ""} @{" "}
                {formatBare(line.unitPrice)}
              </span>
              <span className="receipt-amount">{formatBare(line.lineTotal)}</span>
            </p>
          </li>
        ))}
      </ul>

      <Rule />

      <div className="receipt-totals">
        <p className="receipt-row">
          <span>Subtotal</span>
          <span className="receipt-amount">{formatBare(sale.subtotal)}</span>
        </p>
        {sale.discount.kobo > 0 && (
          <p className="receipt-row">
            <span>Discount</span>
            <span className="receipt-amount">-{formatBare(sale.discount)}</span>
          </p>
        )}
        <p className="receipt-row receipt-shout">
          <span>TOTAL {CURRENCY_SYMBOL}</span>
          <span className="receipt-amount">{formatBare(sale.total)}</span>
        </p>
      </div>

      <Rule />

      <div className="receipt-totals">
        {sale.tenders.map((tender, index) => (
          <p key={index} className="receipt-row">
            <span>{PAYMENT_METHOD_LABEL[tender.method]}</span>
            <span className="receipt-amount">{formatBare(tender.amount)}</span>
          </p>
        ))}
        {sale.change.kobo > 0 && (
          <p className="receipt-row">
            <span>Change</span>
            <span className="receipt-amount">{formatBare(sale.change)}</span>
          </p>
        )}
      </div>

      {/* ── The card ──────────────────────────────────────────────────────
          Printed only when there was one, so an ordinary sale is not padded
          with three blank lines of scheme that did not apply.

          Both the points and the balance are on the paper because this is the
          only statement a member ever gets: no app, no email, just the receipt
          in their hand (SPEC §11). */}
      {sale.customerId && (
        <>
          <Rule />
          <div className="receipt-totals">
            <p className="receipt-row">
              <span>Card</span>
              <span className="receipt-amount">{sale.customerName}</span>
            </p>
            {sale.pointsRedeemed > 0 && (
              <p className="receipt-row">
                <span>Points used</span>
                <span className="receipt-amount">{sale.pointsRedeemed}</span>
              </p>
            )}
            <p className="receipt-row">
              <span>Points earned</span>
              <span className="receipt-amount">{sale.pointsEarned}</span>
            </p>
          </div>
        </>
      )}

      <Rule />

      <footer className="receipt-center">
        {/* Units, not lines. Two tins of milk and a bottle of water is three
            items to the customer counting their bag, whatever the tape did. */}
        <p>
          {items} {items === 1 ? "item" : "items"} · {sale.lines.length}{" "}
          {sale.lines.length === 1 ? "line" : "lines"}
        </p>
        <p>Thank you for shopping with us</p>
        <p>Goods returnable within 7 days</p>
        <p>with this receipt</p>
        {/* Offline sales are marked on the paper. A customer disputing a
            duplicate charge and a manager reconciling a late sync both need to
            know this one did not reach the server when it was rung. */}
        {sale.takenOffline && <p className="receipt-shout">* OFFLINE SALE *</p>}
        <p className="receipt-code">{sale.receiptNo}</p>
      </footer>

      {/* Blank roll for the cutter — see the note above. */}
      <div aria-hidden className="receipt-feed" />
    </div>
  );
}

const Rule = () => (
  <p aria-hidden className="receipt-rule">
    {"-".repeat(32)}
  </p>
);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="receipt-row">
      <span>{label}</span>
      <span className="receipt-amount">{value}</span>
    </p>
  );
}
