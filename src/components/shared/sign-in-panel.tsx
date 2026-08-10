"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, IdCard, Mail } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { BrandMark } from "@/components/shared/brand-mark";
import { signInAction } from "@/app/(auth)/actions";
import { DEMO_ACCOUNTS } from "@/config/demo-accounts";
import {
  setRemember,
  useSessionHydrated,
  useSessionStore,
} from "@/lib/stores/session";
import { intendedRoute } from "@/lib/utils/intended-route";
import { ROLE_HOME, ROLE_LABEL, ROLE_ROUTE_PREFIXES } from "@/config/roles";
import type { SignInError } from "@/types/staff";

/**
 * The sign-in form — SPEC §16.
 *
 * Layout runs top to bottom in one column: logo, greeting, the two fields, the
 * primary action, a rule, and the alternate way in. Every element is full
 * width, so the eye tracks a single left edge from the logo to the last field.
 *
 * No standfirst under the greeting. Nobody arrives at a till's sign-in screen
 * needing to be told what signing in is for, and the sentence only pushed the
 * first field further from the logo.
 *
 * Two doors, one form. Managers and HQ know an email; a cashier knows the staff
 * code printed on their badge and on every receipt they issue (§12). The field
 * accepts either, but which one you are being asked for should never be a
 * guess — so the alternate-action slot switches the form's mode and relabels
 * the field rather than sending anyone to a second page.
 */

type Mode = "email" | "staffCode";

const MODES = {
  email: {
    label: "Email address",
    placeholder: "you@swiftgrocers.ng",
    hint: null,
    autoComplete: "username" as const,
    inputMode: "email" as const,
    switchTo: "staffCode" as Mode,
    switchLabel: "Sign in with a staff code",
    switchIcon: IdCard,
  },
  staffCode: {
    label: "Staff code",
    placeholder: "ABJ03-C07",
    hint: "The code on your badge, printed on every receipt you issue.",
    autoComplete: "username" as const,
    inputMode: "text" as const,
    switchTo: "email" as Mode,
    switchLabel: "Sign in with an email address",
    switchIcon: Mail,
  },
} satisfies Record<Mode, unknown>;

export function SignInPanel() {
  const router = useRouter();
  const session = useSessionStore((s) => s.session);
  const hydrated = useSessionHydrated();
  const setSession = useSessionStore((s) => s.setSession);

  const [mode, setMode] = useState<Mode>("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<SignInError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const identifierRef = useRef<HTMLInputElement>(null);
  const config = MODES[mode];

  // Already signed in on this device — go straight through.
  useEffect(() => {
    if (hydrated && session) {
      router.replace(ROLE_HOME[session.staff.role]);
    }
  }, [hydrated, session, router]);

  function switchMode() {
    setMode(config.switchTo);
    setIdentifier("");
    setError(null);
    // The relabelled field is the thing that just changed, so put the caret in
    // it rather than making the person find it again.
    requestAnimationFrame(() => identifierRef.current?.focus());
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    // A server action: the credential is checked on the server and the signed,
    // HTTP-only session cookie can only be written there. Checking a password
    // in the browser proves nothing to the database.
    const result = await signInAction(identifier, password);

    if (!result.ok) {
      setError(result.error);
      setPassword("");
      setSubmitting(false);
      // A wrong password is the common case and the identifier is usually
      // right, so send focus to the field that needs retyping — not to the top.
      return;
    }

    // Order matters: the storage choice must be in place before the session is
    // written, or it lands in the wrong store.
    //
    // There is no "keep me signed in" control, so the choice is made here, and
    // it is made for the shop floor: a till is shared hardware and a session
    // left behind on it is somebody else's till. Session storage — closing the
    // browser ends it. Flip this only alongside a visible control.
    setRemember(false);

    const { role } = result.session.staff;
    setSession(result.session);

    // The shift is opened server-side inside `signInAction` (SPEC §11.4) —
    // it has the verified identity and the database connection, and doing it
    // there means a cashier's hours cannot depend on a browser finishing a
    // second request.

    // Honour a deep link only if the role is actually allowed to reach it.
    const wanted = intendedRoute.take();
    const allowed =
      wanted &&
      ROLE_ROUTE_PREFIXES[role].some(
        (prefix) => wanted === prefix || wanted.startsWith(`${prefix}/`),
      );

    router.replace(allowed ? wanted : ROLE_HOME[role]);
  }

  const SwitchIcon = config.switchIcon;

  return (
    <div className="w-full max-w-108">
      <BrandMark height={68} preload />

      <h1 className="mt-7 font-display text-display-lg text-ink">Welcome back</h1>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        {error && <Alert tone="halt">{error.message}</Alert>}

        <TextField
          ref={identifierRef}
          key={mode}
          label={config.label}
          name="identifier"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder={config.placeholder}
          hint={config.hint ?? undefined}
          autoComplete={config.autoComplete}
          inputMode={config.inputMode}
          autoCapitalize={mode === "staffCode" ? "characters" : "none"}
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          invalid={Boolean(error)}
        />

        <TextField
          label="Password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
          onBlur={() => setCapsLock(false)}
          placeholder="Enter your password"
          autoComplete="current-password"
          revealable
          required
          invalid={Boolean(error)}
          // Caps Lock is the single most common reason a correct password is
          // rejected, and a till keyboard is shared all day. Say so before the
          // submit rather than after it.
          warning={capsLock ? "Caps Lock is on." : undefined}
        />

        <Button type="submit" size="till" loading={submitting} className="mt-1 w-full">
          {submitting ? "Signing in" : "Sign in"}
          {!submitting && <ArrowRight size={20} aria-hidden />}
        </Button>
      </form>

      {/* The rule and the alternate way in — where the reference put a second
          identity provider. A POS has none: every account is provisioned down
          the hierarchy (§3), so the second door is the other kind of
          credential, not the other kind of provider. */}
      <div className="mt-6 flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-label uppercase text-ink-40">Or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button
        type="button"
        variant="secondary"
        size="till"
        onClick={switchMode}
        className="mt-4 w-full"
      >
        <SwitchIcon size={20} aria-hidden className="text-market" />
        {config.switchLabel}
      </Button>

      <DemoAccounts
        onPick={(account) => {
          setMode("email");
          setIdentifier(account.identifier);
          setPassword(account.secret);
          setError(null);
        }}
      />
    </div>
  );
}

/**
 * Development affordance only. This block disappears with the mock data layer
 * the moment Neon Auth is wired up — it must never ship to a store.
 */
function DemoAccounts({
  onPick,
}: {
  onPick: (account: (typeof DEMO_ACCOUNTS)[number]) => void;
}) {
  return (
    <details className="group mt-6 rounded-panel border border-line">
      <summary className="flex min-h-touch-admin cursor-pointer list-none items-center justify-between gap-2 px-4 text-label uppercase text-ink-70">
        Demo accounts
        <ChevronDown
          size={16}
          className="transition-transform duration-150 ease-out-pos group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <ul className="border-t border-line">
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.identifier} className="border-b border-line last:border-b-0">
            <button
              type="button"
              onClick={() => onPick(account)}
              className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors duration-150 ease-out-pos hover:bg-market-tint focus-visible:bg-market-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-market"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-ink">{account.fullName}</span>
                <span className="text-label uppercase text-market">
                  {ROLE_LABEL[account.role]}
                </span>
              </span>
              <span className="font-mono text-label break-all text-ink-40">
                {account.identifier} · {account.secret}
                <span className="ml-1 uppercase text-ink-40">
                  ({account.kind})
                </span>
              </span>
              <span className="text-label text-ink-40">{account.note}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
