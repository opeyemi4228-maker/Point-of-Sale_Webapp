import type { Metadata } from "next";
import { SalesHistory } from "@/components/till/sales-history";
import { WorkspaceHeader } from "@/components/shared/workspace-header";

export const metadata: Metadata = {
  title: "My sales · Swiftgrocers POS",
};

/**
 * The cashier's own sales — SPEC §15.1.
 *
 * Reads the same local ledger the till writes to, so a sale rung a moment ago
 * is already here. Identity comes from the session inside the client component.
 */
export default function TillHistoryPage() {
  return (
    <>
      <WorkspaceHeader title="My sales" subtitle="Today, newest first" />
      <SalesHistory />
    </>
  );
}
