"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  CircleCheck,
  CircleX,
  PauseCircle,
  PlayCircle,
  Printer,
  Search,
  Trash2,
  TriangleAlert,
  Undo2,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { CameraScannerSheet } from "@/components/till/camera-scanner-sheet";
import { Receipt } from "@/components/till/receipt";
import { NotesToGive, PaymentSheet } from "@/components/till/payment-sheet";
import { CustomerSheet } from "@/components/till/customer-sheet";
import { HeldSalesSheet } from "@/components/till/held-sales-sheet";
import { pointsValue } from "@/lib/domain/loyalty";
import type { Tender } from "@/types/sale";
import { ProductGrid } from "@/components/till/product-grid";
import { ReceiptTape } from "@/components/till/receipt-tape";
import { ScanField } from "@/components/till/scan-field";
import { WeightPrompt } from "@/components/till/weight-prompt";
import { AccountMenu } from "@/components/shared/account-menu";
import { useBarcodeDetectorSupported } from "@/lib/hooks/use-camera-scanner";
import { isoDay } from "@/lib/utils/format-date";
import { playScanTone, setTillMuted, useTillMuted } from "@/lib/utils/scan-tone";
import { basketTotals, changeBreakdown } from "@/lib/domain/basket";
import { buildSale, stockMovementsForSale } from "@/lib/domain/sale";
import { useLedgerStore } from "@/lib/stores/ledger";
import { useSessionStore } from "@/lib/stores/session";
import type { Sale } from "@/types/sale";
import {
  indexByBarcode,
  resolveBarcode,
  listed,
  parseScanEntry,
  searchProducts,
} from "@/lib/domain/catalog";
import { format } from "@/lib/domain/money";
import { units } from "@/lib/domain/quantity";
import { MAX_HELD_SALES, useBasketStore, type ScanFeedback } from "@/lib/stores/basket";
import { PAYMENT_METHOD_LABEL } from "@/config/payment-methods";
import type { Category, Product } from "@/types/catalog";
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
 *
 * **Every common action has a key.** A cashier at a keyboard till rings a sale
 * without touching the screen: scan, F2 to pay, type the cash, Enter. The keys
 * are printed on the buttons they press, so they are learnt by use rather than
 * from a training sheet. F-keys only, because every letter and digit belongs to
 * the scanner.
 */

const SHORTCUTS = {
  pay: "F2",
  hold: "F4",
  held: "F8",
  search: "F9",
} as const;

/** How long the void button waits for its second tap. */
const VOID_CONFIRM_MS = 4_000;

