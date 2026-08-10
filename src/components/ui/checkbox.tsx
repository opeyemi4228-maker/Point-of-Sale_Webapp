"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A real `<input type="checkbox">` under a drawn box, so keyboard, form
 * submission and assistive technology all behave natively. The tick is an icon,
 * never a colour change alone (§14).
 */
export function Checkbox({
  label,
  id,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: React.ReactNode;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className={cn("flex items-center", className)}>
      <span className="relative inline-grid size-5 shrink-0 place-items-center">
        <input
          {...props}
          id={fieldId}
          type="checkbox"
          className="peer size-5 appearance-none rounded-[5px] border border-line bg-surface transition-colors duration-150 ease-out-pos checked:border-market checked:bg-market hover:border-ink-40 checked:hover:border-market-dark checked:hover:bg-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
        />
        <Check
          size={14}
          strokeWidth={3}
          aria-hidden
          className="pointer-events-none absolute hidden text-white peer-checked:block"
        />
      </span>

      <label htmlFor={fieldId} className="cursor-pointer pl-2.5 text-body text-ink-70">
        {label}
      </label>
    </div>
  );
}
