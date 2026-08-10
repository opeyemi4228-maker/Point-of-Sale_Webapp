"use client";

import { StaffScreen } from "@/components/manager/staff-screen";
import { useSessionStore } from "@/lib/stores/session";
import type { StaffMember } from "@/types/people";

/**
 * Reads the branch from the session rather than taking it as a prop.
 *
 * A manager's branch is not a parameter a page gets to choose. The roster
 * itself now arrives from the server, already narrowed by row-level security to
 * the branch that manager belongs to — so this component decides what to label
 * things, never what may be seen.
 */
export function StaffScreenContainer({ roster }: { roster: StaffMember[] }) {
  const branchId = useSessionStore((s) => s.session?.staff.branchId ?? null);
  return <StaffScreen branchId={branchId} roster={roster} />;
}
