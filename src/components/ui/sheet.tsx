"use client";

import { useEffect, useId } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A panel that slides in from the right over the screen it belongs to.
 *
 * Used for every multi-field task in the manager and HQ workspaces — adjusting
 * stock, raising an order, receiving one — so the screen behind stays visible
 * and the person does not lose their place in a long table. Escape and the
 * backdrop both close it; nothing is saved until the footer's action is used.
 *
 * Rendered as a `<form>` when `onSubmit` is given, so Enter in a field submits
 * the way people expect from a form.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  onSubmit,
  footer,
  width = "md",
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  footer?: React.ReactNode;
  width?: "md" | "lg";
  children: React.ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = (
    <>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-title font-bold text-ink">
            {title}
          </h2>
          {subtitle && <div className="truncate text-body text-ink-70">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-touch-admin shrink-0 place-items-center rounded-input text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-paper focus-visible:outline-2 focus-visible:outline-market"
        >
          <X size={22} />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-5 p-5">{children}</div>

      {footer && (
        <footer className="sticky bottom-0 flex flex-wrap gap-3 border-t border-line bg-surface p-4">
          {footer}
        </footer>
      )}
    </>
  );

  const panelClass = cn(
    "flex w-full flex-col overflow-y-auto bg-paper shadow-raised",
    width === "lg" ? "max-w-200" : "max-w-120",
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink/50"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      {onSubmit ? (
        <form onSubmit={onSubmit} noValidate className={panelClass}>
          {body}
        </form>
      ) : (
        <div className={panelClass}>{body}</div>
      )}
    </div>
  );
}
