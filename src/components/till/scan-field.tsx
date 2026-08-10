"use client";

import { useEffect, useRef } from "react";
import { Camera, ScanBarcode } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * The scan field — SPEC §15.1. The single most-used control in the system.
 *
 * A hardware scanner is a keyboard: it types the barcode and presses Enter. So
 * this is a plain text input, and the two things that matter are that it is
 * always focused and that it clears itself on submit.
 *
 * **Focus is stolen back deliberately.** If the cashier taps a product tile or
 * a quantity stepper, focus moves to that button, and the next physical scan
 * would be typed into nothing at all — the sale silently fails to register and
 * the queue grows while the cashier scans the same tin again. So focus returns
 * here whenever it lands somewhere that is not another text field. The
 * exception list is narrow on purpose: a cashier typing a weight or a customer
 * phone number keeps their caret.
 */
export function ScanField({
  onScan,
  onOpenCamera,
  cameraSupported,
  disabled,
}: {
  onScan: (barcode: string) => void;
  onOpenCamera: () => void;
  cameraSupported: boolean;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (disabled) return;

    const input = inputRef.current;
    input?.focus();

    const reclaim = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingSomewhereElse =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (!isTypingSomewhereElse) {
        // Deferred: taking focus back inside the same event that moved it
        // fights the browser and can swallow the click that caused it.
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };

    document.addEventListener("focusin", reclaim);
    return () => document.removeEventListener("focusin", reclaim);
  }, [disabled]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const input = inputRef.current;
    const value = input?.value.trim();
    if (!value) return;

    onScan(value);
    // Cleared immediately, not after a round trip: the next item is already
    // coming over the glass (rule 8).
    if (input) input.value = "";
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <div className="relative min-w-0 flex-1">
        <ScanBarcode
          size={24}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-market"
        />
        <input
          ref={inputRef}
          type="text"
          name="barcode"
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-label="Scan or type a barcode"
          placeholder="Scan a product, or type its code"
          className={cn(
            "min-h-touch-till w-full rounded-input border-2 border-line bg-surface pr-4 pl-13",
            "text-body-lg text-ink placeholder:text-ink-40",
            "transition-colors duration-150 ease-out-pos",
            "hover:border-ink-40 focus:border-market focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
      </div>

      {cameraSupported && (
        <button
          type="button"
          onClick={onOpenCamera}
          disabled={disabled}
          aria-label="Scan with the camera"
          className={cn(
            "grid size-touch-till shrink-0 place-items-center rounded-input",
            "border-2 border-line bg-surface text-ink-70",
            "transition-colors duration-150 ease-out-pos",
            "hover:border-market hover:bg-market-tint hover:text-market",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Camera size={26} />
        </button>
      )}
    </form>
  );
}
