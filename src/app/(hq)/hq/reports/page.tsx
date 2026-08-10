import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightLeft,
  ChartColumn,
  ChevronRight,
  Download,
  IdCard,
  Package,
  ScrollText,
  Store,
} from "lucide-react";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageBody } from "@/components/ui/page-body";

export const metadata: Metadata = {
  title: "Reports · Swiftgrocers POS",
};

/**
 * Chain reports — SPEC §15.3.
 *
 * Everything a branch manager can see, plus the things only visible from above
 * one branch: how branches compare, how stock flows between them, and what the
 * loyalty programme actually costs against what it returns.
 */
const REPORTS = [
  {
    icon: Store,
    title: "Branch comparison",
    detail: "Every branch side by side on sales, basket, margin and shrinkage.",
    meta: "The report this tier exists for",
  },
  {
    icon: ChartColumn,
    title: "Chain product performance",
    detail: "What sells where. Lines that move in Lagos and sit in Abuja.",
    meta: "By product, category and branch",
  },
  {
    icon: ArrowRightLeft,
    title: "Transfer flow",
    detail: "Stock moving between branches, and which routes keep repeating.",
    meta: "Volume, value and shortfalls",
  },
  {
    icon: Package,
    title: "Shrinkage",
    detail: "Count variances and write-offs across the chain, valued at cost.",
    meta: "Ranked by branch",
  },
  {
    icon: IdCard,
    title: "Loyalty programme",
    detail: "Points issued against redeemed, and the liability carried on the books.",
    meta: "Cost, redemption rate, tier mix",
  },
  {
    icon: ScrollText,
    title: "Audit explorer",
    detail: "Filter every privileged action by actor, action, entity and date.",
    meta: "Seven-year retention",
  },
];

export default function HqReportsPage() {
  return (
    <>
      <WorkspaceHeader
        title="Reports"
        subtitle="Consolidated across every branch"
        actions={
          <Button variant="secondary">
            <Download size={18} aria-hidden />
            Export all
          </Button>
        }
      />

      <PageBody>
        <Panel>
          <PanelHeader title="Reports" meta="Every report exports to CSV and XLSX" />

          <ul className="divide-y divide-line">
            {REPORTS.map(({ icon: Icon, title, detail, meta }) => (
              <li key={title}>
                <Link
                  href={title === "Audit explorer" ? "/hq/audit" : "/hq/reports"}
                  className="flex items-center gap-4 px-5 py-4 transition-colors duration-150 ease-out-pos hover:bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-market"
                >
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-input bg-market-tint text-market"
                  >
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{title}</span>
                    <span className="block text-body text-ink-70">{detail}</span>
                    <span className="block text-label text-ink-40">{meta}</span>
                  </span>
                  <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-40" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </PageBody>
    </>
  );
}
