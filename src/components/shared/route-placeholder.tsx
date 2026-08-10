import { Construction } from "lucide-react";
import { WorkspaceHeader } from "@/components/shared/workspace-header";

/**
 * Temporary scaffold marker. Every route in the tree renders one of these until
 * its real screen is built, so the navigation graph is walkable from day one.
 *
 * It carries the real `WorkspaceHeader` rather than a bare panel, so an unbuilt
 * screen is still a screen you can navigate and sign out from — a dead end with
 * no way back out is worse than an unfinished page.
 *
 * Delete the import along with the placeholder when a screen lands.
 */
export function RoutePlaceholder({
  title,
  spec,
  summary,
}: {
  title: string;
  /** Spec section this screen is built from, e.g. "§15.1". */
  spec: string;
  summary: string;
}) {
  return (
    <>
      <WorkspaceHeader title={title} />

      <main className="min-h-0 flex-1 overflow-y-auto mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 p-8">
        <div className="flex items-center gap-2 text-ink-40">
          <Construction size={18} aria-hidden />
          <span className="text-label uppercase">Not built yet · SPEC {spec}</span>
        </div>
        <h2 className="font-display text-display-lg text-ink">{title}</h2>
        <p className="text-body-lg text-ink-70">{summary}</p>
      </main>
    </>
  );
}
