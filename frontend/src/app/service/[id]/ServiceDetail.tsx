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
import { formatUptime, timeAgo, uptimeColor, statusColor, formatTimestamp } from "@/lib/utils/format";
import { UptimeChart } from "@/components/UptimeChart";
import {
  Activity,
  Globe,
  Server,
  ExternalLink,
  ArrowUpRight,
  Clock,
  CheckCircle,
  XCircle,
  FileCode,
  Layers,
} from "lucide-react";

function CategoryIcon({ category }: { category: string }) {
  switch (category) {
    case "rpc":
      return <Server className="h-5 w-5" />;
    case "explorer":
      return <Globe className="h-5 w-5" />;
    default:
      return <Activity className="h-5 w-5" />;
  }
}

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              hasData
                ? isUp
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-red-500/20 text-red-400"
                : "bg-gray-500/20 text-gray-400"
            }`}
          >
            <CategoryIcon category={service.category} />
          </div>
          <div>
            <h1
              className="text-2xl font-semibold text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {service.name}
            </h1>
            <p className="text-sm text-gray-500">{service.description}</p>
            <a
              href={service.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-purple transition-colors"
            >
              {service.url}
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`h-3 w-3 rounded-full ${
              hasData ? statusColor(isUp) : "bg-gray-500"
            } ${isUp ? "shadow-[0_0_8px_rgba(16,185,129,0.6)]" : ""}`}
          />
          <span
            className={`text-sm font-medium ${
              hasData
                ? isUp
                  ? "text-emerald-400"
                  : "text-red-400"
                : "text-gray-400"
            }`}
          >
            {hasData ? (isUp ? "Operational" : "Down") : "No data"}
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Status"
          value={hasData ? (isUp ? "Up" : "Down") : "Unknown"}
          icon={isUp ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
        />
        <StatCard
          label="Check Type"
          value={checkTypeLabel(service.category)}
          icon={<Server className="h-4 w-4 text-purple" />}
        />
        <StatCard
          label="Last Checked"
          value={serviceStatus?.latest ? timeAgo(serviceStatus.latest.timestamp) : "Never"}
          icon={<Clock className="h-4 w-4 text-purple" />}
        />
        <StatCard
          label="Total Checks"
          value={String(serviceStatus?.total_checks ?? 0)}
          icon={<Activity className="h-4 w-4 text-purple" />}
        />
      </div>

      {/* Uptime Stats */}
      {hasData && (
        <div className="grid gap-4 sm:grid-cols-3">
          <UptimeStatCard
            period="24 Hours"
            value={serviceStatus?.uptime_24h ?? 0}
          />
          <UptimeStatCard
            period="7 Days"
            value={serviceStatus?.uptime_7d ?? 0}
          />
          <UptimeStatCard
            period="30 Days"
            value={serviceStatus?.uptime_30d ?? 0}
          />
        </div>
      )}

      {/* ZKSync Block Sync Status */}
      {isZksync && syncData && syncData.rpcBlock && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Layers className="h-4 w-4 text-purple" />
            <h3 className="text-sm font-medium text-gray-300">
              ZKSync Chain Status
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                Latest Block
              </p>
              <p className="font-mono text-lg text-white">
                {syncData.rpcBlock.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                Block Timestamp
              </p>
              <p className="font-mono text-sm text-white">
                {new Date(syncData.blockTimestamp * 1000).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                Block Age
              </p>
              <p
                className={`font-mono text-lg ${
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
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <UptimeChart serviceId={serviceId} />
      </div>

      {/* Contract Deployments */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="mb-3 flex items-center gap-2">
          <FileCode className="h-4 w-4 text-purple" />
          <h3 className="text-sm font-medium text-gray-300">
            On-Chain Contract
          </h3>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Check results for this service are stored in the UptimeMonitor
          contract deployed on these networks:
        </p>
        <div className="space-y-2">
          {CONTRACT_DEPLOYMENTS.map((d) => (
            <a
              key={d.networkId}
              href={getContractExplorerLink(d)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2.5 transition-colors hover:border-purple/30"
            >
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm text-gray-300">
                  {d.networkName}
                </span>
                <code className="font-mono text-xs text-gray-500">
                  {shortenAddress(d.address)}
                </code>
              </div>
              <ExternalLink className="h-3.5 w-3.5 text-gray-500" />
            </a>
          ))}
        </div>
      </div>

      {/* Recent Checks Table */}
      {history && history.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h3 className="mb-3 text-sm font-medium text-gray-300">
            Recent Checks
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Details</th>
                  <th className="pb-2">Verify</th>
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
                        className="border-b border-white/5 last:border-0"
                      >
                        <td className="py-2 pr-4 font-mono text-xs text-gray-400">
                          {formatTimestamp(ts)}
                        </td>
                        <td className="py-2 pr-4">
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
                        <td className="py-2 pr-4 font-mono text-xs text-gray-500">
                          {check.extra_data || "-"}
                        </td>
                        <td className="py-2">
                          {txHash ? (
                            <a
                              href={getTxExplorerLink(deployNetworkId, txHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-purple hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Tx
                            </a>
                          ) : (
                            <span className="text-xs text-gray-600">-</span>
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

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function UptimeStatCard({
  period,
  value,
}: {
  period: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">
        Uptime {period}
      </p>
      <p className={`mt-1 font-mono text-2xl font-semibold ${uptimeColor(value)}`}>
        {formatUptime(value)}
      </p>
    </div>
  );
}
