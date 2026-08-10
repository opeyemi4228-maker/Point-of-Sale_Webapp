"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CircleCheck,
  CircleX,
  Printer,
  Search,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { CameraScannerSheet } from "@/components/till/camera-scanner-sheet";
import { Receipt } from "@/components/till/receipt";
import { PaymentSheet } from "@/components/till/payment-sheet";
import { CustomerSheet } from "@/components/till/customer-sheet";
import { pointsValue } from "@/lib/domain/loyalty";
import type { LoyaltyLookup } from "@/lib/data/repositories";
import type { Tender } from "@/types/sale";
import { ProductGrid } from "@/components/till/product-grid";
import { ReceiptTape } from "@/components/till/receipt-tape";
import { ScanField } from "@/components/till/scan-field";
import { WeightPrompt } from "@/components/till/weight-prompt";
import { AccountMenu } from "@/components/shared/account-menu";
import { useBarcodeDetectorSupported } from "@/lib/hooks/use-camera-scanner";
import { isoDay } from "@/lib/utils/format-date";
import { basketTotals } from "@/lib/domain/basket";
import { buildSale, stockMovementsForSale } from "@/lib/domain/sale";
import { useLedgerStore } from "@/lib/stores/ledger";
import { useSessionStore } from "@/lib/stores/session";
import type { Money } from "@/lib/domain/money";
import type { Sale } from "@/types/sale";
import { indexByBarcode, resolveBarcode, listed, searchProducts } from "@/lib/domain/catalog";
import { format } from "@/lib/domain/money";
import { useBasketStore } from "@/lib/stores/basket";
import { PAYMENT_METHOD_LABEL } from "@/config/payment-methods";
import type { Category, Product } from "@/types/catalog";
import type { PaymentMethod } from "@/types/enums";
import { cn } from "@/lib/utils/cn";

/**
 * The till — SPEC §15.1. The most important screen in the system.
 *
 * Three regions, fixed height, no page scroll: the scan field across the top,
 * the product grid on the left, the live tape and totals on the right. Nothing
 * reflows while a sale is open, because a control that moves under a thumb is a
 * mis-scan.
 *
 * Nothing here awaits the network. The catalog is loaded once and held; a scan
 * resolves against an in-memory index and lands on the tape in the same frame.
 * The sync indicator reports the connection as *state*, never as an error —
 * offline is a normal way for this shop to trade (CLAUDE.md rule 8).
 */
