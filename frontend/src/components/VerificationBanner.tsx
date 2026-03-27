"use client";

import { useState } from "react";
import { ExternalLink, Copy, Check, Shield } from "lucide-react";
import {
  CONTRACT_DEPLOYMENTS,
  getContractExplorerLink,
  shortenAddress,
} from "@/lib/utils/contracts";

export function VerificationBanner() {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple/20">
          <Shield className="h-4 w-4 text-purple" />
        </div>
        <div>
          <h2
            className="text-base font-semibold text-white"
            style={{ fontFamily: "var(--font-display)" }}
          >
            On-Chain Verification
          </h2>
          <p className="text-xs text-gray-500">
            Every result is stored on-chain. Verify any check yourself.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {CONTRACT_DEPLOYMENTS.map((deployment) => (
          <ContractRow key={deployment.networkId} deployment={deployment} />
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.02] p-3">
        <p className="text-xs text-gray-500">
          The same{" "}
          <a
            href="https://github.com/genlayer-foundation/uptime/blob/main/contracts/uptime_monitor.py"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple hover:underline"
          >
            UptimeMonitor.py
          </a>{" "}
          contract is deployed on each network. Read the contract storage
          directly to verify any historical check.
        </p>
      </div>
    </section>
  );
}

function ContractRow({
  deployment,
}: {
  deployment: (typeof CONTRACT_DEPLOYMENTS)[number];
}) {
  const [copied, setCopied] = useState(false);
  const explorerLink = getContractExplorerLink(deployment);

  const handleCopy = () => {
    navigator.clipboard.writeText(deployment.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
        <div>
          <p className="text-sm font-medium text-gray-300">
            {deployment.networkName}
          </p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-xs text-gray-500">
              {shortenAddress(deployment.address)}
            </code>
            <button
              onClick={handleCopy}
              className="text-gray-600 hover:text-gray-400 transition-colors"
              title="Copy address"
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>
      </div>
      <a
        href={explorerLink}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-purple/30 hover:text-purple"
      >
        Explorer
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
