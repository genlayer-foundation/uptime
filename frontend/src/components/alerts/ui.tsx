"use client";

// Alerts-specific bits on top of the shared primitives in @/components/ui.

import type { ReactNode } from "react";
import { Alert, cn } from "@/components/ui";
import type { Bound } from "@/lib/mailer/limits";

/** A checkbox with a label and a muted description, in the app's form style. */
export function CheckRow({
  id,
  checked,
  onChange,
  label,
  help,
  disabled,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  help?: ReactNode;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-purple disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className={cn("grid gap-0.5 text-sm", disabled ? "cursor-not-allowed text-muted" : "cursor-pointer text-foreground")}>
        <span>{label}</span>
        {help ? <span className="text-xs text-muted">{help}</span> : null}
        {error ? <span className="text-xs text-danger-fg">{error}</span> : null}
      </label>
    </div>
  );
}

/** "default 10, 1-50" under a limit field. */
export function boundHelp(b: Bound, unit = "") {
  return `Default ${b.default}${unit}. Allowed ${b.min}–${b.max}${unit}.`;
}

/** Shown in place of the alert forms while MAILER_ENABLED is off on this server. */
export function AlertsOffNotice() {
  return (
    <Alert tone="info" title="Email alerts are not switched on for this server yet">
      Alert settings open up once the operator enables the mailer. Until then no alert email is sent or charged.
    </Alert>
  );
}
