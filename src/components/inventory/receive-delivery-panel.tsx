"use client";

import { useCallback, useMemo, useState } from "react";
import { Camera, PackagePlus, Truck, Undo2, Warehouse, X } from "lucide-react";
import { CameraScannerSheet } from "@/components/till/camera-scanner-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { indexByBarcode, resolveBarcode } from "@/lib/domain/catalog";
import { ProductSearch } from "@/components/inventory/product-search";
import { planDelivery, type DraftProblem } from "@/lib/domain/inventory";
import { formatWhole, multiply, naira, sum, toNaira, type Money, kobo, parseNaira } from "@/lib/domain/money";
import { useBarcodeDetectorSupported } from "@/lib/hooks/use-camera-scanner";
import { documentRef } from "@/lib/hooks/use-inventory";
import { useLedgerStore } from "@/lib/stores/ledger";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";
import type { StockSource } from "@/types/stock";
import type { Staff } from "@/types/staff";

/**
 * Receive a delivery — SPEC §7.7, §10.
 *
 * A delivery is one document: who sent it, their paperwork number, and the
 * lines on it. Each line becomes one `PURCHASE_RECEIPT` movement carrying the
 * source, what was paid and the batch's best-before, all sharing one GRN
 * reference so the deliveries list can put them back together. That is what
 * makes "what did the warehouse send us this month" answerable from the ledger
 * alone.
 *
 * The draft lives in the parent (see `useDeliveryDraft`) so the stock table can
 * add a line with one press without this panel owning the whole screen.
 */

export type DraftLine = {
  product: Product;
  quantity: string;
  /** Naira, as keyed. Prefilled with the catalog cost. */
  unitCost: string;
  expiresOn: string;
};

