import { AccountMenu } from "@/components/shared/account-menu";
import { MobileNavButton } from "@/components/shared/app-sidebar";

/**
 * The bar above every workspace screen: what you are looking at, the actions
 * that belong to the whole screen, and — always, for every role — who is signed
 * in and the way out.
 *
 * The account control is rendered here rather than passed in, so no screen can
 * ship without it. A cashier, a branch manager and HQ all get the same control
 * in the same corner.
 */
export function WorkspaceHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center gap-x-4 gap-y-2 border-b border-line bg-paper/85 px-5 py-3 backdrop-blur-sm">
      <MobileNavButton />

      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-title font-bold text-ink">
          {title}
        </h1>
        {subtitle && <p className="truncate text-body text-ink-70">{subtitle}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <AccountMenu />
      </div>
    </header>
  );
}
