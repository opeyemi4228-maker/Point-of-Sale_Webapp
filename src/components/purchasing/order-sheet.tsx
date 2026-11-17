"use client";

import { useMemo, useState } from "react";
import { ListPlus, Save, Send, Truck, Warehouse, X } from "lucide-react";
import { ProductSearch } from "@/components/inventory/product-search";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { formatWhole, multiply, naira, sum, toNaira, type Money, kobo, parseNaira } from "@/lib/domain/money";
import { ZERO_QTY, formatQty } from "@/lib/domain/quantity";
import { balancesForBranch } from "@/lib/domain/stock";
import { planOrder, suggestedQuantity, type OrderProblem } from "@/lib/domain/purchasing";
import { usePurchaseOrderStore, nextOrderReference } from "@/lib/stores/purchase-orders";
import { cn } from "@/lib/utils/cn";
import type { BranchSummary } from "@/lib/data/repositories";
import type { Product } from "@/types/catalog";
import type { PurchaseOrder } from "@/types/operations";
import type { StockEntry } from "@/types/stock";
import type { Staff } from "@/types/staff";
import type { Quantity } from "@/lib/domain/quantity";

/**
 * Raise or edit a purchase order — SPEC §7.7.
 *
 * Saves as a draft or sends. A sent order is fixed: it is what the supplier
 * was told, and changing it afterwards would make the paperwork disagree with
 * the van. To change a sent order, cancel it and raise another.
 *
 * "Add everything below reorder" fills the order from the branch's own ledger,
 * net of what is already on its way, so two managers opening the screen the
 * same morning do not order the same shortfall twice.
 */

type Line = { product: Product; quantity: string; unitCost: string };

/** A blank or unreadable cost becomes −1 kobo, which the planners reject by name. */
const costInput = (value: string): Money => parseNaira(value) ?? kobo(-1);

