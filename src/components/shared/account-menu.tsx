"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import { useSessionStore } from "@/lib/stores/session";
import { ROLE_LABEL } from "@/config/roles";
import { cn } from "@/lib/utils/cn";

/**
 * Who is signed in, and the way out. Top-right of every workspace's top bar,
 * identically for a cashier, a manager and HQ.
 *
 * It belongs here rather than at the foot of the sidebar for two reasons: a till
 * runs its sidebar as a narrow rail with no room for a name, and on shared
 * hardware the single most important control on the screen is the one that ends
 * somebody else's session (§17). It should not be the thing furthest from the
 * eye, below the fold, in a column that can be collapsed.
 */
export function AccountMenu() {
  const router = useRouter();
  const session = useSessionStore((s) => s.session);
  const signOut = useSessionStore((s) => s.signOut);

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!session) return null;
  const { staff } = session;

  const initials = staff.fullName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  const where = staff.branchName ?? "All branches";

  function handleSignOut() {
    signOut();
    router.replace("/login");
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex min-h-touch-admin items-center gap-2.5 rounded-input px-2 py-1",
          "transition-colors duration-150 ease-out-pos hover:bg-market-tint",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
          open && "bg-market-tint",
        )}
      >
        <Avatar initials={initials} />

        {/* The name gives way before the avatar does — on a phone the avatar
            alone still opens the menu that carries the full name. */}
        <span className="hidden min-w-0 text-left leading-tight sm:block">
          <span className="block truncate font-semibold text-ink">
            {staff.fullName}
          </span>
          <span className="block truncate text-label text-ink-40">
            {ROLE_LABEL[staff.role]}
          </span>
        </span>

        <ChevronDown
          size={16}
          aria-hidden
          className={cn(
            "shrink-0 text-ink-40 transition-transform duration-150 ease-out-pos",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-panel border border-line bg-surface shadow-raised"
        >
          <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
            <Avatar initials={initials} />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-semibold text-ink">{staff.fullName}</p>
              <p className="truncate text-body text-ink-70">
                {ROLE_LABEL[staff.role]}
              </p>
              <p className="truncate text-body text-ink-40">{where}</p>
              <p className="mt-1 truncate font-mono text-label text-ink-40">
                {staff.staffCode}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex min-h-touch-admin w-full items-center gap-3 px-4 text-left font-medium text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:bg-halt-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-market"
          >
            <LogOut size={20} aria-hidden className="shrink-0" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-pill bg-market-tint text-label font-semibold text-market"
    >
      {initials}
    </span>
  );
}
