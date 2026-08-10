import type { Staff } from "@/types/staff";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  FIXTURE DATA — NOT PRODUCTION AUTHENTICATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Passwords are in plaintext here because this file exists only to make the
 * screens usable before real auth is wired up. Real credentials are held by
 * Neon Auth (Stack Auth) and never reach the client (SPEC §17).
 *
 * When the real auth lands, this file is deleted. Nothing outside
 * `lib/data/mock/` may import it.
 */

export type MockAccount = Staff & { password: string };

const ORG = "org_swiftgrocers";

export const MOCK_ACCOUNTS: readonly MockAccount[] = [
  {
    id: "stf_admin_01",
    orgId: ORG,
    branchId: null,
    branchName: null,
    role: "general_admin",
    fullName: "Tunde Adeyemi",
    email: "admin@swiftgrocers.ng",
    staffCode: "SWG-HQ-01",
    status: "active",
    password: "hq-admin-2026",
  },
  {
    id: "stf_mgr_abj03",
    orgId: ORG,
    branchId: "brn_gwarinpa",
    branchName: "Gwarinpa",
    role: "branch_manager",
    fullName: "Ifeoma Nwosu",
    email: "gwarinpa.manager@swiftgrocers.ng",
    staffCode: "ABJ03-M01",
    status: "active",
    password: "gwarinpa-2026",
  },
  {
    id: "stf_mgr_abj01",
    orgId: ORG,
    branchId: "brn_wuse",
    branchName: "Wuse II",
    role: "branch_manager",
    fullName: "Emeka Okafor",
    email: "wuse.manager@swiftgrocers.ng",
    staffCode: "ABJ01-M01",
    status: "active",
    password: "wuse-two-2026",
  },
  {
    id: "stf_cashier_01",
    orgId: ORG,
    branchId: "brn_gwarinpa",
    branchName: "Gwarinpa",
    role: "sales_person",
    fullName: "Blessing Achike",
    email: "blessing.a@swiftgrocers.ng",
    staffCode: "ABJ03-C07",
    status: "active",
    password: "blessing-2026",
  },
  {
    id: "stf_cashier_02",
    orgId: ORG,
    branchId: "brn_gwarinpa",
    branchName: "Gwarinpa",
    role: "sales_person",
    fullName: "Chidi Obi",
    email: "chidi.o@swiftgrocers.ng",
    staffCode: "ABJ03-C08",
    status: "suspended",
    password: "chidi-obi-2026",
  },
] as const;

/** Shown on the sign-in screen while the backend is mocked. */
export const DEMO_ACCOUNTS = MOCK_ACCOUNTS.filter((a) => a.status === "active");
