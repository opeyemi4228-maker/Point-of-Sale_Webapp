"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { useSessionHydrated, useSessionStore } from "@/lib/stores/session";
import { intendedRoute } from "@/lib/utils/intended-route";
import { ROLE_HOME } from "@/config/roles";
import type { StaffRole } from "@/types";

/**
 * Keeps a workspace shut to anyone who does not belong in it.
 *
 * This is chrome-level routing, not security. A determined user can edit
 * localStorage and reach the markup — and it will be empty, because the real
 * seal is row-level security in the database (SPEC §8). Never move an
 * authorisation decision into this component.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: readonly StaffRole[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSessionStore((s) => s.session);
  const hydrated = useSessionHydrated();

  const permitted = session ? allow.includes(session.staff.role) : false;

  useEffect(() => {
    if (!hydrated) return;

    if (!session) {
      intendedRoute.set(pathname);
      router.replace("/login");
      return;
    }

    if (!permitted) {
      router.replace(ROLE_HOME[session.staff.role]);
    }
  }, [hydrated, session, permitted, pathname, router]);

  if (!hydrated || !session || !permitted) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status">
        <LoaderCircle size={28} className="animate-spin text-ink-40" aria-hidden />
        <span className="sr-only">Checking your access</span>
      </div>
    );
  }

  return <>{children}</>;
}
