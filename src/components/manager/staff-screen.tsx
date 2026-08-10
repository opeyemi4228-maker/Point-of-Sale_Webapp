"use client";

import { useMemo, useState } from "react";
import { CircleCheck, Copy, ShieldAlert, UserPlus, Users, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { TableScroller } from "@/components/ui/table-scroller";
import { TextField } from "@/components/ui/text-field";
import { FRAUD_WATCH_PERCENT } from "@/lib/data/mock/people";
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import {
  createSalesPersonAction,
  resetStaffPinAction,
  setStaffStatusAction,
} from "@/app/(manager)/manager/staff/actions";
import { formatWhole } from "@/lib/domain/money";
import { stamp } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import type { StaffMember } from "@/types/people";
import type { StaffStatus } from "@/types";
import { PageBody } from "@/components/ui/page-body";

const STATUS: Record<StaffStatus, { tone: StatusTone; label: string }> = {
  active: { tone: "done", label: "Active" },
  invited: { tone: "waiting", label: "Invited" },
  suspended: { tone: "stopped", label: "Suspended" },
  offboarded: { tone: "idle", label: "Offboarded" },
};

/**
 * The branch roster — SPEC §15.2.
 *
 * Void rate and refund rate sit side by side as default columns, not in a
 * buried report. An outlier on *both* is the classic signature of till theft,
 * so a row where both cross the watch line is called out in words, not left for
 * the manager to spot by comparing two numbers across a wide table.
 */
export function StaffScreen({
  branchId,
  roster,
}: {
  branchId: string | null;
  roster: StaffMember[];
}) {
  // Seeded from the server and then owned locally, so a cashier created here
  // appears in the list immediately rather than after a round trip.
  const [staff, setStaff] = useState<StaffMember[]>(roster);
  const [formOpen, setFormOpen] = useState(false);
  /** The row mid-flight, so its buttons cannot be pressed twice. */
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    { tone: "good" | "bad"; message: string } | null
  >(null);
  const [created, setCreated] = useState<{
    name: string;
    code: string;
    pin: string;
    password: string;
  } | null>(
    null,
  );

  /**
   * Suspending is never deleting (CLAUDE.md rule 4).
   *
   * A suspended cashier keeps every sale they ever rang; what changes is that
   * they can no longer open a till, and any shift they had running is closed
   * behind them so their hours do not keep accruing while they are off.
   */
  async function handleStatus(member: StaffMember, status: "active" | "suspended") {
    setPending(member.id);
    setNotice(null);

    const result = await setStaffStatusAction(member.id, status);

    if (result.ok) {
      setStaff((current) =>
        current.map((s) => (s.id === member.id ? result.staff : s)),
      );
      setNotice({
        tone: "good",
        message:
          status === "suspended"
            ? `${member.fullName} can no longer open a till.`
            : `${member.fullName} is back on the roster.`,
      });
    } else {
      setNotice({ tone: "bad", message: result.message });
    }
    setPending(null);
  }

  /** The PIN is shown once. There is no second chance to look it up. */
  async function handleResetPin(member: StaffMember) {
    setPending(member.id);
    setNotice(null);

    const result = await resetStaffPinAction(member.id);

    setNotice(
      result.ok
        ? {
            tone: "good",
            message: `${member.fullName}'s new PIN is ${result.pin} — read it out now, it is not shown again.`,
          }
        : { tone: "bad", message: result.message },
    );
    setPending(null);
  }

  const watchList = useMemo(
    () =>
      staff.filter(
        (s) =>
          s.role === "sales_person" &&
          s.voidRatePercent >= FRAUD_WATCH_PERCENT &&
          s.refundRatePercent >= FRAUD_WATCH_PERCENT,
      ),
    [staff],
  );

  function handleCreated(member: StaffMember, pin: string, password: string) {
    setStaff((current) => [...current, member]);
    setCreated({ name: member.fullName, code: member.staffCode, pin, password });
    setFormOpen(false);
  }

  return (
    <PageBody>
      {created && (
        <Alert tone="market" title={`${created.name} can now sign in`}>
          {/* Two credentials, because there are two ways in (SPEC §17). Only
              the hashes are stored, so this is the one and only time either of
              them is readable anywhere — the wording has to make that plain
              rather than implying they can be looked up later. */}
          <dl className="grid gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-label uppercase text-ink-40">Staff code</dt>
              <dd className="font-mono text-body-lg text-ink">{created.code}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-40">Till PIN</dt>
              <dd className="font-mono text-body-lg text-ink">{created.pin}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-40">Password</dt>
              <dd className="font-mono text-body-lg break-all text-ink">{created.password}</dd>
            </div>
          </dl>

          <p className="mt-3">
            The PIN opens a till; the password signs in anywhere else. Both must be
            changed on first use. <strong className="text-ink">Neither is shown
            again</strong> — read them out or copy them now.
          </p>

          <CopyButton
            value={`${created.name}\nStaff code: ${created.code}\nTill PIN: ${created.pin}\nPassword: ${created.password}`}
          />
        </Alert>
      )}

      {watchList.length > 0 && (
        <Alert tone="halt" title="Worth a second look">
          {watchList.map((s) => s.fullName).join(", ")} {watchList.length === 1 ? "is" : "are"}{" "}
          above {FRAUD_WATCH_PERCENT}% on both voids and refunds. That pairing is the usual
          signature of till theft — pull their shift history before the next trading day.
        </Alert>
      )}

      {formOpen ? (
        <NewSalesPersonForm
          branchId={branchId}
          existingCodes={staff.map((s) => s.staffCode)}
          onCancel={() => setFormOpen(false)}
          onCreated={handleCreated}
        />
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setFormOpen(true)}>
            <UserPlus size={18} aria-hidden />
            Add a sales person
          </Button>
        </div>
      )}

      {/* A PIN or a status change is said out loud to somebody standing there,
          so the confirmation is text and an icon, never a colour alone (§14). */}
      {notice && (
        <Alert tone={notice.tone === "good" ? "market" : "halt"}>{notice.message}</Alert>
      )}

      <Panel>
        <PanelHeader
          title="Roster"
          meta={`${staff.length} people · void and refund rate over the last 14 days`}
        />

        {staff.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nobody on this branch yet"
            detail="Add a sales person and they can open a till as soon as they change their PIN."
            action={
              <Button onClick={() => setFormOpen(true)}>
                <UserPlus size={18} aria-hidden />
                Add a sales person
              </Button>
            }
          />
        ) : (
          <TableScroller>
            <table className="w-full min-w-240 text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase text-ink-40">
                  <th scope="col" className="px-5 py-3 font-semibold">Name</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Last shift</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Sales / hour</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Void rate</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Refund rate</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                {staff.map((member) => {
                  const flagged =
                    member.voidRatePercent >= FRAUD_WATCH_PERCENT &&
                    member.refundRatePercent >= FRAUD_WATCH_PERCENT;
                  const status = STATUS[member.status];

                  return (
                    <tr key={member.id} className="hover:bg-paper">
                      <th scope="row" className="px-5 py-3.5">
                        <span className="flex items-center gap-2 font-medium text-ink">
                          {member.fullName}
                          {flagged && (
                            <ShieldAlert size={16} aria-hidden className="text-halt" />
                          )}
                        </span>
                        <span className="block font-mono text-label text-ink-40">
                          {member.staffCode}
                          {member.role === "branch_manager" && " · Manager"}
                        </span>
                      </th>

                      <td className="px-5 py-3.5">
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      </td>

                      <td className="px-5 py-3.5 text-ink-70">
                        {member.lastShiftAt ? stamp(member.lastShiftAt) : "Never"}
                      </td>

                      <td className="px-5 py-3.5 text-right font-numeric text-ink">
                        {member.role === "sales_person"
                          ? formatWhole(member.salesPerHour)
                          : "—"}
                      </td>

                      <Rate value={member.voidRatePercent} flagged={flagged} />
                      <Rate value={member.refundRatePercent} flagged={flagged} />

                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {member.role === "sales_person" && (
                            <Button
                              variant="ghost"
                              size="compact"
                              disabled={pending === member.id}
                              onClick={() => void handleResetPin(member)}
                            >
                              Reset PIN
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="compact"
                            disabled={pending === member.id}
                            onClick={() =>
                              void handleStatus(
                                member,
                                member.status === "suspended" ? "active" : "suspended",
                              )
                            }
                          >
                            {member.status === "suspended" ? "Reinstate" : "Suspend"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroller>
        )}
      </Panel>
    </PageBody>
  );
}

function Rate({ value, flagged }: { value: number; flagged: boolean }) {
  const high = value >= FRAUD_WATCH_PERCENT;
  return (
    <td className="px-5 py-3.5 text-right">
      <span
        className={cn(
          "font-numeric",
          flagged ? "font-semibold text-halt" : high ? "font-medium text-ink" : "text-ink-70",
        )}
      >
        {value.toFixed(1)}%
      </span>
    </td>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => setCopied(false),
        );
      }}
      className="mt-2 inline-flex min-h-touch-admin items-center gap-2 rounded-input border border-line bg-surface px-3 font-medium text-ink transition-colors duration-150 ease-out-pos hover:bg-market-tint focus-visible:outline-2 focus-visible:outline-market"
    >
      {copied ? <CircleCheck size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      {copied ? "Copied" : "Copy code and PIN"}
    </button>
  );
}

/* ── The form ─────────────────────────────────────────────────────────────── */

const EMPTY = { fullName: "", phone: "", email: "", password: "" };
type Field = keyof typeof EMPTY;

/**
 * Create a sales person — SPEC §15.2.
 *
 * One screen, four questions, and only two of them required. A manager fills
 * this in on the shop floor with somebody standing next to them; every optional
 * field is one more reason to give up halfway.
 *
 * The staff code and the starting PIN are generated, never chosen: a code has to
 * be unique across the branch because it prints on every receipt (§12), and a
 * PIN a manager invents is a PIN the whole branch knows by lunchtime.
 */
function NewSalesPersonForm({
  branchId,
  existingCodes,
  onCancel,
  onCreated,
}: {
  branchId: string | null;
  existingCodes: readonly string[];
  onCancel: () => void;
  onCreated: (member: StaffMember, pin: string, password: string) => void;
}) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const nextCode = useMemo(() => nextStaffCode(existingCodes), [existingCodes]);

  function set(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function validate() {
    const next: Partial<Record<Field, string>> = {};

    if (values.fullName.trim().length < 3) {
      next.fullName = "Enter the name as it should print on receipts.";
    }
    // Nigerian mobile numbers, typed the way people actually type them.
    const digits = values.phone.replace(/[^\d+]/g, "");
    if (!/^(\+234\d{10}|0\d{10})$/.test(digits)) {
      next.phone = "Use 0801 234 5678 or +234 801 234 5678.";
    }
    if (values.email.trim() && !/^\S+@\S+\.\S+$/.test(values.email.trim())) {
      next.email = "That does not look like an email address.";
    }
    // Blank is allowed and means "generate one". A password that is typed,
    // though, has to be a real one.
    if (values.password.trim() && values.password.trim().length < MINIMUM_PASSWORD_LENGTH) {
      next.password = `At least ${MINIMUM_PASSWORD_LENGTH} characters, or leave it blank to generate one.`;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /**
   * The server creates the person, not this form.
   *
   * It used to build a `StaffMember` here and mint a PIN in the browser, which
   * looked identical on screen and survived nothing: the cashier existed until
   * the page was reloaded, and the PIN they had been given was never a
   * credential anywhere. The staff code and the PIN are both the server's to
   * issue — the code has to be unique across the branch, and the PIN must be
   * hashed before it is stored and never leave in readable form again.
   */
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    setSubmitting(true);

    const result = await createSalesPersonAction({
      fullName: values.fullName.trim(),
      phone: normalisePhone(values.phone),
      email: values.email.trim(),
      // Sent because the form collects it; the server ignores it and uses the
      // manager's own branch, so this cannot land a cashier elsewhere.
      branchId: branchId ?? "",
      password: values.password.trim(),
    });

    if (result.ok) {
      onCreated(result.staff, result.temporaryPin, result.temporaryPassword);
    } else {
      setErrors({ [result.field === "form" ? "fullName" : result.field]: result.message });
    }
    setSubmitting(false);
  }

  return (
    <Panel>
      <PanelHeader
        title="New sales person"
        meta="They get a till PIN and a password. Both are shown once, on the next screen."
        action={
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="rounded-input p-2 text-ink-40 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
          >
            <X size={20} />
          </button>
        }
      />

      <form onSubmit={handleSubmit} noValidate className="p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Full name"
            value={values.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            placeholder="Blessing Achike"
            autoComplete="off"
            required
            invalid={Boolean(errors.fullName)}
            hint={errors.fullName}
          />

          <TextField
            label="Phone number"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="0801 234 5678"
            inputMode="tel"
            autoComplete="off"
            required
            invalid={Boolean(errors.phone)}
            hint={errors.phone ?? "How the branch reaches them, and how a PIN reset is sent."}
          />

          <TextField
            label="Email address"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="Optional"
            inputMode="email"
            autoComplete="off"
            invalid={Boolean(errors.email)}
            hint={errors.email ?? "Optional. A cashier signs in with their staff code."}
          />

          <TextField
            label="Starting password"
            type="password"
            value={values.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder="Leave blank to generate one"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            hint={
              errors.password ??
              "Optional. Blank generates one that is easy to read out. Changed on first sign-in either way."
            }
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-body font-semibold text-ink">Staff code</span>
            <div className="flex min-h-14 items-center rounded-input border border-line bg-paper px-4">
              <span className="font-mono text-body-lg text-ink">{nextCode}</span>
            </div>
            <p className="text-body text-ink-40">
              Generated, and printed on every receipt they issue.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="submit" loading={submitting}>
            {submitting ? "Creating" : "Create sales person"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** `ABJ03-C11` — the branch prefix carried forward, the number incremented. */
function nextStaffCode(existing: readonly string[]): string {
  const cashierCodes = existing.filter((code) => /-C\d+$/.test(code));
  const prefix = cashierCodes[0]?.replace(/-C\d+$/, "") ?? "ABJ03";
  const highest = cashierCodes.reduce((max, code) => {
    const n = Number(code.match(/-C(\d+)$/)?.[1] ?? 0);
    return Math.max(max, n);
  }, 0);
  return `${prefix}-C${String(highest + 1).padStart(2, "0")}`;
}

/**
 * A six-digit starting PIN — SPEC §17.
 *
 * `crypto.getRandomValues`, not `Math.random`: this is a credential, and the
 * cost of using the right generator is one line. It is changed on first sign-in
 * regardless, but a predictable starting PIN is a window between creation and
 * that first sign-in.
 */
function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  return digits.startsWith("0") ? `+234${digits.slice(1)}` : digits;
}
