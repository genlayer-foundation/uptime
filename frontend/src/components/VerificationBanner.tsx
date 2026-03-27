"use client";

import { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import {
  CONTRACT_DEPLOYMENTS,
  getContractExplorerLink,
  shortenAddress,
} from "@/lib/utils/contracts";

export function VerificationBanner() {
  return (
    <section className="border-t border-border pt-8">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
        On-Chain Verification
      </h2>
      <p className="mt-2 text-sm text-muted">
        Every result is stored on-chain. Verify any check yourself.
      </p>

      <div className="mt-4 space-y-2">
        {CONTRACT_DEPLOYMENTS.map((deployment) => (
          <ContractRow key={deployment.networkId} deployment={deployment} />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted">
        The same{" "}
        <a
          href="https://github.com/genlayer-foundation/uptime/blob/main/contracts/uptime_monitor.py"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground hover:text-purple transition-colors"
        >
          UptimeMonitor.py
        </a>{" "}
        contract is deployed on each network.
      </p>
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
    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-foreground">
          {deployment.networkName}
        </span>
        <code className="font-mono text-xs text-muted">
          {shortenAddress(deployment.address)}
        </code>
        <button
          onClick={handleCopy}
          className="text-muted hover:text-foreground transition-colors"
          title="Copy address"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
      <a
        href={explorerLink}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
      >
        Explorer
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
