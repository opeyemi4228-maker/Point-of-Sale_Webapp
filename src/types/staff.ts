import type { StaffRole, StaffStatus } from "./enums";

/** A staff member — SPEC §7.2 `staff`. */
export type Staff = {
  id: string;
  orgId: string;
  /** NULL only for general_admin — SPEC §7.2 `branch_required_for_non_admin`. */
  branchId: string | null;
  branchName: string | null;
  role: StaffRole;
  fullName: string;
  email: string;
  /** Printed on receipts, e.g. ABJ03-C07 — SPEC §12. */
  staffCode: string;
  status: StaffStatus;
};

/**
 * What the client holds after a successful sign-in.
 *
 * Mirrors the claims the real auth token will carry (SPEC §8): staff_id, role,
 * branch_id, org_id. Row-level security reads those claims server-side — this
 * object is for rendering only and is never the security boundary.
 */
export type Session = {
  staff: Staff;
  signedInAt: string;
};

export type SignInResult =
  | { ok: true; session: Session }
  | { ok: false; error: SignInError };

export type SignInError = {
  code:
    | "UNKNOWN_ACCOUNT"
    | "WRONG_PASSWORD"
    | "ACCOUNT_SUSPENDED"
    | "ACCOUNT_LOCKED"
    | "MISSING_FIELDS";
  /** Written for the person reading it, in the interface's voice — SPEC §16. */
  message: string;
};
