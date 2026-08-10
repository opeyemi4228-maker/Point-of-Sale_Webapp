import type { Money } from "@/lib/domain/money";
import type { StaffRole, StaffStatus } from "./enums";

/**
 * A staff member as the manager's roster shows them — SPEC §15.2.
 *
 * Void rate and refund rate sit beside each other because an outlier on both is
 * the classic signature of till theft. Surfacing that as a default column
 * rather than a buried report is a deliberate choice, not a nicety.
 */
export type StaffMember = {
  id: string;
  fullName: string;
  staffCode: string;
  role: StaffRole;
  branchId: string | null;
  status: StaffStatus;
  phone: string | null;
  email: string | null;
  /** ISO instant, or null if they have never opened a shift. */
  lastShiftAt: string | null;
  salesPerHour: Money;
  voidRatePercent: number;
  refundRatePercent: number;
};

/** What the create-a-cashier form collects — SPEC §15.2. */
export type NewSalesPerson = {
  fullName: string;
  phone: string;
  email: string;
  branchId: string;
  /**
   * A starting password, or blank to have one generated.
   *
   * Optional because a manager standing with a new cashier usually wants to
   * agree one out loud, and being forced to invent a strong password on their
   * behalf produces the same three passwords across a chain. Either way it is
   * temporary — the account is flagged to change it on first use.
   */
  password?: string;
};

/**
 * The two credentials, handed back exactly once.
 *
 * Only the hashes are stored, so this response is the single moment either
 * secret exists in readable form anywhere in the system. The screen that
 * receives it has to say so.
 */
export type CreateStaffResult =
  | {
      ok: true;
      staff: StaffMember;
      /** Four digits, for opening a till. */
      temporaryPin: string;
      /** For signing in anywhere else. Must be changed on first use. */
      temporaryPassword: string;
    }
  | {
      ok: false;
      field: keyof NewSalesPerson | "password" | "form";
      message: string;
    };

/** A loyalty member. The phone number is the card — SPEC §11. */
export type Customer = {
  id: string;
  fullName: string;
  /** E.164. Masked everywhere except the detail view (§17). */
  phone: string;
  homeBranchId: string;
  enrolledAt: string;
  visits: number;
  lifetimeSpend: Money;
  pointsBalance: number;
  lastVisitAt: string | null;
};
