import type { ReactNode } from "react";
import { CircleCheck, Info, TriangleAlert, OctagonAlert } from "lucide-react";
import { cn } from "./cn";

type AlertTone = "info" | "success" | "warn" | "danger";

const TONE: Record<AlertTone, { box: string; icon: typeof Info }> = {
  info: { box: "border-border bg-surface text-foreground", icon: Info },
  success: { box: "border-success-border text-foreground", icon: CircleCheck },
  warn: { box: "border-warn-border bg-banner-bg/40 text-foreground", icon: TriangleAlert },
  danger: { box: "border-danger-border text-foreground", icon: OctagonAlert },
};

const ICON: Record<AlertTone, string> = {
  info: "text-muted",
  success: "text-success-fg",
  warn: "text-warn-fg",
  danger: "text-danger-fg",
};

export function Alert({ tone = "info", title, children, className }: { tone?: AlertTone; title: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = TONE[tone].icon;
  return (
    <div role="status" className={cn("flex gap-3 rounded-lg border px-4 py-3", TONE[tone].box, className)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ICON[tone])} aria-hidden />
      <div className="text-sm">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-0.5 text-muted">{children}</div> : null}
      </div>
    </div>
  );
}
