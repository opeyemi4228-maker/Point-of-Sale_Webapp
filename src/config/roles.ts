import type { StaffRole } from "@/types";

/**
 * Where each role lands after sign-in, and which route prefixes it may reach.
 * Authority flows downward, visibility flows upward — SPEC §3.
 *
 * This is convenience routing only. The real seal is row-level security in the
 * database (SPEC §8), never this file.
 */
export const ROLE_HOME: Record<StaffRole, string> = {
  sales_person: "/till",
  branch_manager: "/manager",
  general_admin: "/hq",
};

export const ROLE_LABEL: Record<StaffRole, string> = {
  sales_person: "Sales Person",
  branch_manager: "Branch Manager",
  general_admin: "General Admin",
};

export const ROLE_ROUTE_PREFIXES: Record<StaffRole, readonly string[]> = {
  sales_person: ["/till"],
  branch_manager: ["/manager", "/till"],
  general_admin: ["/hq", "/manager", "/till"],
};
