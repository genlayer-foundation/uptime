"use client";

import { useState } from "react";
import { Copy, Check, Terminal, Users } from "lucide-react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const CURL_COMMAND = "curl -s https://uptime.dev.genlayer.foundation/skill.md";

export function AgentSection() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(CURL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="border-t border-border pt-8">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted">
        Are You An Agent?
      </h2>
      <p className="mt-2 text-sm text-muted">
        Deploy trustless SLA contracts. Monitor uptime. Settle disputes on-chain.
      </p>

      <div className="mt-6 flex flex-col items-center">
        {/* curl command */}
        <button
          onClick={handleCopy}
          className="flex w-full max-w-xl items-center justify-between rounded-lg bg-zinc-900 px-5 py-3 font-mono text-sm text-zinc-100 transition-colors hover:bg-zinc-800"
        >
          <span>
            <span className="text-purple">$</span>{" "}
            {CURL_COMMAND}
          </span>
          {copied ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : (
            <Copy className="h-4 w-4 text-zinc-500" />
          )}
        </button>

        {/* Steps */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded border border-border text-[10px] font-medium text-foreground">
              1
            </span>
            Install GenLayer CLI
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded border border-border text-[10px] font-medium text-foreground">
              2
            </span>
            Deploy your SLA contract
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded border border-border text-[10px] font-medium text-foreground">
              3
            </span>
            Settle disputes via Internet Court
          </span>
        </div>

        {/* Links */}
        <div className="mt-6 flex items-center gap-6">
          <Link
            href="/sla-integration"
            className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
          >
            SLA Integration
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
