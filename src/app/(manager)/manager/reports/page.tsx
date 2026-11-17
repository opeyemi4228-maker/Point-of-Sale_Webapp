import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarX2,
  TrendingUp,
  ChartColumn,
  ChevronRight,
  Download,
  IdCard,
  Package,
  Percent,
  Users,
  Wallet,
} from "lucide-react";
import { BranchLabel } from "@/components/shared/branch-label";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { PageBody } from "@/components/ui/page-body";

export const metadata: Metadata = {
  title: "Reports · Swiftgrocers POS",
};

/**
 * Branch reports — SPEC §15.2.
 *
 * A directory rather than a dashboard. Every report here answers one question,
 * is scoped to this branch by row-level security rather than by a filter (§8),
 * and exports to CSV and XLSX because the finance team works in a spreadsheet
 * whatever we build.
 */
const REPORTS: {
  icon: typeof ChartColumn;
  title: string;
  detail: string;
  meta: string;
  href?: string;
}[] = [
  {
    icon: TrendingUp,
    title: "Stock & sales",
    detail: "Takings by day and a full stock reconciliation: opening, received, sold, expired, lost and closing.",
    meta: "Live · exports to CSV",
    href: "/manager/stock-sales",
  },
  {
    icon: CalendarX2,
    title: "Expiry & write-offs",
    detail: "Stock past its date, and the protected register of everything written off.",
    meta: "Live · by reason",
    href: "/manager/expiry",
  },
  {
    icon: ChartColumn,
    title: "Sales",
    detail: "By day, by cashier, by category, by product. The one most people want.",
    meta: "Daily · weekly · custom range",
  },
  {
    icon: Percent,
    title: "Product performance & margin",
    detail: "ABC classes, gross margin, GMROI, sell-through, days of cover — and the dead stock tying up cash.",
    meta: "Live · by product and category",
    href: "/manager/reports/performance",
  },
  {
    icon: Package,
    title: "Shrinkage",
    detail: "Count variances, damage, expiry and theft, valued at cost.",
    meta: "Live · per stock count",
    href: "/manager/counts",
  },
  {
    icon: Wallet,
    title: "Cash variance",
    detail: "Every shift close, its expected and counted cash, and who resolved the gap.",
    meta: "By cashier and by shift",
  },
  {
    icon: Users,
    title: "Staff performance",
    detail: "Sales per hour, basket size, void rate and refund rate side by side.",
    meta: "Rolling 14 and 90 days",
  },
  {
    icon: IdCard,
    title: "Loyalty",
    detail: "Points issued against points redeemed — what the programme actually costs.",
    meta: "Issuance, redemption, liability",
  },
];

export default function ManagerReportsPage() {
  return (
    <>
      <WorkspaceHeader
        title="Reports"
        subtitle={<BranchLabel suffix="scoped to this branch" />}
        actions={
          <Button variant="secondary">
            <Download size={18} aria-hidden />
            Export all
          </Button>
        }
      />

      <PageBody>
        <Panel>
          <PanelHeader
            title="Reports"
            meta="Every report exports to CSV and XLSX"
          />

          <ul className="divide-y divide-line">
            {REPORTS.map(({ icon: Icon, title, detail, meta, href }) => (
              <li key={title}>
                <Link
                  href={href ?? "/manager/reports"}
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