export function useDeliveryDraft() {
  const [lines, setLines] = useState<DraftLine[]>([]);

  const add = useCallback((product: Product) => {
    setLines((current) => {
      const existing = current.findIndex((line) => line.product.id === product.id);
      if (existing !== -1) {
        return current.map((line, i) =>
          i === existing
            ? { ...line, quantity: String((Number(line.quantity) || 0) + 1) }
            : line,
        );
      }
      return [
        ...current,
        {
          product,
          quantity: "1",
          unitCost: String(toNaira(product.cost)),
          expiresOn: "",
        },
      ];
    });
  }, []);

  const update = useCallback((productId: string, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.product.id === productId ? { ...line, ...patch } : line)),
    );
  }, []);

  const remove = useCallback((productId: string) => {
    setLines((current) => current.filter((line) => line.product.id !== productId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  return { lines, add, update, remove, clear };
}

export type DeliveryDraftState = ReturnType<typeof useDeliveryDraft>;

/** A blank or unreadable cost becomes −1 kobo, which the planners reject by name. */
const costInput = (value: string): Money => parseNaira(value) ?? kobo(-1);

export function ReceiveDeliveryPanel({
  draft,
  products,
  branchId,
  branchCode,
  staff,
  today,
  knownSources,
  onReceived,
}: {
  draft: DeliveryDraftState;
  products: Product[];
  branchId: string;
  branchCode: string;
  staff: Staff;
  today: string;
  /** Names used before, offered as suggestions so spellings stay consistent. */
  knownSources: readonly StockSource[];
  onReceived?: (ref: string) => void;
}) {
  const appendMovements = useLedgerStore((s) => s.appendMovements);
  const cameraSupported = useBarcodeDetectorSupported();
  const [cameraOpen, setCameraOpen] = useState(false);

  const [kind, setKind] = useState<StockSource["kind"]>("warehouse");
  const [sourceName, setSourceName] = useState("");
  const [document, setDocument] = useState("");
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [notice, setNotice] = useState<{ tone: "market" | "halt" | "signal"; text: string } | null>(null);

  const live = useMemo(() => products.filter((p) => !p.delistedAt), [products]);
  const index = useMemo(() => indexByBarcode(products), [products]);

  const suggestions = useMemo(() => {
    const names = new Set<string>();
    for (const s of knownSources) if (s.kind === kind) names.add(s.name);
    return [...names].sort();
  }, [knownSources, kind]);

  const lineValues = draft.lines.map((line) => {
    const cost = costInput(line.unitCost);
    const qty = Number(line.quantity);
    return cost.kobo >= 0 && Number.isFinite(qty) && qty > 0 ? multiply(cost, qty) : naira(0);
  });
  const total = sum(lineValues);

  function handleScan(raw: string) {
    const result = resolveBarcode(index, raw);
    if (!result.ok) {
      setNotice(
        result.code === "DELISTED"
          ? { tone: "signal", text: `${result.barcode} is delisted. It cannot be received into stock.` }
          : { tone: "halt", text: `No product matches ${result.barcode}.` },
      );
      return;
    }
    setNotice(null);
    draft.add(result.product);
  }

  function receive() {
    const plan = planDelivery({
      source: { kind, name: sourceName, document },
      receivedOn: today,
      lines: draft.lines.map((line) => ({
        productId: line.product.id,
        productName: line.product.name,
        soldBy: line.product.soldBy,
        quantity: line.quantity.trim() === "" ? NaN : Number(line.quantity),
        unitCost: costInput(line.unitCost),
        expiresOn: line.expiresOn,
      })),
    });

    if (!plan.ok) {
      setProblems(plan.problems);
      setNotice(null);
      return;
    }

    const at = new Date();
    const ref = documentRef("GRN", branchCode, at);
    appendMovements(
      plan.lines.map((line) => ({
        branchId,
        productId: line.productId,
        delta: line.quantity,
        reason: "PURCHASE_RECEIPT" as const,
        at: at.toISOString(),
        staffId: staff.id,
        staffName: staff.fullName,
        ref,
        source: plan.source,
        unitCost: line.unitCost,
        ...(line.expiresOn ? { expiresOn: line.expiresOn } : {}),
      })),
    );

    draft.clear();
    setProblems([]);
    setDocument("");
    setNotice({
      tone: "market",
      text: `${ref} received from ${plan.source.name} — ${plan.lines.length} ${plan.lines.length === 1 ? "line" : "lines"}, ${formatWhole(total)}. Balances updated.`,
    });
    onReceived?.(ref);
  }

  const lineProblem = (i: number, field: DraftProblem["field"]) =>
    problems.find((p) => p.line === i && p.field === field);
  const sourceProblem = problems.find((p) => p.field === "source");

  return (
    <Panel>
      <PanelHeader title="Receive a delivery" meta="From the warehouse or a supplier" />

      <div className="flex flex-col gap-4 p-4">
        {/* Source */}
        <div role="radiogroup" aria-label="Delivered from" className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "warehouse", label: "Warehouse", icon: Warehouse },
              { value: "supplier", label: "Supplier", icon: Truck },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                "flex min-h-touch-admin items-center justify-center gap-2 rounded-input border font-medium",
                "transition-colors duration-150 ease-out-pos focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
                kind === value
                  ? "border-market bg-market-tint text-ink"
                  : "border-line bg-surface text-ink-70 hover:border-ink-40",
              )}
            >
              <Icon size={18} aria-hidden className={kind === value ? "text-market" : ""} />
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Field
            label={kind === "warehouse" ? "Which warehouse" : "Supplier name"}
            required
            error={sourceProblem?.message}
          >
            <input
              list={`sources-${kind}`}
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              placeholder={kind === "warehouse" ? "Swiftgrocers Central Warehouse" : "e.g. Jos Fresh Farms Co-op"}
              aria-invalid={Boolean(sourceProblem) || undefined}
              className={inputClass(Boolean(sourceProblem))}
            />
            <datalist id={`sources-${kind}`}>
              {suggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label={kind === "warehouse" ? "Waybill number" : "Invoice number"}>
            <input
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              placeholder={kind === "warehouse" ? "WB-4127" : "INV-7351"}
              autoCapitalize="characters"
              className={cn(inputClass(false), "font-mono")}
            />
          </Field>
        </div>

        {/* Add lines: scan, or search by name */}
        <div className="flex flex-col gap-2">
          <ScanField onScan={handleScan} onCamera={cameraSupported ? () => setCameraOpen(true) : null} />
          <ProductSearch
            products={live}
            onPick={(product) => {
              setNotice(null);
              draft.add(product);
            }}
            exclude={new Set(draft.lines.map((l) => l.product.id))}
            placeholder="…or search a product by name"
          />
        </div>

        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

        {problems.length > 0 && (
          <Alert tone="halt" title="Fix these before receiving">
            <ul className="list-disc pl-4">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </Alert>
        )}

        {draft.lines.length === 0 ? (
          <p className="py-4 text-center text-body text-ink-70">
            Scan the first product off the van, or press Receive on any stock line.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-line rounded-input border border-line">
              {draft.lines.map((line, i) => (
                <li key={line.product.id} className="flex flex-col gap-2 px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{line.product.name}</span>
                      <span className="text-label tracking-normal text-ink-40">
                        {line.product.sku} · {line.product.unit}
                      </span>
                    </span>
                    <span className="font-numeric font-semibold text-ink">
                      {formatWhole(lineValues[i])}
                    </span>
                    <button
                      type="button"
                      onClick={() => draft.remove(line.product.id)}
                      aria-label={`Remove ${line.product.name} from this delivery`}
                      className="grid size-touch-admin shrink-0 place-items-center rounded-input text-ink-40 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <MiniField label="Qty">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={line.product.soldBy === "weight" ? 0.001 : 1}
                        value={line.quantity}
                        onChange={(event) => draft.update(line.product.id, { quantity: event.target.value })}
                        aria-label={`Quantity of ${line.product.name}`}
                        aria-invalid={Boolean(lineProblem(i, "quantity")) || undefined}
                        className={cn(inputClass(Boolean(lineProblem(i, "quantity"))), "text-right font-numeric")}
                      />
                    </MiniField>
                    <MiniField label="Unit cost ₦">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={line.unitCost}
                        onChange={(event) => draft.update(line.product.id, { unitCost: event.target.value })}
                        aria-label={`Unit cost in naira of ${line.product.name}`}
                        aria-invalid={Boolean(lineProblem(i, "unitCost")) || undefined}
                        className={cn(inputClass(Boolean(lineProblem(i, "unitCost"))), "text-right font-numeric")}
                      />
                    </MiniField>
                    <MiniField label="Best before">
                      <input
                        type="date"
                        min={today}
                        value={line.expiresOn}
                        onChange={(event) => draft.update(line.product.id, { expiresOn: event.target.value })}
                        aria-label={`Best-before date of ${line.product.name}`}
                        aria-invalid={Boolean(lineProblem(i, "expiresOn")) || undefined}
                        className={cn(inputClass(Boolean(lineProblem(i, "expiresOn"))), "px-2 font-numeric")}
                      />
                    </MiniField>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between gap-3 text-body">
              <span className="text-ink-70">
                {draft.lines.length} {draft.lines.length === 1 ? "line" : "lines"}
              </span>
              <span className="font-numeric font-semibold text-ink">{formatWhole(total)} at cost</span>
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  draft.clear();
                  setProblems([]);
                }}
                className="flex-1"
              >
                <Undo2 size={17} aria-hidden />
                Discard
              </Button>
              <Button onClick={receive} className="flex-2">
                <PackagePlus size={18} aria-hidden />
                Receive {draft.lines.length}
              </Button>
            </div>
          </>
        )}
      </div>

      {cameraOpen && <CameraScannerSheet onDetect={handleScan} onClose={() => setCameraOpen(false)} />}
    </Panel>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

const inputClass = (invalid: boolean) =>
  cn(
    "min-h-touch-admin w-full min-w-0 rounded-input border bg-surface px-3 text-body text-ink placeholder:text-ink-40",
    "transition-colors duration-150 ease-out-pos focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market",
    invalid ? "border-halt" : "border-line hover:border-ink-40",
  );

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-body font-semibold text-ink">
        {label}
        {required && (
          <>
            {" "}
            <span aria-hidden className="text-halt">*</span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </span>
      {children}
      {error && <span className="text-body text-halt">{error}</span>}
    </label>
  );
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span aria-hidden className="text-label uppercase text-ink-40">{label}</span>
      {children}
    </div>
  );
}

function ScanField({
  onScan,
  onCamera,
}: {
  onScan: (barcode: string) => void;
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
        className={inputClass(false)}
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
