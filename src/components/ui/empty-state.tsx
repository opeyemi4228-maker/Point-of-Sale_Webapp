import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * What a screen shows before it has anything to show — SPEC §14.
 *
 * Never "No data". An empty screen is the first thing a new branch sees on its
 * first morning, and it is the only chance the system gets to say what the
 * screen is for and what fills it. So every empty state names the thing, says
 * what puts something here, and where possible offers the action that does it.
 *
 * The body can be given as `detail` or as children; `detail` covers the common
 * case of one plain sentence, children the rarer one that needs a link inside.
 */
export function EmptyState({
  icon: Icon,
  title,
  detail,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  /** One sentence. Use `children` instead when it needs markup. */
  detail?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("grid place-items-center gap-2 px-6 py-14 text-center", className)}
    >
      <Icon size={34} aria-hidden className="text-ink-40" />
      <p className="text-body-lg font-semibold text-ink">{title}</p>
      {(detail || children) && (
        <p className="max-w-104 text-body text-ink-70">{detail ?? children}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
