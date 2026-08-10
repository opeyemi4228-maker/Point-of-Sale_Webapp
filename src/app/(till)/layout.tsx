import { AppSidebar } from "@/components/shared/app-sidebar";
import { RequireRole } from "@/components/shared/require-role";
import { WorkspaceShell } from "@/lib/data/workspace-shell";

/**
 * Till workspace shell — SPEC §15.1.
 *
 * Fixed-height, non-scrolling chrome: the till is furniture in a working room,
 * not a document. The sidebar is pinned to its 76px rail here — §15.1 spends the
 * width on the product grid and the receipt tape, and a 240px column of links
 * would come straight out of the tape.
 *
 * Managers and admin may open a till; a cashier may open nothing else.
 */
export default function TillLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <WorkspaceShell>
      <RequireRole allow={["sales_person", "branch_manager", "general_admin"]}>
        <div data-surface="till" className="fixed inset-0 flex overflow-hidden">
          <AppSidebar forceRail />
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </div>
      </RequireRole>
    </WorkspaceShell>
  );
}
