import type { Metadata } from "next";
import { BrandMosaic } from "@/components/shared/brand-mosaic";
import { SignInPanel } from "@/components/shared/sign-in-panel";

export const metadata: Metadata = {
  title: "Sign in · Swiftgrocers POS",
  description: "Sign in to your till, your branch, or the whole chain.",
};

/**
 * One sign-in for the whole chain — SPEC §3.
 *
 * There is a single door. The account's role decides which workspace opens
 * behind it: the till, the branch office, or HQ. Nobody picks their own tier at
 * the door, and nobody creates their own account — a branch manager creates
 * cashiers, HQ creates managers. That is why there is no sign-up link.
 *
 * Two columns on a wide screen, form only on a narrow one. The mosaic is the
 * first thing that dies at small sizes: on a phone the form should own the
 * glass. The form column scrolls inside its own half rather than the page
 * scrolling as a whole, so the mosaic never slides away underneath it.
 */
export default function LoginPage() {
  return (
    <div className="grid min-h-dvh bg-surface lg:h-dvh lg:grid-cols-2 lg:overflow-hidden">
      <main className="flex items-center justify-center px-6 py-12 sm:px-10 lg:overflow-y-auto lg:px-14">
        <SignInPanel />
      </main>

      <aside className="relative hidden overflow-hidden bg-leaf lg:block">
        <BrandMosaic className="absolute inset-0 size-full" />

        {/* The receipt-tape perforation, the system's signature motif (§14),
            tearing the mosaic away from the form. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 w-4 bg-surface mask-[radial-gradient(circle_at_left,transparent_5px,black_5.5px)] mask-repeat-y mask-size-[16px_16px]"
        />
      </aside>
    </div>
  );
}