export function TillScreen({
  products,
  categories,
}: {
  products: Product[];
  categories: Category[];
}) {
  const lines = useBasketStore((s) => s.lines);
  const customer = useBasketStore((s) => s.customer);
  const feedback = useBasketStore((s) => s.feedback);
  const awaitingWeight = useBasketStore((s) => s.awaitingWeight);
  const touchedLineId = useBasketStore((s) => s.touchedLineId);
  const held = useBasketStore((s) => s.held);
  const canUndo = useBasketStore((s) => s.undo !== null);
  const add = useBasketStore((s) => s.add);
  const addWeighed = useBasketStore((s) => s.addWeighed);
  const requestWeight = useBasketStore((s) => s.requestWeight);
  const cancelWeight = useBasketStore((s) => s.cancelWeight);
  const increment = useBasketStore((s) => s.increment);
  const decrement = useBasketStore((s) => s.decrement);
  const remove = useBasketStore((s) => s.remove);
  const undoRemove = useBasketStore((s) => s.undoRemove);
  const setCustomer = useBasketStore((s) => s.setCustomer);
  const clear = useBasketStore((s) => s.clear);
  const hold = useBasketStore((s) => s.hold);
  const recall = useBasketStore((s) => s.recall);
  const reportScan = useBasketStore((s) => s.reportScan);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [findingCustomer, setFindingCustomer] = useState(false);
  const [showingHeld, setShowingHeld] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [settled, setSettled] = useState<Sale | null>(null);
  const [online, setOnline] = useState(true);
  const muted = useTillMuted();
  const searchRef = useRef<HTMLInputElement>(null);
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

  const overlayOpen =
    paying || findingCustomer || showingHeld || cameraOpen || Boolean(awaitingWeight);
  const heldFull = held.length >= MAX_HELD_SALES;

  // The basket survives a reload; it is read back here, after the first
  // render, so the server HTML and the client agree (see `stores/basket.ts`).
  useEffect(() => {
    void useBasketStore.persist.rehydrate();
  }, []);

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

  // The second tap has to come soon after the first, or it is not a
  // confirmation — it is the next, unrelated tap landing on the same spot.
  useEffect(() => {
    if (!confirmingVoid) return;
    const timer = window.setTimeout(() => setConfirmingVoid(false), VOID_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirmingVoid]);

  function handleScan(raw: string) {
    // The next customer's first scan clears the last customer's receipt —
    // there is no "Next sale" to press when the next sale has already begun.
    setSettled(null);

    const { code, multiplier } = parseScanEntry(raw);
    const result = resolveBarcode(index, code);

    if (!result.ok) {
      playScanTone("refused");
      reportScan({
        kind: result.code === "DELISTED" ? "delisted" : "unknown",
        barcode: result.barcode,
        at: Date.now(),
      });
      return;
    }

    playScanTone("accepted");
    pick(result.product, multiplier);
  }

  function pick(product: Product, multiplier = 1) {
    setConfirmingVoid(false);
    // A weighed product cannot be added by its code alone — the label says
    // which product, the scale says how much. A multiplier means nothing to
    // a scale, so it is dropped rather than guessed at.
    if (product.soldBy === "weight") {
      requestWeight(product);
      return;
    }
    add(product, units(multiplier));
  }

  function handleVoid() {
    // Two taps. One tap at the top of the tape used to drop a forty-item
    // basket with no way back, with the customer watching.
    if (!confirmingVoid) {
      setConfirmingVoid(true);
      return;
    }
    setConfirmingVoid(false);
    clear();
  }

  function handleHold() {
    if (!staff || lines.length === 0) return;
    setConfirmingVoid(false);
    hold(staff.fullName);
  }

  const toggleMute = () => setTillMuted(!muted);

  /**
   * Settle, and record.
   *
   * This is where the till stops being a calculator. The sale and the stock
   * movements it caused are built together and appended in one write, so the
   * manager's stock screen and HQ's sales-per-person move the moment the
   * customer walks away. Nothing here awaits the network — the write is local
   * and syncs behind it (rule 8).
   */
  function handleSettle(moneyTenders: Tender[], redeemedPoints: number) {
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
    tenders.push(...moneyTenders.filter((tender) => tender.amount.kobo > 0));

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
    // `clear` takes the card with it: the card belongs to the sale that just
    // closed, not to the next customer in the queue. Forgetting to clear it is
    // how somebody else earns points.
    clear();
  }

  /* ── Keys ─────────────────────────────────────────────────────────────── */

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && settled) {
      setSettled(null);
      event.preventDefault();
      return;
    }
    // A sheet owns the keyboard while it is open.
    if (overlayOpen) return;

    switch (event.key) {
      case SHORTCUTS.pay:
        if (lines.length > 0) {
          setSettled(null);
          setPaying(true);
        }
        break;
      case SHORTCUTS.hold:
        handleHold();
        break;
      case SHORTCUTS.held:
        setSettled(null);
        setShowingHeld(true);
        break;
      case SHORTCUTS.search:
        searchRef.current?.focus();
        searchRef.current?.select();
        break;
      default:
        return;
    }
    // F-keys mean things to the browser too; on the till they mean these.
    event.preventDefault();
  });

  useEffect(() => {
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

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
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? "Scan sounds off — turn on" : "Scan sounds on — turn off"}
            className="grid size-touch-till shrink-0 place-items-center rounded-input border-2 border-line bg-surface text-ink-70 transition-colors duration-150 ease-out-pos hover:border-market hover:text-market focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
          >
            {muted ? <VolumeX size={24} aria-hidden /> : <Volume2 size={24} aria-hidden />}
          </button>
          {/* Same control, same corner, as every other workspace. A shared till
              must never leave the previous cashier's session on the screen with
              no visible way out (§17). */}
          <AccountMenu />
        </div>

        <ScanFeedbackBar
          feedback={feedback}
          canUndo={canUndo}
          onUndo={undoRemove}
        />
      </header>

      {/* ── Grid + tape ────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label="Products"
          // `min-w-0`: without it the section's minimum width is the full,
          // unscrolled category strip, the row outgrows the screen, and the
          // whole till slides sideways the first time a line scrolls into view.
          className="flex min-h-0 min-w-0 flex-1 flex-col border-line lg:border-r"
        >
          <div className="shrink-0 px-4 pt-4">
            <div className="relative">
              <Search
                size={20}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-40"
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Escape hands the keyboard straight back to the scanner.
                  if (event.key === "Escape") {
                    setQuery("");
                    event.currentTarget.blur();
                  }
                }}
                placeholder="Search products"
                aria-label="Search products"
                aria-keyshortcuts={SHORTCUTS.search}
                className="min-h-touch-till w-full rounded-input border border-line bg-surface pr-16 pl-12 text-body-lg text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-none"
              />
              <Kbd className="absolute top-1/2 right-3 -translate-y-1/2">{SHORTCUTS.search}</Kbd>
            </div>
          </div>

          <ProductGrid
            products={visible}
            categories={categories}
            activeCategory={category}
            onCategory={setCategory}
            onPick={(product) => pick(product)}
          />
        </section>

        {/* The tape is a fixed column, not a flexible one: the totals must sit
            in the same place on every sale, so the cashier's eye and the
            customer's both know where to look. */}
        <section
          aria-label="This sale"
          className="flex min-h-0 shrink-0 flex-col border-t border-line bg-surface lg:w-100 lg:border-t-0 xl:w-112"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2">
            <h2 className="text-label whitespace-nowrap uppercase text-ink-70">This sale</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowingHeld(true)}
                aria-keyshortcuts={SHORTCUTS.held}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-input px-2 font-medium transition-colors duration-150 ease-out-pos focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
                  held.length > 0
                    ? "bg-sun text-ink hover:bg-signal-tint"
                    : "text-ink-70 hover:bg-paper",
                )}
              >
                <PlayCircle size={18} aria-hidden />
                Held{held.length > 0 ? ` · ${held.length}` : ""}
              </button>
              {lines.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleHold}
                    disabled={heldFull}
                    aria-keyshortcuts={SHORTCUTS.hold}
                    title={heldFull ? `${MAX_HELD_SALES} sales already held — resume one first` : undefined}
                    className="flex min-h-11 items-center gap-1.5 rounded-input px-2 font-medium text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-signal-tint hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <PauseCircle size={18} aria-hidden />
                    Hold
                  </button>
                  <button
                    type="button"
                    onClick={handleVoid}
                    aria-live="polite"
                    className={cn(
                      "flex min-h-11 items-center gap-1.5 rounded-input px-2 font-medium transition-colors duration-150 ease-out-pos focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
                      confirmingVoid
                        ? "bg-halt text-white"
                        : "text-halt hover:bg-halt-tint",
                    )}
                  >
                    {confirmingVoid ? (
                      <TriangleAlert size={18} aria-hidden />
                    ) : (
                      <Trash2 size={18} aria-hidden />
                    )}
                    {confirmingVoid ? "Tap again to void" : "Void"}
                  </button>
                </>
              )}
            </div>
          </div>

          <ReceiptTape
            lines={lines}
            totals={totals}
            touchedLineId={touchedLineId}
            onIncrement={increment}
            onDecrement={decrement}
            onRemove={remove}
          />

          <footer className="shrink-0 border-t border-line p-4">
            {customer && (
              <p className="mb-2 truncate text-body text-market">
                Card: <span className="font-medium">{customer.customer.fullName}</span>
              </p>
            )}
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-body-lg text-ink-70">
                Total
                {totals.itemCount > 0 && (
                  <span className="hidden text-ink-40 sm:inline">
                    {" "}
                    · {totals.itemCount} {totals.itemCount === 1 ? "item" : "items"}
                  </span>
                )}
              </span>
              <span
                aria-live="polite"
                className="font-numeric font-display text-display-lg leading-none font-black text-ink tabular-nums"
              >
                {format(totals.total)}
              </span>
            </div>

            <button
              type="button"
              disabled={lines.length === 0}
              onClick={() => setPaying(true)}
              aria-keyshortcuts={SHORTCUTS.pay}
              className="mt-4 flex min-h-touch-till w-full items-center justify-center gap-3 rounded-input bg-market text-body-lg font-semibold text-white shadow-raised transition-colors duration-150 ease-out-pos hover:bg-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market disabled:cursor-not-allowed disabled:opacity-40"
            >
              Take payment
              <Kbd tone="onBrand">{SHORTCUTS.pay}</Kbd>
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
          active={!findingCustomer}
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

      {showingHeld && (
        <HeldSalesSheet
          held={held}
          hasOpenSale={lines.length > 0}
          onClose={() => setShowingHeld(false)}
          onResume={(id) => {
            if (staff) recall(id, staff.fullName);
            setShowingHeld(false);
          }}
        />
      )}

      {settled && <SaleComplete sale={settled} onDone={() => setSettled(null)} />}
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/**
 * A key, printed on the button it presses. Learnt by being seen every sale,
 * which is how a cashier goes from tapping to typing without being trained.
 * Hidden below `lg`: a tablet till has no F-keys to press.
 */
