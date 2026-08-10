"use client";

import { useMemo, useState } from "react";
import {
  Camera,
  CircleAlert,
  CircleCheck,
  PackagePlus,
  Search,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { CameraScannerSheet } from "@/components/till/camera-scanner-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { TableScroller } from "@/components/ui/table-scroller";
import { useBarcodeDetectorSupported } from "@/lib/hooks/use-camera-scanner";
import { useBranchData } from "@/lib/hooks/use-branch-data";
import { useLedgerStore } from "@/lib/stores/ledger";
import { useSessionStore } from "@/lib/stores/session";
import { indexByBarcode, resolveBarcode, searchProducts } from "@/lib/domain/catalog";
import { formatWhole, multiply, sum, type Money } from "@/lib/domain/money";
import {
  ZERO_QTY,
  addQty,
  formatQty,
  toNumber,
  units,
  type Quantity,
} from "@/lib/domain/quantity";
import { isLow, isOversold } from "@/lib/domain/stock";
import type { Product } from "@/types/catalog";
import type { StockEntry } from "@/types/stock";
import { cn } from "@/lib/utils/cn";

/**
 * Branch stock — SPEC §10, §15.2.
 *
 * Two jobs on one screen: see what is on hand, and put more of it in. They
 * belong together because they are the same loop — a manager checks a line,
 * finds it short, and receives the delivery that fixes it without navigating
 * anywhere.
 *
 * **Every figure here is derived.** There is no editable quantity anywhere on
 * this screen, and there is no code path that sets one. Receiving stock appends
 * `PURCHASE_RECEIPT` movements to the ledger and the balances recompute from
 * them (CLAUDE.md rule 3). That is why a mistake is corrected by appending the
 * opposite movement rather than by editing a number.
 */

type IntakeLine = {
  product: Product;
  quantity: Quantity;
};

export function StockScreen({
  products,
  isoDay,
}: {
  products: Product[];
  isoDay: string;
}) {
  // Who is receiving and into which branch comes from the session, not from a
  // prop the page guessed. Hardcoding it meant one cashier could sign in and
  // the ledger would record a different manager taking the delivery.
  const staff = useSessionStore((s) => s.session?.staff ?? null);
  const branchId = staff?.branchId ?? null;

  const { balances } = useBranchData(branchId, isoDay);
  const receiveStock = useLedgerStore((s) => s.receiveStock);

  const [intake, setIntake] = useState<IntakeLine[]>([]);
  const [query, setQuery] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraSupported = useBarcodeDetectorSupported();
  const [notice, setNotice] = useState<
    { tone: "market" | "halt" | "signal"; text: string } | null
  >(null);

  const index = useMemo(() => indexByBarcode(products), [products]);

  const rows = useMemo(() => {
    const live = products.filter((product) => !product.delistedAt);
    return searchProducts(live, query)
      .map((product) => {
        const onHand = balances.get(product.id)?.onHand ?? ZERO_QTY;
        return {
          product,
          onHand,
          low: isLow(onHand, product.reorderLevel),
          oversold: isOversold(onHand),
          value: multiply(product.cost, toNumber(onHand)),
        };
      })
      .sort((a, b) => {
        // Problems first: oversold, then low, then everything else by name.
        const rank = (r: (typeof a)) => (r.oversold ? 0 : r.low ? 1 : 2);
        return rank(a) - rank(b) || a.product.name.localeCompare(b.product.name);
      });
  }, [products, balances, query]);

  const summary = useMemo(() => {
    const all = products.filter((p) => !p.delistedAt);
    let low = 0;
    let oversold = 0;
    const values: Money[] = [];

    for (const product of all) {
      const onHand = balances.get(product.id)?.onHand ?? ZERO_QTY;
      if (isOversold(onHand)) oversold++;
      else if (isLow(onHand, product.reorderLevel)) low++;
      values.push(multiply(product.cost, toNumber(onHand)));
    }

    return { lines: all.length, low, oversold, value: sum(values) };
  }, [products, balances]);

  function handleScan(raw: string) {
    const result = resolveBarcode(index, raw);

    if (!result.ok) {
      setNotice(
        result.code === "DELISTED"
          ? {
              tone: "signal",
              text: `${result.barcode} is delisted. It cannot be received into stock.`,
            }
          : { tone: "halt", text: `No product matches ${result.barcode}.` },
      );
      return;
    }

    addToIntake(result.product);
  }

  function addToIntake(product: Product) {
    setNotice(null);
    setIntake((current) => {
      const existing = current.findIndex((line) => line.product.id === product.id);
      if (existing !== -1) {
        return current.map((line, i) =>
          i === existing ? { ...line, quantity: addQty(line.quantity, units(1)) } : line,
        );
      }
      return [...current, { product, quantity: units(1) }];
    });
  }

  function setIntakeQuantity(productId: string, value: number) {
    setIntake((current) =>
      value <= 0
        ? current.filter((line) => line.product.id !== productId)
        : current.map((line) =>
            line.product.id === productId ? { ...line, quantity: units(value) } : line,
          ),
    );
  }

  /**
   * Commit the delivery — one `PURCHASE_RECEIPT` movement per line, appended.
   *
   * Nothing is overwritten and no balance is set. If the manager keyed 12 when
   * the box held 10, the fix is a `CORRECTION` of −2 later, which leaves both
   * the claim and the correction on the record for the audit log (rule 4).
   */
  function receive() {
    if (intake.length === 0 || !staff || !branchId) return;

    const at = new Date().toISOString();
    const written: Omit<StockEntry, "id">[] = intake.map((line) => ({
      branchId,
      productId: line.product.id,
      delta: line.quantity,
      reason: "PURCHASE_RECEIPT",
      at,
      staffId: staff.id,
      staffName: staff.fullName,
      note: "Received by scan",
    }));

    receiveStock(written);
    setIntake([]);
    setNotice({
      tone: "market",
      text: `Received ${written.length} ${written.length === 1 ? "line" : "lines"} into stock. Balances updated.`,
    });
  }

  const intakeUnits = intake.reduce((total, line) => addQty(total, line.quantity), ZERO_QTY);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto grid min-w-0 items-start gap-5 p-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      {/* ── On hand ────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-5">
        <div className="grid min-w-0 gap-5 sm:grid-cols-3">
          <Panel>
            <StatTile
              label="Stock value"
              value={formatWhole(summary.value)}
              hint="At cost"
            />
          </Panel>
          <Panel>
            <StatTile
              label="Below reorder"
              value={String(summary.low)}
              hint={`of ${summary.lines} lines`}
            />
          </Panel>
          <Panel>
            <StatTile
              label="Oversold"
              value={String(summary.oversold)}
              hint="Below zero on hand"
            />
          </Panel>
        </div>

        <Panel>
          <PanelHeader
            title="Stock on hand"
            meta="Derived from the ledger — never edited directly"
          />

          <div className="border-b border-line p-4">
            <div className="relative">
              <Search
                size={18}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-40"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or SKU"
                aria-label="Search stock"
                className="min-h-touch-admin w-full rounded-input border border-line bg-surface pr-4 pl-10 text-body text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
              />
            </div>
          </div>

          <TableScroller>
            <table className="w-full min-w-160 text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase text-ink-40">
                  <th scope="col" className="px-5 py-3 font-semibold">Product</th>
                  <th scope="col" className="px-5 py-3 font-semibold">State</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">On hand</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Reorder at</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Value</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    <span className="sr-only">Receive</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.product.id} className="hover:bg-paper">
                    <th scope="row" className="px-5 py-3.5 font-medium text-ink">
                      {row.product.name}
                      <span className="font-mono block text-label tracking-normal text-ink-40">
                        {row.product.sku}
                      </span>
                    </th>
                    <td className="px-5 py-3.5">
                      <StockState oversold={row.oversold} low={row.low} />
                    </td>
                    <td
                      className={cn(
                        "px-5 py-3.5 text-right font-numeric font-semibold",
                        row.oversold ? "text-halt" : "text-ink",
                      )}
                    >
                      {formatQty(row.onHand)}
                      <span className="ml-1 font-normal text-ink-40">
                        {row.product.unit}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-numeric text-ink-40">
                      {formatQty(row.product.reorderLevel)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                      {formatWhole(row.value)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => addToIntake(row.product)}
                        className="inline-flex min-h-touch-admin items-center gap-1.5 rounded-input px-2 font-medium text-market transition-colors duration-150 ease-out-pos hover:bg-market-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
                      >
                        <PackagePlus size={17} aria-hidden />
                        Receive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>

          {rows.length === 0 && (
            <p className="px-5 py-10 text-center text-body-lg text-ink-70">
              Nothing matches that search.
            </p>
          )}
        </Panel>
      </div>

      {/* ── Receive by scan ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-20">
        <Panel>
          <PanelHeader
            title="Receive stock"
            meta="Scan the delivery in, line by line"
          />

          <div className="flex flex-col gap-4 p-4">
            <IntakeScanField
              onScan={handleScan}
              onCamera={cameraSupported ? () => setCameraOpen(true) : null}
            />

            {notice && (
              <Alert tone={notice.tone}>{notice.text}</Alert>
            )}

            {intake.length === 0 ? (
              <p className="py-6 text-center text-body text-ink-70">
                Scan a product, or press Receive on any line, to start a delivery.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-line rounded-input border border-line">
                  {intake.map((line) => (
                    <li
                      key={line.product.id}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">
                          {line.product.name}
                        </span>
                        <span className="text-label tracking-normal text-ink-40">
                          {line.product.unit}
                        </span>
                      </span>

                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={line.product.soldBy === "weight" ? 0.001 : 1}
                        value={toNumber(line.quantity)}
                        onChange={(event) =>
                          setIntakeQuantity(line.product.id, Number(event.target.value))
                        }
                        aria-label={`Quantity received of ${line.product.name}`}
                        className="min-h-touch-admin w-24 rounded-input border border-line bg-surface px-3 text-right font-numeric text-body text-ink transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
                      />

                      <button
                        type="button"
                        onClick={() => setIntakeQuantity(line.product.id, 0)}
                        aria-label={`Remove ${line.product.name} from this delivery`}
                        className="grid size-touch-admin shrink-0 place-items-center rounded-input text-ink-40 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
                      >
                        <X size={18} />
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between gap-3 text-body">
                  <span className="text-ink-70">
                    {intake.length} {intake.length === 1 ? "line" : "lines"}
                  </span>
                  <span className="font-numeric font-semibold text-ink">
                    {formatQty(intakeUnits)} units
                  </span>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setIntake([])}
                    className="flex-1"
                  >
                    <Undo2 size={17} aria-hidden />
                    Discard
                  </Button>
                  <Button onClick={receive} className="flex-2">
                    <PackagePlus size={18} aria-hidden />
                    Receive {intake.length}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="How this works" />
          <p className="px-5 py-4 text-body text-ink-70">
            Receiving appends a movement to the stock ledger. Balances on the left
            are the sum of every movement — they are never set directly, so a
            mistake is corrected by recording the opposite movement, and both stay
            on the record.
          </p>
        </Panel>
      </div>

      {cameraOpen && (
        <CameraScannerSheet
          onDetect={handleScan}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </main>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function IntakeScanField({
  onScan,
  onCamera,
}: {
  onScan: (barcode: string) => void;
  /** Null where the browser cannot decode — the keyed field is the whole UI. */
  onCamera: (() => void) | null;
}) {
  const [value, setValue] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const code = value.trim();
    if (!code) return;
    onScan(code);
    setValue("");
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Scan or type a barcode"
        aria-label="Scan a product into this delivery"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="min-h-touch-admin min-w-0 flex-1 rounded-input border border-line bg-surface px-3.5 text-body text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
      />
      {onCamera && (
      <button
        type="button"
        onClick={onCamera}
        aria-label="Scan with the camera"
        className="grid size-touch-admin shrink-0 place-items-center rounded-input border border-line bg-surface text-ink-70 transition-colors duration-150 ease-out-pos hover:border-market hover:bg-market-tint hover:text-market focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
      >
        <Camera size={19} />
      </button>
      )}
    </form>
  );
}

/** Never colour alone — an icon and a word carry the state too (§14). */
function StockState({ oversold, low }: { oversold: boolean; low: boolean }) {
  const shape = oversold
    ? { icon: CircleAlert, tone: "bg-halt-tint text-halt", label: "Oversold" }
    : low
      ? { icon: TriangleAlert, tone: "bg-sun text-ink", label: "Reorder" }
      : { icon: CircleCheck, tone: "bg-market-tint text-market", label: "In stock" };

  const Icon = shape.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-label font-semibold tracking-normal",
        shape.tone,
      )}
    >
      <Icon size={14} aria-hidden />
      {shape.label}
    </span>
  );
}
