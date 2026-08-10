"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { useSessionStore } from "@/lib/stores/session";
import { readStoredSidebarCollapsed, useUiStore } from "@/lib/stores/ui";
import { NAVIGATION, isNavItemActive, type NavItem } from "@/config/navigation";
import { useBadgeCounts } from "@/lib/hooks/use-badge-counts";
import { cn } from "@/lib/utils/cn";

/**
 * The workspace sidebar — SPEC §15.
 *
 * Three shapes, one component, and the input device picks:
 *
 * - **Expanded** (240px) on manager and HQ, where the person is reading and
 *   deciding and has the screen width to spare.
 * - **Labelled rail** (88px) on the till, always. §15.1 spends the width on the
 *   product grid and the receipt tape, so a 240px column of links is out of the
 *   question — but a till is touch hardware, and a name that only appears on
 *   hover may as well not exist to a finger. So the names sit under the icons,
 *   permanently, at the till's 16px floor.
 * - **Icon rail** (76px) when a manager collapses it. That is a mouse on a
 *   desktop with nine destinations, where stacked names would not fit and a
 *   hover flyout is exactly the right instrument.
 *
 * Active state is never colour alone (§14): the open item carries a market bar,
 * a tinted surface, heavier text *and* `aria-current`.
 */

type NavVariant = "full" | "icon" | "stacked";

/** A hovered or focused icon-rail item, and where to put its name. */
type Peek = { label: string; top: number; left: number };
export function AppSidebar({
  forceRail = false,
}: {
  /** The till pins itself to the rail regardless of the stored preference. */
  forceRail?: boolean;
}) {
  // Derived here, never passed in — see `useBadgeCounts`.
  const badges = useBadgeCounts();
  const session = useSessionStore((s) => s.session);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const mobileOpen = useUiStore((s) => s.mobileNavOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const pathname = usePathname();
  const [peek, setPeek] = useState<Peek | null>(null);

  // Restore the stored preference after mount, so SSR and first paint agree.
  useEffect(() => {
    if (forceRail) return;
    const stored = readStoredSidebarCollapsed();
    if (stored !== null) setSidebarCollapsed(stored);
  }, [forceRail, setSidebarCollapsed]);

  // A tap on a link inside the drawer should close it.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, setMobileNavOpen]);

  if (!session) return null;

  const rail = forceRail || collapsed;
  const sections = NAVIGATION[session.staff.role];

  // Three shapes, and the input device decides which. The till is touch
  // hardware, so its names have to be *on* the screen — a hover flyout is
  // invisible to a finger. Manager and HQ collapse to icons on a mouse-driven
  // desktop with nine destinations, where stacked names would not fit and a
  // flyout is exactly right.
  const variant: NavVariant = forceRail ? "stacked" : collapsed ? "icon" : "full";

  return (
    <>
      {/* Mobile scrim */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
        />
      )}

      <nav
        aria-label="Workspace"
        data-rail={rail || undefined}
        className={cn(
          "z-50 flex flex-col border-r border-line bg-surface",
          "transition-[width,transform] duration-150 ease-out-pos",
          // 88px for the labelled rail: 64px of usable width, which is enough
          // for a one-word name at the till's 16px floor without truncating.
          variant === "stacked" ? "w-22" : variant === "icon" ? "w-19" : "w-60",
          // The till's rail is 76px and always on screen: a cashier with a queue
          // building should never have to open a drawer to reach their shift.
          forceRail
            ? "static translate-x-0"
            : cn(
                "fixed inset-y-0 left-0 lg:static lg:translate-x-0",
                mobileOpen ? "translate-x-0" : "-translate-x-full",
              ),
        )}
      >
        <SidebarHeader
          rail={rail}
          forceRail={forceRail}
          onToggle={toggleSidebar}
          onCloseMobile={() => setMobileNavOpen(false)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section, index) => (
            <div key={section.title ?? index} className={index > 0 ? "mt-6" : undefined}>
              {section.title && !rail && (
                <p className="mb-2 px-3 text-label uppercase text-ink-40">
                  {section.title}
                </p>
              )}
              {section.title && rail && (
                <div className="mx-3 mb-3 border-t border-line" aria-hidden />
              )}

              <ul className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <SidebarLink
                      item={item}
                      variant={variant}
                      active={isNavItemActive(item.href, pathname)}
                      count={item.badge ? badges[item.badge] : undefined}
                      onPeek={setPeek}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

      </nav>

      {/* The name of a collapsed icon, on hover or keyboard focus. */}
      {peek && variant === "icon" && <RailPeek peek={peek} />}
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function SidebarHeader({
  rail,
  forceRail,
  onToggle,
  onCloseMobile,
}: {
  rail: boolean;
  forceRail: boolean;
  onToggle: () => void;
  onCloseMobile: () => void;
}) {
  // Collapsed, the mark doubles as the expand control: the logo at rest, the
  // expand icon on hover or focus. A 76px rail has room for one thing at the
  // top, so it is both.
  if (rail) {
    return (
      <div className="flex h-16 shrink-0 items-center justify-center border-b border-line px-2">
        {forceRail ? (
          <BrandMark height={34} showWordmark={false} title="Swiftgrocers" />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand sidebar"
            className="group grid size-11 place-items-center rounded-input transition-colors duration-150 ease-out-pos hover:bg-market-tint focus-visible:outline-2 focus-visible:outline-market"
          >
            <BrandMark
              height={34}
              showWordmark={false}
              className="group-hover:hidden group-focus-visible:hidden"
            />
            <PanelLeftOpen
              size={20}
              className="hidden text-market group-hover:block group-focus-visible:block"
            />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
      <BrandMark height={46} />

      {!forceRail && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse sidebar"
          className="hidden rounded-input p-2 text-ink-40 transition-colors duration-150 ease-out-pos hover:bg-market-tint hover:text-ink focus-visible:outline-2 focus-visible:outline-market lg:inline-flex"
        >
          <PanelLeftClose size={18} />
        </button>
      )}

      <button
        type="button"
        onClick={onCloseMobile}
        aria-label="Close navigation"
        className="rounded-input p-2 text-ink-40 hover:bg-market-tint hover:text-ink lg:hidden"
      >
        <X size={20} />
      </button>
    </div>
  );
}

function SidebarLink({
  item,
  variant,
  active,
  count,
  onPeek,
}: {
  item: NavItem;
  variant: NavVariant;
  active: boolean;
  count?: number;
  onPeek?: (peek: Peek | null) => void;
}) {
  const { icon: Icon, label, href } = item;
  const stacked = variant === "stacked";
  const iconOnly = variant === "icon";

  // Only the icon-only rail needs a flyout; the other two show their name.
  const peekHandlers = iconOnly
    ? {
        onMouseEnter: (e: React.MouseEvent<HTMLAnchorElement>) =>
          onPeek?.(peekFrom(e.currentTarget, label)),
        onMouseLeave: () => onPeek?.(null),
        onFocus: (e: React.FocusEvent<HTMLAnchorElement>) =>
          onPeek?.(peekFrom(e.currentTarget, label)),
        onBlur: () => onPeek?.(null),
      }
    : {};

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // Icon-only has no visible name, so it carries one for assistive tech.
      // The stacked and full variants take their name from the visible text,
      // which keeps voice control working on what the person can actually read.
      aria-label={iconOnly ? label : undefined}
      {...peekHandlers}
      className={cn(
        "group relative flex rounded-input",
        "transition-colors duration-150 ease-out-pos",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-market",
        stacked
          ? "min-h-touch-till flex-col items-center justify-center gap-1 px-1 py-2"
          : iconOnly
            ? "min-h-touch-admin items-center justify-center px-0"
            : "min-h-touch-admin items-center gap-3 px-3",
        active
          ? "bg-market-tint font-semibold text-ink"
          : "font-medium text-ink-70 hover:bg-paper hover:text-ink",
      )}
    >
      {/* The leading bar: identity that survives a greyscale screen. */}
      <span
        aria-hidden
        className={cn(
          "absolute rounded-pill bg-market",
          stacked ? "inset-x-3 bottom-0 h-0.75" : "inset-y-1.5 left-0 w-0.75",
          active ? "opacity-100" : "opacity-0",
        )}
      />

      <Icon
        size={stacked ? 24 : 20}
        className={cn("shrink-0", active ? "text-market" : "text-ink-40")}
      />

      {variant === "full" && <span className="truncate">{label}</span>}

      {stacked && (
        <span className="w-full truncate text-center text-label tracking-normal">
          {item.shortLabel ?? label}
        </span>
      )}

      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "font-numeric rounded-pill bg-sun text-label font-semibold text-ink",
            "border border-signal/30",
            variant === "full"
              ? "ml-auto min-w-6 px-1.5 py-0.5 text-center"
              : "absolute top-1.5 right-1.5 min-w-5 px-1 text-center",
          )}
        >
          <span className="sr-only">{label} needing attention: </span>
          {count}
        </span>
      )}
    </Link>
  );
}

