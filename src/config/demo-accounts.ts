import type { StaffRole } from "@/types/enums";

/**
 * The accounts `npm run db:seed` creates, and their credentials.
 *
 * **Development only.** This file is imported by the seed *and* by the sign-in
 * screen's demo list, which is the entire point: the two used to be written out
 * separately and drifted, so the screen offered a password the database had
 * never heard of and sign-in failed with a message that blamed the user.
 *
 * The secrets are in the repository on purpose. They are fixtures for a seeded
 * development database, they are printed by the seed anyway, and pretending
 * otherwise while shipping them in a mock file helps nobody. What matters is
 * that the *seed* is never run against production, and that the demo list below
 * is rendered only outside production — see `DemoAccounts` in the sign-in panel.
 */

export const DEMO_PASSWORD = "swiftgrocers-2026";
export const DEMO_PIN = "1234";

export type DemoAccount = {
  /** What to type: an email address, or a staff code for a till PIN. */
  identifier: string;
  secret: string;
  fullName: string;
  role: StaffRole;
  /** How the credential is described, since the two kinds behave differently. */
  kind: "password" | "pin";
  note: string;
};

/**
 * One of each tier, which is all a demo needs.
 *
 * The seed creates a manager and a cashier for every branch; listing all nine
 * on the sign-in screen would bury the three that matter behind six that behave
 * identically.
 */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    identifier: "GWA-C01",
    secret: DEMO_PIN,
    fullName: "Gwarinpa Cashier",
    role: "sales_person",
    kind: "pin",
    note: "Opens the till. A staff code and four digits — what a cashier types.",
  },
  {
    identifier: "gwa.manager@swiftgrocers.ng",
    secret: DEMO_PASSWORD,
    fullName: "Gwarinpa Manager",
    role: "branch_manager",
    kind: "password",
    note: "Runs one branch: its stock, its roster, its takings.",
  },
  {
    identifier: "admin@swiftgrocers.ng",
    secret: DEMO_PASSWORD,
    fullName: "Chain Admin",
    role: "general_admin",
    kind: "password",
    note: "Sees every branch.",
  },
];
