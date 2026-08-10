import type { Metadata } from "next";
import { TabletSmartphone } from "lucide-react";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { TableScroller } from "@/components/ui/table-scroller";
import { BRANCH_NAME } from "@/lib/data/mock/branches";
import { MOCK_DEVICES } from "@/lib/data/mock/operations";
import { stamp } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import type { Device } from "@/types/operations";
import { PageBody } from "@/components/ui/page-body";

export const metadata: Metadata = {
  title: "Devices · Swiftgrocers POS",
};

/** Beyond this, the device's clock is a data-integrity problem — SPEC §10. */
const CLOCK_SKEW_ALERT_MINUTES = 5;

function health(device: Device): { tone: StatusTone; label: string } {
  if (!device.online) return { tone: "stopped", label: "Offline" };
  if (device.clockSkewMinutes > CLOCK_SKEW_ALERT_MINUTES) {
    return { tone: "warning", label: "Clock drift" };
  }
  if (device.queuedWrites > 0) return { tone: "live", label: "Syncing" };
  return { tone: "done", label: "Synced" };
}

/**
 * The device register — SPEC §10, §16 admin.
 *
 * Offline is a normal operating mode, not an error (§10) — a till with queued
 * writes is working exactly as designed. What actually matters here is the pair
 * that cannot be explained away: a device that has been dark for hours with a
 * queue on it, and a clock that has drifted far enough to reorder events.
 *
 * A key can be revoked from this screen, and a revoked device wipes its local
 * IndexedDB the next time it launches (§17).
 */
export default function HqDevicesPage() {
  const offline = MOCK_DEVICES.filter((d) => !d.online);
  const drifting = MOCK_DEVICES.filter(
    (d) => d.clockSkewMinutes > CLOCK_SKEW_ALERT_MINUTES,
  );
  const queued = MOCK_DEVICES.reduce((n, d) => n + d.queuedWrites, 0);

  return (
    <>
      <WorkspaceHeader
        title="Devices"
        subtitle={`${MOCK_DEVICES.length} tills registered across the chain`}
      />

      <PageBody>
        <Panel>
          <div className="grid divide-line sm:grid-cols-3 sm:divide-x">
            <StatTile
              label="Offline now"
              value={String(offline.length)}
              hint={offline.length ? "Still selling — writes are queued locally" : "All tills reachable"}
            />
            <StatTile
              label="Queued writes"
              value={queued.toLocaleString("en-NG")}
              hint="Sales held on devices, waiting to sync"
            />
            <StatTile
              label="Clock drift"
              value={String(drifting.length)}
              hint={`Over ${CLOCK_SKEW_ALERT_MINUTES} minutes from the server`}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Registered tills"
            meta="A device without a key cannot sell, and a revoked key wipes the device on next launch"
          />

          {MOCK_DEVICES.length === 0 ? (
            <EmptyState
              icon={TabletSmartphone}
              title="No devices registered"
              detail="Tills are registered when a branch is provisioned, and can be added to a branch afterwards."
            />
          ) : (
            <TableScroller>
              <table className="w-full min-w-240 text-left">
                <thead>
                  <tr className="border-b border-line text-label uppercase text-ink-40">
                    <th scope="col" className="px-5 py-3 font-semibold">Till</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Branch</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Health</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Last seen</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Queued</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Clock</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Version</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {MOCK_DEVICES.map((device) => {
                    const state = health(device);
                    const drift = device.clockSkewMinutes > CLOCK_SKEW_ALERT_MINUTES;

                    return (
                      <tr key={device.id} className="hover:bg-paper">
                        <th scope="row" className="px-5 py-3.5 font-medium text-ink">
                          {device.label}
                          <span className="block font-mono text-label text-ink-40">
                            {device.deviceCode}
                          </span>
                        </th>
                        <td className="px-5 py-3.5 text-ink-70">
                          {BRANCH_NAME[device.branchId] ?? device.branchId}
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusPill tone={state.tone}>{state.label}</StatusPill>
                        </td>
                        <td className="px-5 py-3.5 text-ink-70">{stamp(device.lastSeenAt)}</td>
                        <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                          {device.queuedWrites || "—"}
                        </td>
                        <td
                          className={cn(
                            "px-5 py-3.5 text-right font-numeric",
                            drift ? "font-semibold text-halt" : "text-ink-70",
                          )}
                        >
                          {device.clockSkewMinutes === 0
                            ? "In step"
                            : `+${device.clockSkewMinutes}m`}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-ink-70">
                          {device.appVersion}
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
    </>
  );
}