function peekFrom(el: HTMLElement, label: string): Peek {
  const rect = el.getBoundingClientRect();
  return { label, top: rect.top + rect.height / 2, left: rect.right + 10 };
}

/**
 * The flyout name for the icon-only rail.
 *
 * Fixed-positioned from the item's own rect rather than absolutely positioned
 * inside it — the nav list is a scroll container, and an `absolute left-full`
 * flyout would be clipped by it the moment the list grew long enough to scroll.
 */
function RailPeek({ peek }: { peek: Peek }) {
  return (
    <div
      role="presentation"
      style={{ top: peek.top, left: peek.left }}
      className="pointer-events-none fixed z-60 -translate-y-1/2 rounded-input bg-ink px-3 py-2 text-body font-medium whitespace-nowrap text-surface shadow-raised"
    >
      {peek.label}
    </div>
  );
}

/** The hamburger that opens the drawer. Lives in each workspace's top bar. */
export function MobileNavButton() {
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);

  return (
    <button
      type="button"
      data-mobile-nav
      onClick={() => setMobileNavOpen(true)}
      aria-label="Open navigation"
      className="inline-flex min-h-touch-admin items-center rounded-input px-2 text-ink-70 hover:bg-market-tint hover:text-ink focus-visible:outline-2 focus-visible:outline-market lg:hidden"
    >
      <Menu size={22} />
    </button>
  );
}
