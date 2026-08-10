"use client";

import { LoaderCircle } from "lucide-react";
import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button-styles";

export function Button({
  variant = "primary",
  size = "admin",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
    >
      {loading && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
