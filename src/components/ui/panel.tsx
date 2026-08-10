import { cn } from "@/lib/utils/cn";

/** A surface with one level of elevation — SPEC §14. Deep shadows read as decoration. */
export function Panel({
  className,
  children,
  id,
}: {
  className?: string;
  children: React.ReactNode;
  /** Set when something needs to link to the panel, e.g. a jump from a banner. */
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        // `min-w-0` and `overflow-hidden` are load-bearing: without them a wide
        // table inside an `overflow-x-auto` wrapper stretches the panel instead
        // of scrolling inside it, and the whole page scrolls sideways on a phone.
        "min-w-0 overflow-hidden rounded-panel border border-line bg-surface shadow-raised",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  meta,
  action,
  className,
}: {
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-label uppercase text-ink-70">{title}</h2>
        {meta && <p className="mt-1 text-body text-ink-40">{meta}</p>}
      </div>
      {action}
    </div>
  );
}
