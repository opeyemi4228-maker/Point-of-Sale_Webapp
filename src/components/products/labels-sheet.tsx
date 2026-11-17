"use client";

import { useState } from "react";
import { Minus, Plus, Printer, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { formatWhole } from "@/lib/domain/money";
import { dayDate } from "@/lib/utils/format-date";
import type { Product } from "@/types/catalog";

/**
 * Print shelf-edge labels for the chosen products — on 24-per-sheet A4 label
 * stock (see `lib/export/labels.ts`). Copies per product, because a line
 * faced in three places needs three labels.
 */
const PER_SHEET = 24;

export function LabelsSheet({
  products,
  today,
  onClose,
}: {
  products: Product[];
  today: string;
  onClose: () => void;
}) {
  const [copies, setCopies] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.id, 1])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState(products);

  const total = list.reduce((n, p) => n + (copies[p.id] ?? 0), 0);
  const sheets = Math.ceil(total / PER_SHEET);

  async function print() {
    setBusy(true);
    setError(null);
    try {
      const { downloadShelfLabels } = await import("@/lib/export/labels");
      await downloadShelfLabels(
        list.map((product) => ({ product, copies: copies[product.id] ?? 0 })),
        { printedOn: dayDate(today), isoDay: today },
      );
      onClose();
    } catch (cause) {
      console.error(cause);
      setError("The labels could not be built. Try again — the font loads on first use.");
    } finally {
      setBusy(false);
    }
  }

  const step = (id: string, by: number) =>
    setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(48, (c[id] ?? 0) + by)) }));

  return (
    <Sheet
      title="Print shelf labels"
      subtitle={`${total} ${total === 1 ? "label" : "labels"} · ${sheets} A4 ${sheets === 1 ? "sheet" : "sheets"} of ${PER_SHEET}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={print} loading={busy} disabled={total === 0} className="flex-2">
            <Printer size={18} aria-hidden />
            Download labels PDF
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-70">
        Each label carries the name, the price, the part number and a scannable barcode, with today’s
        date so an old label is easy to spot. Print at 100% scale on 63.5 × 33.9 mm label stock.
      </p>
      {error && <Alert tone="halt">{error}</Alert>}
      <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{p.name}</span>
              <span className="block text-body text-ink-40">
                <span className="font-mono text-mono">{p.sku}</span> · {formatWhole(p.price)}
              </span>
            </span>
            <button type="button" onClick={() => step(p.id, -1)} aria-label={`One fewer label for ${p.name}`} className="grid size-touch-admin place-items-center rounded-input border border-line text-ink-70 hover:border-ink-40">
              <Minus size={16} />
            </button>
            <span className="w-8 text-center font-numeric font-semibold text-ink" aria-label={`${copies[p.id] ?? 0} labels`}>{copies[p.id] ?? 0}</span>
            <button type="button" onClick={() => step(p.id, 1)} aria-label={`One more label for ${p.name}`} className="grid size-touch-admin place-items-center rounded-input border border-line text-ink-70 hover:border-ink-40">
              <Plus size={16} />
            </button>
            <button type="button" onClick={() => setList((l) => l.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`} className="grid size-touch-admin place-items-center rounded-input text-ink-40 hover:bg-halt-tint hover:text-halt">
              <X size={17} />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
