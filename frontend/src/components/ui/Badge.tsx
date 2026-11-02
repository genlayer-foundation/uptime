import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "success" | "danger" | "warn" | "purple";

const BADGE: Record<Tone, string> = {
  neutral: "border-border text-muted",
  success: "border-success-border text-success-fg",
  danger: "border-danger-border text-danger-fg",
  warn: "border-warn-border text-warn-fg",
  purple: "border-purple/30 text-purple",
};

/** The old "SLA Met" pill. */
export function Badge({ tone = "neutral", title, children, className }: { tone?: Tone; title?: string; children: ReactNode; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs", BADGE[tone], className)}>
      {children}
    </span>
  );
}

const DOT: Record<Tone, string> = {
  neutral: "bg-border-strong",
  success: "bg-success",
  danger: "bg-danger",
  warn: "bg-warn",
  purple: "bg-purple",
};

/** The old status dot. `pulse` for loading. */
export function StatusDot({ tone = "neutral", pulse, size = "sm" }: { tone?: Tone; pulse?: boolean; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-full", size === "md" ? "h-2.5 w-2.5" : "h-2 w-2", DOT[tone], pulse && "animate-pulse")}
    />
  );
}