export function OrderSheet({
  branch,
  staff,
  products,
  entries,
  allOrders,
  onOrder,
  existing,
  today,
  knownSuppliers,
  onClose,
  onSaved,
}: {
  branch: BranchSummary;
  staff: Staff;
  products: Product[];
  /** The branch's ledger, for on-hand and reorder suggestions. */
  entries: readonly StockEntry[];
  /** Every order in the chain, for a reference that never repeats. */
  allOrders: readonly PurchaseOrder[];
  /** Units already on order for this branch, per product. */
  onOrder: Map<string, Quantity>;
  existing?: PurchaseOrder;
  today: string;
  knownSuppliers: readonly { name: string; kind: "warehouse" | "supplier" }[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const save = usePurchaseOrderStore((s) => s.save);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const balances = useMemo(() => balancesForBranch(entries, branch.id), [entries, branch.id]);

  const [kind, setKind] = useState<"warehouse" | "supplier">(existing?.supplierKind ?? "supplier");
  const [supplier, setSupplier] = useState(existing?.supplier ?? "");
  const [expectedOn, setExpectedOn] = useState(existing?.expectedOn ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [lines, setLines] = useState<Line[]>(
    () =>
      existing?.lines.flatMap((l) => {
        const product = productById.get(l.productId);
        return product
          ? [{ product, quantity: String(l.quantity.milli / 1000), unitCost: String(toNaira(l.unitCost)) }]
          : [];
      }) ?? [],
  );
  const [problems, setProblems] = useState<OrderProblem[]>([]);
  const [hint, setHint] = useState<string | null>(null);

  const onList = useMemo(() => new Set(lines.map((l) => l.product.id)), [lines]);
  const suppliers = useMemo(
    () => [...new Set(knownSuppliers.filter((s) => s.kind === kind).map((s) => s.name))].sort(),
    [knownSuppliers, kind],
  );

  function add(product: Product, quantity = 1) {
    setProblems([]);
    setLines((current) => {
      const i = current.findIndex((l) => l.product.id === product.id);
      if (i !== -1) {
        return current.map((l, j) =>
          j === i ? { ...l, quantity: String((Number(l.quantity) || 0) + quantity) } : l,
        );
      }
      return [...current, { product, quantity: String(quantity), unitCost: String(toNaira(product.cost)) }];
    });
  }

  function addBelowReorder() {
    let added = 0;
    for (const product of products) {
      if (product.delistedAt || onList.has(product.id)) continue;
      const qty = suggestedQuantity(
        balances.get(product.id)?.onHand ?? ZERO_QTY,
        product.reorderLevel,
        onOrder.get(product.id) ?? ZERO_QTY,
        product.soldBy,
      );
      if (qty > 0) {
        add(product, qty);
        added++;
      }
    }
    setHint(
      added === 0
        ? "Nothing below reorder level that is not already on order."
        : `Added ${added} ${added === 1 ? "line" : "lines"} — enough to reach twice the reorder level, less what is on hand and already on order. Adjust as needed.`,
    );
  }

  const values = lines.map((l) => multiply(parseNaira(l.unitCost) ?? naira(0), Number(l.quantity) || 0));
  const total = sum(values);

  function submit(send: boolean) {
    const plan = planOrder({
      supplier,
      expectedOn,
      today,
      lines: lines.map((l) => ({
        productId: l.product.id,
        productName: l.product.name,
        soldBy: l.product.soldBy,
        quantity: l.quantity.trim() === "" ? NaN : Number(l.quantity),
        unitCost: costInput(l.unitCost),
      })),
    });
    if (!plan.ok) {
      setProblems(plan.problems);
      return;
    }
    if (send && !expectedOn) {
      setProblems([{ field: "expectedOn", message: "Give the supplier a delivery date before sending." }]);
      return;
    }

    const now = new Date().toISOString();
    const order: PurchaseOrder = {
      id: existing?.id ?? `po_local_${now.replace(/\D/g, "")}`,
      reference: existing?.reference ?? nextOrderReference(allOrders, branch.code),
      branchId: branch.id,
      supplier: supplier.trim(),
      supplierKind: kind,
      lines: plan.lines,
      expectedOn: expectedOn || null,
      note: note.trim() || null,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? staff.fullName,
      sentAt: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
    };

    save(order, {
      action: existing ? "edited" : "raised",
      at: now,
      by: staff.fullName,
      detail: `${plan.lines.length} lines, ${formatWhole(total)}`,
    });
    if (send) {
      save({ ...order, sentAt: now }, { action: "sent", at: now, by: staff.fullName, detail: `To ${order.supplier}` });
    }

    onSaved(
      send
        ? `${order.reference} sent to ${order.supplier} — ${formatWhole(total)}, expected ${expectedOn}.`
        : `${order.reference} saved as a draft. Send it when it is ready.`,
    );
  }

  const problem = (field: OrderProblem["field"], line?: number) =>
    problems.find((p) => p.field === field && (line === undefined || p.line === line));

  return (
    <Sheet
      title={existing ? `Edit ${existing.reference}` : "New purchase order"}
      subtitle={`${branch.name} branch`}
      width="lg"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        submit(false);
      }}
      footer={
        <>
          <div className="mr-auto flex flex-col justify-center">
            <span className="text-label uppercase text-ink-40">Order total</span>
            <span className="font-numeric text-title font-bold text-ink">{formatWhole(total)}</span>
          </div>
          <Button type="submit" variant="secondary">
            <Save size={18} aria-hidden />
            Save draft
          </Button>
          <Button type="button" onClick={() => submit(true)}>
            <Send size={18} aria-hidden />
            Send order
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Ordering from" className="grid grid-cols-2 gap-2">
        {(
          [
            { value: "supplier", label: "Supplier", icon: Truck },
            { value: "warehouse", label: "Warehouse", icon: Warehouse },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className={cn(
              "flex min-h-touch-admin items-center justify-center gap-2 rounded-input border font-medium transition-colors duration-150 ease-out-pos focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
              kind === value ? "border-market bg-market-tint text-ink" : "border-line bg-surface text-ink-70 hover:border-ink-40",
            )}
          >
            <Icon size={18} aria-hidden className={kind === value ? "text-market" : ""} />
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field label={kind === "warehouse" ? "Warehouse" : "Supplier"} required error={problem("supplier")?.message}>
          <input
            list="order-suppliers"
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
            placeholder={kind === "warehouse" ? "Swiftgrocers Central Warehouse" : "e.g. Honeywell Flour Mills"}
            className={inputClass(Boolean(problem("supplier")))}
            autoFocus
          />
          <datalist id="order-suppliers">
            {suppliers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Expected delivery" error={problem("expectedOn")?.message}>
          <input
            type="date"
            min={today}
            value={expectedOn}
            onChange={(event) => setExpectedOn(event.target.value)}
            className={cn(inputClass(Boolean(problem("expectedOn"))), "font-numeric")}
          />
        </Field>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ProductSearch products={products} onPick={(p) => add(p)} exclude={onList} className="min-w-60 flex-1" />
          <Button type="button" variant="secondary" onClick={addBelowReorder}>
            <ListPlus size={18} aria-hidden />
            Add everything below reorder
          </Button>
        </div>
        {hint && <Alert tone="info">{hint}</Alert>}

        {problems.some((p) => p.field !== "supplier" && p.field !== "expectedOn") && (
          <Alert tone="halt" title="Fix these before saving">
            <ul className="list-disc pl-4">
              {problems
                .filter((p) => p.field !== "supplier" && p.field !== "expectedOn")
                .map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
            </ul>
          </Alert>
        )}

        {lines.length === 0 ? (
          <p className="rounded-panel border border-dashed border-line px-5 py-8 text-center text-body text-ink-70">
            Search for a product above, or add everything that is below its reorder level in one go.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-panel border border-line bg-surface">
            <table className="w-full min-w-150 text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase text-ink-40">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Product</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">On hand</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">Order qty</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">Unit cost ₦</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold">Value</th>
                  <th scope="col" className="w-12 py-2.5 pr-2"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l, i) => {
                  const onHand = balances.get(l.product.id)?.onHand ?? ZERO_QTY;
                  return (
                    <tr key={l.product.id}>
                      <th scope="row" className="px-4 py-2 font-medium text-ink">
                        {l.product.name}
                        <span className="block font-mono text-label tracking-normal text-ink-40">
                          {l.product.sku} · reorder at {formatQty(l.product.reorderLevel)}
                        </span>
                      </th>
                      <td className="px-2 py-2 text-right font-numeric text-ink-70">
                        {formatQty(onHand)} {l.product.unit}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={l.product.soldBy === "weight" ? 0.001 : 1}
                          value={l.quantity}
                          onChange={(event) =>
                            setLines((c) => c.map((x, j) => (j === i ? { ...x, quantity: event.target.value } : x)))
                          }
                          aria-label={`Order quantity of ${l.product.name}`}
                          className={cn(inputClass(Boolean(problem("quantity", i))), "w-24 text-right font-numeric")}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={l.unitCost}
                          onChange={(event) =>
                            setLines((c) => c.map((x, j) => (j === i ? { ...x, unitCost: event.target.value } : x)))
                          }
                          aria-label={`Unit cost in naira of ${l.product.name}`}
                          className={cn(inputClass(Boolean(problem("unitCost", i))), "w-28 text-right font-numeric")}
                        />
                      </td>
                      <td className="px-2 py-2 text-right font-numeric font-semibold text-ink">{formatWhole(values[i])}</td>
                      <td className="py-2 pr-2">
                        <button
                          type="button"
                          onClick={() => setLines((c) => c.filter((_, j) => j !== i))}
                          aria-label={`Remove ${l.product.name} from the order`}
                          className="grid size-touch-admin place-items-center rounded-input text-ink-40 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
                        >
                          <X size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Field label="Note to file (optional)">
        <textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Chase if not here by Tuesday"
          className={cn(inputClass(false), "py-2.5")}
        />
      </Field>
    </Sheet>
  );
}

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