export function TillScreen({
  products,
  categories,
}: {
  products: Product[];
  categories: Category[];
}) {
  const lines = useBasketStore((s) => s.lines);
  const feedback = useBasketStore((s) => s.feedback);
  const awaitingWeight = useBasketStore((s) => s.awaitingWeight);
  const add = useBasketStore((s) => s.add);
  const addWeighed = useBasketStore((s) => s.addWeighed);
  const requestWeight = useBasketStore((s) => s.requestWeight);
  const cancelWeight = useBasketStore((s) => s.cancelWeight);
  const increment = useBasketStore((s) => s.increment);
  const decrement = useBasketStore((s) => s.decrement);
  const remove = useBasketStore((s) => s.remove);
  const clear = useBasketStore((s) => s.clear);
  const reportScan = useBasketStore((s) => s.reportScan);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [findingCustomer, setFindingCustomer] = useState(false);
  /** The loyalty card on the open sale. Null is the ordinary case (SPEC §11). */
  const [customer, setCustomer] = useState<LoyaltyLookup | null>(null);
  const [settled, setSettled] = useState<Sale | null>(null);
  const [online, setOnline] = useState(true);
  const cameraSupported = useBarcodeDetectorSupported();

  const staff = useSessionStore((s) => s.session?.staff ?? null);
  const recordSale = useLedgerStore((s) => s.recordSale);
  const nextSequence = useLedgerStore((s) => s.nextSequence);

  // Totals are derived, never stored: a cached total is a total that can drift
  // from the lines that produced it.
  const totals = useMemo(() => basketTotals(lines), [lines]);
  const index = useMemo(() => indexByBarcode(products), [products]);

  const visible = useMemo(() => {
    const live = listed(products);
    const inCategory = category
      ? live.filter((product) => product.categoryId === category)
      : live;
    return searchProducts(inCategory, query);
  }, [products, category, query]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  function handleScan(raw: string) {
    const result = resolveBarcode(index, raw);

    if (!result.ok) {
      reportScan({
        kind: result.code === "DELISTED" ? "delisted" : "unknown",
        barcode: result.barcode,
        at: Date.now(),
      });
      return;
    }

    pick(result.product);
  }

  function pick(product: Product) {
    // A weighed product cannot be added by its code alone — the label says
    // which product, the scale says how much.
    if (product.soldBy === "weight") {
      requestWeight(product);
      return;
    }
    add(product);
  }

  /**
   * Settle, and record.
   *
   * This is where the till stops being a calculator. The sale and the stock
   * movements it caused are built together and appended in one write, so the
   * manager's stock screen and HQ's sales-per-person move the moment the
   * customer walks away. Nothing here awaits the network — the write is local
   * and syncs behind it (rule 8).
   */
  function handleSettle(
    method: PaymentMethod,
    tendered: Money,
    redeemedPoints: number,
  ) {
    if (!staff) return;

    const at = new Date().toISOString();
    const branchId = staff.branchId ?? "br_unassigned";
    const sequence = nextSequence(branchId, isoDay(at));

    // Points are a tender, not a discount on a line. Carrying them this way
    // means the receipt adds up without a special case, and the sale's own
    // arithmetic decides what was earned on the money actually paid.
    const tenders: Tender[] = [];
    if (redeemedPoints > 0) {
      tenders.push({ method: "loyalty_points", amount: pointsValue(redeemedPoints) });
    }
    if (tendered.kobo > 0) {
      tenders.push({ method, amount: tendered });
    }

    const sale = buildSale({
      lines,
      tenders,
      staff,
      at,
      sequence,
      takenOffline: !online,
      customer: customer
        ? {
            id: customer.customer.id,
            fullName: customer.customer.fullName,
            tier: customer.tier,
          }
        : null,
    });

    recordSale(sale, stockMovementsForSale(sale));

    setSettled(sale);
    setPaying(false);
    // The card belongs to the sale that just closed, not to the next customer
    // in the queue. Forgetting to clear it is how somebody else earns points.
    setCustomer(null);
    clear();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Scan bar ───────────────────────────────────────────────────────── */}
      {/* The screen has no visible title — the scan field is the subject and a
          heading above it would only push the grid down. Every page still needs
          one for assistive tech and for the document outline. */}
      <h1 className="sr-only">Till — sell</h1>

      <header className="shrink-0 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <ScanField
              onScan={handleScan}
              onOpenCamera={() => setCameraOpen(true)}
              cameraSupported={cameraSupported}
              disabled={paying || Boolean(awaitingWeight)}
            />
          </div>
          <ConnectionPill online={online} />
          {/* Same control, same corner, as every other workspace. A shared till
              must never leave the previous cashier's session on the screen with
              no visible way out (§17). */}
          <AccountMenu />
        </div>

        <ScanFeedbackBar feedback={feedback} />
      </header>

      {/* ── Grid + tape ────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label="Products"
          className="flex min-h-0 flex-1 flex-col border-line lg:border-r"
        >
          <div className="shrink-0 px-4 pt-4">
            <div className="relative">
              <Search
                size={20}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-40"
              />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products"
                aria-label="Search products"
                className="min-h-touch-till w-full rounded-input border border-line bg-surface pr-4 pl-12 text-body-lg text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-none"
              />
            </div>
          </div>

          <ProductGrid
            products={visible}
            categories={categories}
            activeCategory={category}
            onCategory={setCategory}
            onPick={pick}
          />
        </section>

        {/* The tape is a fixed column, not a flexible one: the totals must sit
            in the same place on every sale, so the cashier's eye and the
            customer's both know where to look. */}
        <section
          aria-label="This sale"
          className="flex min-h-0 shrink-0 flex-col border-t border-line bg-surface lg:w-100 lg:border-t-0 xl:w-112"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-label uppercase text-ink-70">This sale</h2>
            {lines.length > 0 && (
              <button
                type="button"
                onClick={clear}
                className="min-h-11 rounded-input px-2 font-medium text-halt transition-colors duration-150 ease-out-pos hover:bg-halt-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
              >
                Void sale
              </button>
            )}
          </div>

          <ReceiptTape
            lines={lines}
            totals={totals}
            onIncrement={increment}
            onDecrement={decrement}
            onRemove={remove}
          />

          <footer className="shrink-0 border-t border-line p-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-body-lg text-ink-70">Total</span>
              <span className="font-numeric font-display text-display-lg leading-none font-black text-ink tabular-nums">
                {format(totals.total)}
              </span>
            </div>

            <button
              type="button"
              disabled={lines.length === 0}
              onClick={() => setPaying(true)}
              className="mt-4 min-h-touch-till w-full rounded-input bg-market text-body-lg font-semibold text-white shadow-raised transition-colors duration-150 ease-out-pos hover:bg-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market disabled:cursor-not-allowed disabled:opacity-40"
            >
              Take payment
            </button>
          </footer>
        </section>
      </div>

      {/* ── Overlays ───────────────────────────────────────────────────────── */}
      {awaitingWeight && (
        <WeightPrompt
          product={awaitingWeight}
          onCancel={cancelWeight}
          onConfirm={(kilos) => addWeighed(awaitingWeight, kilos)}
        />
      )}

      {cameraOpen && (
        <CameraScannerSheet
          onDetect={handleScan}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {paying && (
        <PaymentSheet
          customer={customer}
          onFindCustomer={() => setFindingCustomer(true)}
          onRemoveCustomer={() => setCustomer(null)}
          total={totals.total}
          onCancel={() => setPaying(false)}
          onSettle={handleSettle}
        />
      )}

      {findingCustomer && (
        <CustomerSheet
          onCancel={() => setFindingCustomer(false)}
          onAttach={(lookup) => {
            setCustomer(lookup);
            setFindingCustomer(false);
          }}
        />
      )}

      {settled && <SaleComplete sale={settled} onDone={() => setSettled(null)} />}
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/**
 * Connection state, reported as state. Offline is a normal operating mode on
 * this till (rule 8), so it is a plain status pill in the signal tone and never
 * an error — sales continue and sync when the line comes back.
 */
function ConnectionPill({ online }: { online: boolean }) {
  const Icon = online ? Wifi : WifiOff;
  return (
    <p
      className={cn(
        "hidden shrink-0 items-center gap-2 rounded-pill border px-3 py-2 font-medium sm:flex",
        online
          ? "border-market/25 bg-market-tint text-market"
          : "border-signal/40 bg-signal-tint text-signal",
      )}
    >
      <Icon size={18} aria-hidden />
      {online ? "Online" : "Offline · sales saved"}
    </p>
  );
}

/**
 * The scan confirmation — SPEC §14.
 *
 * A cashier scanning at speed is not looking at the tape; they are looking at
 * the next item. This is the one thing on the screen that tells them the last
 * scan landed, so it carries an icon and words, never a colour flash alone, and
 * a refusal states which code was refused so it can be keyed by hand.
 */
function ScanFeedbackBar({
  feedback,
}: {
  feedback: ReturnType<typeof useBasketStore.getState>["feedback"];
}) {
  if (!feedback) return null;

  const shape =
    feedback.kind === "added"
      ? {
          icon: CircleCheck,
          tone: "border-market/25 bg-market-tint text-market",
          text: `Added ${feedback.productName}`,
        }
      : feedback.kind === "delisted"
        ? {
            icon: TriangleAlert,
            tone: "border-signal/40 bg-signal-tint text-signal",
            text: `${feedback.barcode} is delisted and cannot be sold`,
          }
        : {
            icon: CircleX,
            tone: "border-halt/30 bg-halt-tint text-halt",
            text: `No product for ${feedback.barcode}`,
          };

  const Icon = shape.icon;

  return (
    <p
      // `key` restarts the entry animation on a repeat scan of the same product,
      // which is what tells the cashier the second scan registered at all.
      key={feedback.at}
      role="status"
      className={cn(
        "mt-3 flex items-center gap-2.5 rounded-input border px-4 py-2.5 font-medium",
        shape.tone,
      )}
    >
      <Icon size={20} aria-hidden className="shrink-0" />
      {shape.text}
    </p>
  );
}

function SaleComplete({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const method = sale.tenders[0]?.method ?? "cash";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sale complete"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="my-auto w-full max-w-124 overflow-hidden rounded-panel bg-surface shadow-raised">
        <div className="p-6 text-center">
          <span
            aria-hidden
            className="mx-auto grid size-14 place-items-center rounded-pill bg-market-tint text-market"
          >
            <CircleCheck size={32} />
          </span>

          <h2 className="mt-3 font-display text-title font-bold text-ink">
            Sale complete
          </h2>
          <p className="mt-1 text-body text-ink-70">
            Paid by {PAYMENT_METHOD_LABEL[method].toLowerCase()}
          </p>

          {sale.change.kobo > 0 && (
            <div className="mt-4 rounded-panel bg-market-tint px-5 py-4">
              <p className="text-label uppercase text-market">Change to give</p>
              <p className="font-numeric mt-1 font-display text-display-lg leading-none font-black text-market">
                {format(sale.change)}
              </p>
            </div>
          )}
        </div>

        {/* The paper, at the paper's width. What the cashier checks before
            tearing it off is the same layout the head will burn. */}
        <div className="border-y border-line bg-paper px-4 py-5">
          <div className="mx-auto w-max rounded-card bg-white px-3 py-4 shadow-raised">
            <Receipt sale={sale} />
          </div>
        </div>

        <div className="flex gap-3 p-4">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-touch-till flex-1 rounded-input border border-line bg-surface px-4 text-body-lg font-medium text-ink transition-colors duration-150 ease-out-pos hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
          >
            <span className="inline-flex items-center gap-2">
              <Printer size={20} aria-hidden />
              Print again
            </span>
          </button>
          <button
            type="button"
            autoFocus
            onClick={onDone}
            className="min-h-touch-till flex-2 rounded-input bg-market px-4 text-body-lg font-semibold text-white shadow-raised transition-colors duration-150 ease-out-pos hover:bg-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
          >
            Next sale
          </button>
        </div>
      </div>
    </div>
  );
}
