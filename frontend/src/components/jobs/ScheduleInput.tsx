"use client";

import { useId } from "react";
import { Field, Input, Segmented } from "@/components/ui";
import type { Schedule } from "@/lib/jobs/types";
import { dateTime } from "./format";
import { MIN_INTERVAL_MIN, nextCronTimes, nextRun, scheduleError } from "./schedule";

const QUICK = [5, 10, 15, 30, 60, 360, 1440];

export function ScheduleInput({ value, onChange, compact = false }: { value: Schedule; onChange: (s: Schedule) => void; compact?: boolean }) {
  const id = useId();
  const mode = value.cron != null ? "cron" : "every";
  const error = scheduleError(value);
  let preview: Date[] = [];
  if (!error) {
    if (value.cron) preview = nextCronTimes(value.cron, new Date(), 3);
    else {
      const first = nextRun(value, new Date());
      if (first) preview = [0, 1, 2].map((i) => new Date(first.getTime() + i * value.everyMinutes! * 60_000));
    }
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Schedule type"
          value={mode}
          options={[
            { value: "every", label: "Every N minutes" },
            { value: "cron", label: "Cron (UTC)" },
          ]}
          onChange={(m) => onChange(m === "cron" ? { cron: value.cron ?? "*/15 * * * *" } : { everyMinutes: value.everyMinutes ?? 15 })}
        />
        {mode === "every" && !compact && (
          <div className="flex flex-wrap gap-2">
            {QUICK.map((m) => (
              <button key={m} type="button" className="text-xs text-purple hover:underline" onClick={() => onChange({ everyMinutes: m })}>
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === "every" ? (
        <Field label="Interval (minutes)" htmlFor={id} error={error} help={`Minimum ${MIN_INTERVAL_MIN} minutes. Slots align to UTC.`}>
          <Input
            id={id}
            aria-invalid={!!error}
            className="max-w-48 font-mono"
            type="number"
            min={MIN_INTERVAL_MIN}
            step={1}
            value={value.everyMinutes ?? ""}
            onChange={(e) => onChange({ everyMinutes: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </Field>
      ) : (
        <Field label="Cron expression" htmlFor={id} error={error} help="minute hour day month weekday, in UTC. At most every 5 minutes.">
          <Input id={id} aria-invalid={!!error} className="max-w-xs font-mono" value={value.cron ?? ""} placeholder="0 * * * *" onChange={(e) => onChange({ cron: e.target.value })} />
        </Field>
      )}
      {preview.length > 0 && <p className="text-xs text-muted">Next: {preview.map((d) => dateTime(d)).join(" · ")}</p>}
    </div>
  );
}
