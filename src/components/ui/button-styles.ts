import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/** `till` is 56px per SPEC §14; `admin` is 44px. Nothing smaller. */
export type ButtonSize = "till" | "admin" | "compact";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-market text-white hover:bg-market-dark active:bg-market-dark shadow-raised",
  secondary:
    "bg-surface text-ink border border-line hover:bg-market-tint hover:border-market/30",
  ghost: "bg-transparent text-ink-70 hover:bg-market-tint hover:text-ink",
  danger: "bg-halt text-white hover:brightness-90",
};

const SIZES: Record<ButtonSize, string> = {
  till: "min-h-touch-till px-6 text-body-lg",
  admin: "min-h-touch-admin px-5 text-body",
  compact: "min-h-9 px-3 text-label uppercase",
};

/**
 * The shared look, so a link that acts as a button is the same object rather
 * than a copy of its class list that drifts the first time one is changed.
 *
 * Deliberately in its own module with no `"use client"`: `ButtonLink` is a
 * server component, and a server component cannot call a function exported from
 * a client module — the build fails outright rather than at runtime.
 */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "admin",
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-input font-medium",
    "transition-colors duration-150 ease-out-pos",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}
