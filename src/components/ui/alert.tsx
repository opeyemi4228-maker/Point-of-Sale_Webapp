import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Tone = "halt" | "signal" | "info" | "market";

/**
 * SPEC §14: status colour is never the only signal. Every tone carries an icon
 * and readable text alongside it, because around 1 in 12 Nigerian men has some
 * form of colour-vision deficiency and a misread state costs real money.
 */
const TONES: Record<Tone, { surface: string; icon: typeof Info; label: string }> = {
  halt: {
    surface: "bg-halt-tint border-halt/25 text-ink",
    icon: TriangleAlert,
    label: "Problem",
  },
  signal: {
    surface: "bg-signal-tint border-signal/30 text-ink",
    icon: TriangleAlert,
    label: "Attention",
  },
  info: {
    surface: "bg-surface border-line text-ink",
    icon: Info,
    label: "Note",
  },
  market: {
    surface: "bg-market-tint border-market/20 text-ink",
    icon: CircleCheck,
    label: "Done",
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { surface, icon: Icon, label } = TONES[tone];

  return (
    <div
      role={tone === "halt" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-input border px-4 py-3 text-body",
        surface,
        className,
      )}
    >
      <Icon size={20} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <span className="sr-only">{title ?? label}: </span>
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-ink-70">{children}</div>
      </div>
    </div>
  );
}
