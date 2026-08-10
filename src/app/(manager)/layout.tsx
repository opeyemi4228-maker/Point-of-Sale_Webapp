import { AppSidebar } from "@/components/shared/app-sidebar";
import { RequireRole } from "@/components/shared/require-role";
import { WorkspaceShell } from "@/lib/data/workspace-shell";

/**
 * The shell is pinned to the viewport. Only the content column scrolls.
 *
 * `fixed inset-0` rather than `h-dvh`: with `h-dvh` the document can still grow
 * — one page did, and the whole chrome slid up by 111px under the wheel while
 * every other page behaved. Pinning takes the document out of the flow
 * entirely, so no screen inside can ever push the navigation or the title bar
 * off the top, whatever it renders.
 *
 * A workspace is furniture, not a document: the navigation and the screen title
 * are how someone knows where they are, and losing them halfway down a stock
 * table means scrolling back up to find out.
 */

/**
 * Branch manager workspace shell — SPEC §15.2.
 * Tablet and laptop. 44px touch targets, 14px permitted in dense tables.
 *
 * A sales person cannot reach this workspace. What a manager sees inside it is
 * scoped to their own branch by row-level security, not by this layout (§8).
 */
export default function ManagerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <WorkspaceShell>
      <RequireRole allow={["branch_manager", "general_admin"]}>
        <div className="fixed inset-0 flex overflow-hidden">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </RequireRole>
    </WorkspaceShell>
  );
}