function Kbd({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "onBrand";
  className?: string;
}) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "hidden rounded-input border px-1.5 font-mono text-label leading-6 lg:inline-block",
        tone === "onBrand"
          ? "border-white/40 text-white/90"
          : "border-line bg-paper text-ink-40",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

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
 *
 * A removal carries its own undo, right where the eye already is.
 */
function ScanFeedbackBar({
  feedback,
  canUndo,
  onUndo,
}: {
  feedback: ScanFeedback | null;
  canUndo: boolean;
  onUndo: () => void;
}) {
  if (!feedback) return null;

  const shape = feedbackShape(feedback);
  const Icon = shape.icon;

  return (
    <div
      // `key` restarts the entry animation on a repeat scan of the same product,
      // which is what tells the cashier the second scan registered at all.
      key={feedback.at}
      className={cn(
        "mt-3 flex min-h-12 items-center justify-between gap-3 rounded-input border py-1.5 pr-1.5 pl-4 font-medium",
        shape.tone,
      )}
    >
      <p role="status" className="flex min-w-0 items-center gap-2.5">
        <Icon size={20} aria-hidden className="shrink-0" />
        <span className="truncate">{shape.text}</span>
      </p>
      {feedback.kind === "removed" && canUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-input border border-current px-3 font-semibold transition-colors duration-150 ease-out-pos hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
        >
          <Undo2 size={18} aria-hidden />
          Undo
        </button>
      )}
    </div>
  );
}

