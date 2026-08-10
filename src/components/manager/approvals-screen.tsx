"use client";

import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { MOCK_APPROVALS } from "@/lib/data/mock/operations";
import { format } from "@/lib/domain/money";
import { stamp } from "@/lib/utils/format-date";
import type { Approval } from "@/types/operations";
import { PageBody } from "@/components/ui/page-body";

const KIND_LABEL: Record<Approval["kind"], string> = {
  price_override: "Price override",
  void_sale: "Void sale",
  refund: "Refund",
  post_count: "Post count",
};

const STATUS: Record<Approval["status"], { tone: StatusTone; label: string }> = {
  pending: { tone: "waiting", label: "Waiting on you" },
  approved: { tone: "done", label: "Approved" },
  denied: { tone: "stopped", label: "Denied" },
};

/**
 * The approvals queue — SPEC §3.
 *
 * A cashier cannot refund, void a completed sale, override a price or post a
 * large count variance on their own. Each of those raises a request that blocks
 * only that action, never the rest of the sale, and lands here.
 *
 * Nothing is ever resolved anonymously or silently: every decision records who
 * asked, who decided and when (§3), which is exactly what makes the queue worth
 * having as an anti-fraud control rather than a chore.
 */
export function ApprovalsScreen() {
  const [approvals, setApprovals] = useState<Approval[]>(MOCK_APPROVALS);

  const pending = approvals.filter((a) => a.status === "pending");
  const settled = approvals.filter((a) => a.status !== "pending");

  function resolve(id: string, decision: "approved" | "denied") {
    setApprovals((current) =>
      current.map((a) => (a.id === id ? { ...a, status: decision } : a)),
    );
  }

  return (
    <PageBody>
      <Panel>
        <PanelHeader
          title="Waiting on you"
          meta={
            pending.length === 0
              ? "Nothing is blocked"
              : `${pending.length} ${pending.length === 1 ? "request is" : "requests are"} holding up a till`
          }
        />

        {pending.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing waiting"
            detail="Refunds, voids, price overrides and large count variances appear here the moment a cashier raises one."
          />
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((approval) => (
              <li key={approval.id} className="flex flex-wrap gap-4 px-5 py-4">
                <div className="min-w-64 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{approval.summary}</span>
                    <StatusPill tone="idle">{KIND_LABEL[approval.kind]}</StatusPill>
                  </p>
                  <p className="mt-1 text-body text-ink-70">{approval.detail}</p>
                  <p className="mt-1 text-body text-ink-40">
                    {approval.requestedBy} · {stamp(approval.requestedAt)}
                  </p>
                </div>

                <div className="flex shrink-0 items-start gap-2">
                  <Button onClick={() => resolve(approval.id, "approved")}>
                    <Check size={18} aria-hidden />
                    Approve
                  </Button>
                  <Button variant="secondary" onClick={() => resolve(approval.id, "denied")}>
                    <X size={18} aria-hidden />
                    Deny
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Already decided"
          meta="Kept for the audit log — a decision is never deleted (CLAUDE.md rule 4)"
        />
        <ul className="divide-y divide-line">
          {settled.map((approval) => {
            const status = STATUS[approval.status];
            return (
              <li key={approval.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="min-w-64 flex-1">
                  <p className="font-medium text-ink">{approval.summary}</p>
                  <p className="text-body text-ink-40">
                    {approval.requestedBy} · {stamp(approval.requestedAt)}
                    {approval.amount && ` · ${format(approval.amount)}`}
                  </p>
                </div>
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
              </li>
            );
          })}
        </ul>
      </Panel>
    </PageBody>
  );
}
