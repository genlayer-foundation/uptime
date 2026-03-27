"use client";

import { useStatus } from "@/lib/hooks/useStatus";
import { useHistory } from "@/lib/hooks/useHistory";
import { useZksyncSync } from "@/lib/hooks/useZksyncSync";
import { getServiceById } from "@/lib/utils/services";
import {
  CONTRACT_DEPLOYMENTS,
  getContractExplorerLink,
  getTxExplorerLink,
  shortenAddress,
} from "@/lib/utils/contracts";
import { formatUptime, timeAgo, uptimeColor, formatTimestamp } from "@/lib/utils/format";
import { UptimeChart } from "@/components/UptimeChart";
import {
  ExternalLink,
  ArrowUpRight,
  CheckCircle,
  XCircle,
} from "lucide-react";

function checkTypeLabel(category: string): string {
  switch (category) {
    case "rpc":
      return "JSON-RPC eth_blockNumber";
    case "explorer":
      return "HTTP GET → 200";
    case "bridge":
      return "JSON-RPC eth_blockNumber";
    default:
      return "HTTP";
  }
}

export function ServiceDetail({ serviceId }: { serviceId: string }) {
  const service = getServiceById(serviceId);
  const { data: status } = useStatus();
  const { data: history } = useHistory(serviceId, 500);
  const isZksync = serviceId === "zksync_bridge";
  const { data: syncData } = useZksyncSync(isZksync);

  if (!service) return null;

  const serviceStatus = status?.services?.[serviceId];
  const isUp = serviceStatus?.latest?.is_up ?? false;
  const hasData = serviceStatus?.latest !== null;
  const deployNetworkId = process.env.NEXT_PUBLIC_DEPLOY_NETWORK || "studionet";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border/60 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div
              className={`h-2.5 w-2.5 rounded-full ${
                hasData ? (isUp ? "bg-emerald-500" : "bg-red-500") : "bg-zinc-600"
              }`}
            />
            <h1 className="text-xl font-semibold text-foreground">
              {service.name}
            </h1>
            <span
              className={`text-sm ${
                hasData
                  ? isUp
                    ? "text-emerald-400"
                    : "text-red-400"
                  : "text-muted"
              }`}
            >
              {hasData ? (isUp ? "Operational" : "Down") : "No data"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{service.description}</p>
          <a
            href={service.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
          >
            {service.url}
            <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-4">
        <StatCell label="Status" value={hasData ? (isUp ? "Up" : "Down") : "—"} />
        <StatCell label="Check Type" value={checkTypeLabel(service.category)} />
        <StatCell
          label="Last Checked"
          value={serviceStatus?.latest ? timeAgo(serviceStatus.latest.timestamp) : "Never"}
        />
        <StatCell label="Total Checks" value={String(serviceStatus?.total_checks ?? 0)} mono />
      </div>

      {/* Uptime Stats */}
      {hasData && (
        <div className="grid gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-3">
          <UptimeCell period="24 Hours" value={serviceStatus?.uptime_24h ?? 0} />
          <UptimeCell period="7 Days" value={serviceStatus?.uptime_7d ?? 0} />
          <UptimeCell period="30 Days" value={serviceStatus?.uptime_30d ?? 0} />
        </div>
      )}

      {/* ZKSync Block Sync Status */}
      {isZksync && syncData && syncData.rpcBlock && (
        <div className="rounded-lg border border-border/60 p-5">
          <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
            ZKSync Chain Status
          </h3>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted">Latest Block</p>
              <p className="mt-1 font-mono text-lg text-foreground">
                {syncData.rpcBlock.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Block Timestamp</p>
              <p className="mt-1 font-mono text-sm text-foreground">
                {new Date(syncData.blockTimestamp * 1000).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Block Age</p>
              <p
                className={`mt-1 font-mono text-lg ${
                  syncData.secondsBehind <= 30
                    ? "text-emerald-400"
                    : syncData.secondsBehind <= 120
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}
              >
                {syncData.secondsBehind < 60
                  ? `${syncData.secondsBehind}s`
                  : syncData.secondsBehind < 3600
                    ? `${Math.floor(syncData.secondsBehind / 60)}m ${syncData.secondsBehind % 60}s`
                    : `${Math.floor(syncData.secondsBehind / 3600)}h ${Math.floor((syncData.secondsBehind % 3600) / 60)}m`}
              </p>
            </div>
          </div>
          {syncData.error && (
            <p className="mt-2 text-xs text-red-400">{syncData.error}</p>
          )}
        </div>
      )}

      {/* Uptime Chart */}
      <div className="rounded-lg border border-border/60 p-5">
        <UptimeChart serviceId={serviceId} />
      </div>

      {/* Contract Deployments */}
      <div className="border-t border-border/60 pt-6">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
          On-Chain Contract
        </h3>
        <p className="mb-4 text-xs text-muted">
          Check results are stored in the UptimeMonitor contract:
        </p>
        <div className="space-y-2">
          {CONTRACT_DEPLOYMENTS.map((d) => (
            <a
              key={d.networkId}
              href={getContractExplorerLink(d)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3 transition-colors hover:border-border"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm text-foreground">
                  {d.networkName}
                </span>
                <code className="font-mono text-xs text-muted">
                  {shortenAddress(d.address)}
                </code>
              </div>
              <ExternalLink className="h-3.5 w-3.5 text-muted" />
            </a>
          ))}
        </div>
      </div>

      {/* Recent Checks Table */}
      {history && history.length > 0 && (
        <div className="border-t border-border/60 pt-6">
          <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
            Recent Checks
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted">
                  <th className="pb-3 pr-4 font-medium">Time</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Details</th>
                  <th className="pb-3 font-medium">Verify</th>
                </tr>
              </thead>
              <tbody>
                {[...history]
                  .reverse()
                  .slice(0, 50)
                  .map((check, i) => {
                    const ts =
                      typeof check.timestamp === "number"
                        ? check.timestamp
                        : Number(check.timestamp);
                    const txHash = (check as unknown as Record<string, unknown>).txHash as
                      | string
                      | undefined;
                    return (
                      <tr
                        key={i}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="py-2.5 pr-4 font-mono text-xs text-muted">
                          {formatTimestamp(ts)}
                        </td>
                        <td className="py-2.5 pr-4">
                          {check.is_up ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                              <CheckCircle className="h-3 w-3" /> Up
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-red-400">
                              <XCircle className="h-3 w-3" /> Down
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs text-muted">
                          {check.extra_data || "—"}
                        </td>
                        <td className="py-2.5">
                          {txHash ? (
                            <a
                              href={getTxExplorerLink(deployNetworkId, txHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Tx
                            </a>
                          ) : (
                            <span className="text-xs text-zinc-700">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-background p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-sm font-medium text-foreground ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function UptimeCell({
  period,
  value,
}: {
  period: string;
  value: number;
}) {
  return (
    <div className="bg-background p-4">
      <p className="text-xs text-muted">Uptime {period}</p>
      <p className={`mt-1 font-mono text-xl font-semibold ${uptimeColor(value)}`}>
        {formatUptime(value)}
      </p>
    </div>
  );
}
