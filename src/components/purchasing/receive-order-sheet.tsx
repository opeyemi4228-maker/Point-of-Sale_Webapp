"use client";

import { useMemo, useState } from "react";
import { PackageCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { formatWhole, multiply, naira, sum, toNaira, type Money, kobo, parseNaira } from "@/lib/domain/money";
import { formatQty } from "@/lib/domain/quantity";
import { planOrderReceipt, type OrderProgress, type ReceiveProblem } from "@/lib/domain/purchasing";
import { documentRef } from "@/lib/hooks/use-inventory";
import { useLedgerStore } from "@/lib/stores/ledger";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";
import type { PurchaseOrder } from "@/types/operations";
import type { Staff } from "@/types/staff";

/**
 * Receive a delivery against an order — SPEC §7.7, §10.
 *
 * Each line starts at what is still outstanding, because the common case is
 * "it all came". The manager corrects the lines that came short, and anything
 * left outstanding keeps the order open for the next van. Every line received
 * becomes a `PURCHASE_RECEIPT` that names the order, which is how the order
 * knows it has been filled (rule 3).
 */

type Row = { quantity: string; unitCost: string; expiresOn: string };

/** A blank or unreadable cost becomes −1 kobo, which the planners reject by name. */
const costInput = (value: string): Money => parseNaira(value) ?? kobo(-1);

export function ReceiveOrderSheet({
  order,
  progress,
  products,
  branchCode,
  staff,
  today,
  onClose,
  onDone,
}: {
  order: PurchaseOrder;
  progress: OrderProgress;
  products: readonly Product[];
  branchCode: string;
  staff: Staff;
  today: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const appendMovements = useLedgerStore((s) => s.appendMovements);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [invoice, setInvoice] = useState("");
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      progress.lines.map((l) => [
        l.productId,
        {
          quantity: l.outstanding.milli > 0 ? String(l.outstanding.milli / 1000) : "",
          unitCost: String(toNaira(l.unitCost)),
          expiresOn: "",
        },
      ]),
    ),
  );
  const [problems, setProblems] = useState<ReceiveProblem[]>([]);

  const value = sum(
    progress.lines.map((l) => {
      const row = rows[l.productId];
      const cost = costInput(row.unitCost);
      return cost.kobo >= 0 ? multiply(cost, Number(row.quantity) || 0) : naira(0);
    }),
  );

  function update(productId: string, patch: Partial<Row>) {
    setProblems([]);
    setRows((current) => ({ ...current, [productId]: { ...current[productId], ...patch } }));
  }

  function setAll(full: boolean) {
    setProblems([]);
    setRows((current) =>
      Object.fromEntries(
        progress.lines.map((l) => [
          l.productId,
          { ...current[l.productId], quantity: full && l.outstanding.milli > 0 ? String(l.outstanding.milli / 1000) : "" },
        ]),
      ),
    );
  }

  function receive(event: React.FormEvent) {
    event.preventDefault();
    const plan = planOrderReceipt(
      progress,
      progress.lines.map((l) => {
        const product = productById.get(l.productId);
        const row = rows[l.productId];
        return {
          productId: l.productId,
          productName: product?.name ?? l.productId,
          soldBy: product?.soldBy ?? "unit",
          quantity: row.quantity.trim() === "" ? 0 : Number(row.quantity),
          unitCost: costInput(row.unitCost),
          expiresOn: row.expiresOn,
        };
      }),
      today,
    );

    if (!plan.ok) {
      setProblems(plan.problems);
      return;
    }

    const at = new Date();
    const grn = documentRef("GRN", branchCode, at);
    appendMovements(
      plan.lines.map((line) => ({
        branchId: order.branchId,
        productId: line.productId,
        delta: line.quantity,
        reason: "PURCHASE_RECEIPT" as const,
        at: at.toISOString(),
        staffId: staff.id,
        staffName: staff.fullName,
        ref: grn,
        orderRef: order.reference,
        source: {
          kind: order.supplierKind,
          name: order.supplier,
          ...(invoice.trim() ? { document: invoice.trim() } : {}),
        },
        unitCost: line.unitCost,
        ...(line.expiresOn ? { expiresOn: line.expiresOn } : {}),
      })),
    );

    const remaining = progress.lines.some((l) => {
      const got = Number(rows[l.productId].quantity) || 0;
      return l.outstanding.milli - Math.round(got * 1000) > 0;
    });
    onDone(
      `${grn} received against ${order.reference} — ${plan.lines.length} ${plan.lines.length === 1 ? "line" : "lines"}, ${formatWhole(value)}. ${remaining ? "The rest stays on order." : "The order is complete."}`,
    );
  }

  const problemFor = (index: number) => problems.find((p) => p.line === index);

  return (
    <Sheet
      title={`Receive ${order.reference}`}
      subtitle={`${order.supplier} · ordered ${formatWhole(progress.orderedValue)}`}
      width="lg"
      onClose={onClose}
      onSubmit={receive}
      footer={
        <>
          <div className="mr-auto flex flex-col justify-center">
            <span className="text-label uppercase text-ink-40">Receiving now</span>
            <span className="font-numeric text-title font-bold text-ink">{formatWhole(value)}</span>
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">
            <PackageCheck size={18} aria-hidden />
            Receive into stock
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-body font-semibold text-ink">
            {order.supplierKind === "warehouse" ? "Waybill number" : "Supplier invoice number"}
          </span>
          <input
            value={invoice}
            onChange={(event) => setInvoice(event.target.value)}
            placeholder="As printed on their paperwork"
            className={cn(inputClass(false), "font-mono")}
            autoFocus
          />
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setAll(true)}>
            Everything arrived
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAll(false)}>
            Clear
          </Button>
        </div>
      </div>

      {problems.length > 0 && (
        <Alert tone="halt" title="Nothing was received — fix these first">
          <ul className="list-disc pl-4">
            {problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-panel border border-line bg-surface">
        <table className="w-full min-w-170 text-left">
          <thead>
            <tr className="border-b border-line text-label uppercase text-ink-40">
              <th scope="col" className="px-4 py-2.5 font-semibold">Product</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Ordered</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Already in</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Arrived now</th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold">Unit cost ₦</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Best before</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {progress.lines.map((l, i) => {
              const product = productById.get(l.productId);
              const row = rows[l.productId];
              const done = l.outstanding.milli === 0;
              const bad = problemFor(i);
              return (
                <tr key={l.productId} className={cn(done && "bg-paper text-ink-40")}>
                  <th scope="row" className="px-4 py-2 font-medium text-ink">
                    {product?.name ?? l.productId}
                    <span className="block text-label tracking-normal text-ink-40">
                      {done ? "Complete" : `${formatQty(l.outstanding)} ${product?.unit ?? ""} outstanding`}
                    </span>
                  </th>
                  <td className="px-2 py-2 text-right font-numeric text-ink-70">{formatQty(l.ordered)}</td>
                  <td className="px-2 py-2 text-right font-numeric text-ink-70">{formatQty(l.received)}</td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={product?.soldBy === "weight" ? 0.001 : 1}
                      disabled={done}
                      value={row.quantity}
                      placeholder="0"
                      onChange={(event) => update(l.productId, { quantity: event.target.value })}
                      aria-label={`Quantity of ${product?.name ?? l.productId} that arrived`}
                      className={cn(inputClass(bad?.field === "quantity"), "w-24 text-right font-numeric disabled:bg-paper")}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      disabled={done}
                      value={row.unitCost}
                      onChange={(event) => update(l.productId, { unitCost: event.target.value })}
                      aria-label={`Unit cost paid for ${product?.name ?? l.productId}`}
                      className={cn(inputClass(bad?.field === "unitCost"), "w-28 text-right font-numeric disabled:bg-paper")}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="date"
                      min={today}
                      disabled={done}
                      value={row.expiresOn}
                      onChange={(event) => update(l.productId, { expiresOn: event.target.value })}
                      aria-label={`Best-before date of ${product?.name ?? l.productId}`}
                      className={cn(inputClass(bad?.field === "expiresOn"), "w-40 font-numeric disabled:bg-paper")}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-body text-ink-70">
        Leave a line at zero if it did not come. It stays on order for the next delivery.
        A supplier who sends more than was ordered is a separate delivery, received from
        the Deliveries screen.
      </p>
    </Sheet>
  );
}

const inputClass = (invalid: boolean) =>
  cn(
    "min-h-touch-admin w-full min-w-0 rounded-input border bg-surface px-3 text-body text-ink placeholder:text-ink-40",
    "transition-colors duration-150 ease-out-pos focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market",
    invalid ? "border-halt" : "border-line hover:border-ink-40",
  );
