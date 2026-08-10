"use client";

import { useSessionHydrated, useSessionStore } from "@/lib/stores/session";

/**
 * The branch the signed-in person is standing in, for a screen header.
 *
 * A client island inside an otherwise server-rendered header: the branch is a
 * session fact, and the alternative — passing it down as a prop from a page
 * that has to guess — is how the stock screen ended up recording deliveries
 * against a manager who was not signed in.
 *
 * Renders nothing until the session has rehydrated, rather than flashing a
 * placeholder branch and correcting itself. HQ accounts have no branch, so the
 * fallback is the scope they actually have.
 */
export function BranchLabel({ suffix }: { suffix?: string }) {
  const hydrated = useSessionHydrated();
  const staff = useSessionStore((s) => s.session?.staff ?? null);

  if (!hydrated || !staff) return null;

  const scope = staff.branchName ? `${staff.branchName} branch` : "All branches";
  return <>{suffix ? `${scope} · ${suffix}` : scope}</>;
}
