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
 * General admin (HQ) workspace shell — SPEC §15.3.
 * Desktop-first, consolidated across every branch. Admin only — a branch
 * manager who lands here is returned to their own branch.
 */
export default function HqLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <WorkspaceShell>
      <RequireRole allow={["general_admin"]}>
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
