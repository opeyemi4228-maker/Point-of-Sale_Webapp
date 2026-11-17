"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, LoaderCircle } from "lucide-react";
import { buttonClass } from "@/components/ui/button-styles";
import { downloadCsv, type ReportSpec } from "@/lib/export/report";
import { useSessionStore } from "@/lib/stores/session";
import { stamp } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";

/**
 * "Export" — the one download control every report-shaped screen carries.
 *
 * Two formats, because they answer different people: a PDF is what gets
 * printed, signed and emailed to HQ or a supplier; a CSV is what finance opens
 * in a spreadsheet. Both are built from the same `ReportSpec`, which the screen
 * describes from exactly what it is showing — filters included — so the file
 * matches the screen.
 *
 * The report is built on press, not on render: assembling a few hundred rows
 * on every keystroke in a search box would be waste for a file nobody asked for.
 */
export function ExportMenu({
  build,
  label = "Export",
  disabled,
  className,
}: {
  build: () => ReportSpec;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const staff = useSessionStore((s) => s.session?.staff ?? null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(format: "pdf" | "csv") {
    setBusy(format);
    setError(null);
    try {
      const spec = build();
      if (format === "csv") {
        downloadCsv(spec);
      } else {
        const { downloadPdf } = await import("@/lib/export/pdf");
        await downloadPdf(spec, {
          preparedBy: staff ? staff.fullName : undefined,
          generatedAt: stamp(new Date().toISOString()),
        });
      }
      setOpen(false);
    } catch (cause) {
      console.error(cause);
      setError(
        format === "pdf"
          ? "The PDF could not be built. Check the connection once — the font loads on first use — and try again."
          : "The file could not be built. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={buttonClass("secondary", "admin", "gap-2 px-4")}
      >
        {busy ? <LoaderCircle size={18} aria-hidden className="animate-spin" /> : <Download size={18} aria-hidden />}
        {label}
        <ChevronDown size={16} aria-hidden className={cn("text-ink-40 transition-transform duration-150", open && "rotate-180")} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Export format"
          className="absolute top-full right-0 z-40 mt-2 w-72 overflow-hidden rounded-panel border border-line bg-surface shadow-raised"
        >
          <MenuItem
            icon={FileText}
            title="PDF report"
            detail="Formatted to print, sign or email"
            busy={busy === "pdf"}
            disabled={busy !== null}
            onClick={() => run("pdf")}
          />
          <MenuItem
            icon={FileSpreadsheet}
            title="CSV spreadsheet"
            detail="Opens in Excel or Google Sheets"
            busy={busy === "csv"}
            disabled={busy !== null}
            onClick={() => run("csv")}
          />
          {error && (
            <p role="alert" className="border-t border-line bg-halt-tint px-4 py-3 text-body text-halt">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  title,
  detail,
  busy,
  disabled,
  onClick,
}: {
  icon: typeof FileText;
  title: string;
  detail: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-touch-admin w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out-pos hover:bg-market-tint focus-visible:bg-market-tint focus-visible:outline-none disabled:opacity-60"
    >
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-input bg-market-tint text-market">
        {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Icon size={18} />}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-ink">{title}</span>
        <span className="block text-body text-ink-40">{detail}</span>
      </span>
    </button>
  );
}
