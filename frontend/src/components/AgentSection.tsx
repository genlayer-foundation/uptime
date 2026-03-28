"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
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
    <section className="mt-10 flex flex-col items-center pb-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted">
        Are You An Agent?
      </p>

      {/* curl command */}
      <button
        onClick={handleCopy}
        className="mt-4 flex w-full max-w-xl items-center justify-between rounded-lg bg-zinc-900 px-5 py-3 font-mono text-sm text-zinc-100 transition-colors hover:bg-zinc-800"
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
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded border border-border text-[10px] font-medium text-foreground">
            1
          </span>
          Read the guide
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded border border-border text-[10px] font-medium text-foreground">
            2
          </span>
          Create your SLA contract
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded border border-border text-[10px] font-medium text-foreground">
            3
          </span>
          Enforce it with Internet Court
        </span>
      </div>

      <Link
        href="/sla-integration"
        className="mt-4 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
      >
        Learn more
        <ArrowRight className="h-3 w-3" />
      </Link>
    </section>
  );
}
