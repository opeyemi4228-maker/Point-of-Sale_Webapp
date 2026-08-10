"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type SelectOption = { value: string; label: string };

/**
 * A native `<select>` under our own chrome.
 *
 * Native on purpose: on an Android till a custom listbox means a scroll-jacked
 * popup that a gloved finger fights with, while the platform control gets the
 * full-screen wheel the cashier already knows. The arrow is ours; the mechanism
 * is the browser's.
 */
export function Select({
  label,
  hint,
  invalid,
  options,
  placeholder,
  className,
  id,
  required,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label: string;
  hint?: string;
  invalid?: boolean;
  options: readonly SelectOption[];
  placeholder?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
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
        <select
          {...props}
          id={fieldId}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
          className={cn(
            "min-h-14 w-full appearance-none rounded-input border bg-surface px-4 pr-12 text-body-lg text-ink",
            "transition-colors duration-150 ease-out-pos",
            "focus:outline-2 focus:outline-offset-0 focus:outline-market",
            invalid ? "border-halt" : "border-line hover:border-ink-40",
            className,
          )}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <ChevronDown
          size={20}
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-ink-40"
        />
      </div>

      {hint && (
        <p id={hintId} className="text-body text-ink-40">
          {hint}
        </p>
      )}
    </div>
  );
}
