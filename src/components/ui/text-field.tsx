"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  hint?: string;
  invalid?: boolean;
  /**
   * A transient note about how the field is being typed into — Caps Lock, a
   * keyboard layout. Not a validation failure: it appears while the person is
   * still typing and carries an icon, never colour alone (§14).
   */
  warning?: string;
  /** Renders a show/hide toggle and manages the input type. */
  revealable?: boolean;
  ref?: React.Ref<HTMLInputElement>;
};

export function TextField({
  label,
  hint,
  invalid,
  warning,
  revealable,
  className,
  id,
  type = "text",
  required,
  ref,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const warningId = `${fieldId}-warning`;
  const [revealed, setRevealed] = useState(false);

  const resolvedType = revealable ? (revealed ? "text" : "password") : type;

  const describedBy =
    [hint ? hintId : null, warning ? warningId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Sentence case at body size, not an uppercase micro-label: a field label
          is read once per field and legibility beats compactness (§14). */}
      <label htmlFor={fieldId} className="text-body font-semibold text-ink">
        {label}
        {required && (
          <>
            {" "}
            <span aria-hidden className="text-halt">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </label>

      <div className="relative">
        <input
          {...props}
          ref={ref}
          id={fieldId}
          type={resolvedType}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            "min-h-14 w-full rounded-input border bg-surface px-4 text-body-lg text-ink",
            "placeholder:text-ink-40",
            "transition-[color,border-color,box-shadow] duration-150 ease-out-pos",
            // A 2px ring rather than an outline, so the focused field grows a
            // visible edge instead of a halo detached from its border.
            "focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market",
            invalid ? "border-halt" : "border-line hover:border-ink-40",
            revealable && "pr-14",
            className,
          )}
        />

        {revealable && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            className={cn(
              "absolute top-1/2 right-1.5 -translate-y-1/2 rounded-input p-2.5",
              "text-ink-40 transition-colors duration-150 ease-out-pos",
              "hover:bg-market-tint hover:text-ink",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-market",
            )}
          >
            {revealed ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        )}
      </div>

      {warning && (
        <p
          id={warningId}
          role="status"
          className="flex items-center gap-1.5 text-label tracking-normal text-signal"
        >
          <TriangleAlert size={14} aria-hidden className="shrink-0" />
          {warning}
        </p>
      )}

      {hint && (
        <p id={hintId} className="text-label tracking-normal text-ink-40">
          {hint}
        </p>
      )}
    </div>
  );
}