function feedbackShape(feedback: ScanFeedback) {
  switch (feedback.kind) {
    case "added":
      return {
        icon: CircleCheck,
        tone: "border-market/25 bg-market-tint text-market",
        text:
          feedback.quantity > 1
            ? `Added ${feedback.quantity} × ${feedback.productName}`
            : `Added ${feedback.productName}`,
      };
    case "delisted":
      return {
        icon: TriangleAlert,
        tone: "border-signal/40 bg-signal-tint text-signal",
        text: `${feedback.barcode} is delisted and cannot be sold`,
      };
    case "unknown":
      return {
        icon: CircleX,
        tone: "border-halt/30 bg-halt-tint text-halt",
        text: `No product for ${feedback.barcode}`,
      };
    case "removed":
      return {
        icon: Trash2,
        tone: "border-line bg-paper text-ink-70",
        text: `Removed ${feedback.productName}`,
      };
    case "held":
      return {
        icon: PauseCircle,
        tone: "border-signal/40 bg-signal-tint text-signal",
        text: "Sale held — serve the next customer",
      };
    case "recalled":
      return {
        icon: PlayCircle,
        tone: "border-market/25 bg-market-tint text-market",
        text: "Held sale resumed",
      };
  }
}

/** "Paid by transfer and cash" — every money method, in the order taken. */
function paidByLabel(sale: Sale): string {
  const methods = [
    ...new Set(sale.tenders.map((tender) => PAYMENT_METHOD_LABEL[tender.method].toLowerCase())),
  ];
  if (methods.length === 0) return "Paid";
  if (methods.length === 1) return `Paid by ${methods[0]}`;
  return `Paid by ${methods.slice(0, -1).join(", ")} and ${methods.at(-1)}`;
}

function SaleComplete({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const breakdown = sale.change.kobo > 0 ? changeBreakdown(sale.change) : null;

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
            {paidByLabel(sale)} · {format(sale.total)}
          </p>

          {breakdown && (
            <div className="mt-4 rounded-panel bg-market-tint px-5 py-4 text-left">
              <p className="text-center text-label uppercase text-market">Change to give</p>
              <p className="font-numeric mt-1 text-center font-display text-display-lg leading-none font-black text-market">
                {format(sale.change)}
              </p>
              <NotesToGive breakdown={breakdown} />
            </div>
          )}

          {sale.pointsEarned > 0 && (
            <p className="mt-3 text-body font-medium text-market">
              {sale.customerName} earned {sale.pointsEarned}{" "}
              {sale.pointsEarned === 1 ? "point" : "points"}
            </p>
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
        {/* The scan field stays live under this sheet, so the next customer's
            first item can simply be scanned. */}
        <p className="-mt-1 px-4 pb-4 text-center text-body text-ink-40">
          Or just scan the next customer&apos;s first item
        </p>
      </div>
    </div>
  );
}
