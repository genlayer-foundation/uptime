"use client";

import { useId } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Badge, Button, Field, Input, Segmented, Select, Textarea } from "@/components/ui";
import type { Step } from "@/lib/jobs/types";
import { DEPLOY_PRESETS, blankStep, stepErrors, type DraftStep } from "./draft";
import { ScheduleInput } from "./ScheduleInput";

const KINDS: { value: Step["kind"]; label: string; help: string }[] = [
  { value: "write", label: "Write", help: "Call an Intelligent Contract method. A transaction: the Uptime relayer sends it and GenLayer validators reach consensus on it." },
  { value: "deploy", label: "Deploy", help: "Deploy an Intelligent Contract. Later steps can call it as $<id>.address." },
  { value: "read", label: "Read", help: "Read an Intelligent Contract view. No transaction, no fee." },
];

function StepCard({
  d,
  idx,
  all,
  showErrors,
  onChange,
  onRemove,
  onMove,
}: {
  d: DraftStep;
  idx: number;
  all: DraftStep[];
  showErrors: boolean;
  onChange: (d: DraftStep) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const uid = useId();
  const errs = showErrors ? stepErrors(d, all) : {};
  const set = <K extends keyof DraftStep>(k: K, v: DraftStep[K]) => onChange({ ...d, [k]: v });
  const deploys = all.slice(0, idx).filter((s) => s.kind === "deploy");
  const f = (name: string) => `${uid}-${name}`;
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-muted">#{idx + 1}</span>
        <Segmented label="Step kind" value={d.kind} options={KINDS} onChange={(k) => set("kind", k)} />
        {d.ownSchedule && <Badge tone="purple">own schedule</Badge>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => onMove(-1)} disabled={idx === 0} aria-label="Move step up">
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onMove(1)} disabled={idx === all.length - 1} aria-label="Move step down">
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove} disabled={all.length === 1} aria-label="Remove step">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-xs text-muted">{KINDS.find((k) => k.value === d.kind)?.help}</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Step id" htmlFor={f("id")} error={errs.id} help="Used by assertions and $id.address">
          <Input id={f("id")} aria-invalid={!!errs.id} className="font-mono" value={d.id} onChange={(e) => set("id", e.target.value)} />
        </Field>
        {d.kind !== "deploy" ? (
          <>
            <Field label="Intelligent Contract" htmlFor={f("contract")} error={errs.contract} help={deploys.length ? `0x… or $${deploys[deploys.length - 1].id}.address` : "0x… address"}>
              <Input
                id={f("contract")}
                aria-invalid={!!errs.contract}
                className="font-mono"
                value={d.contract}
                list={f("refs")}
                placeholder="0x…"
                onChange={(e) => set("contract", e.target.value)}
              />
              <datalist id={f("refs")}>
                {deploys.map((s) => (
                  <option key={s.uid} value={`$${s.id}.address`} />
                ))}
              </datalist>
            </Field>
            <Field label="Method" htmlFor={f("method")} error={errs.method}>
              <Input id={f("method")} aria-invalid={!!errs.method} className="font-mono" value={d.method} placeholder="check_url" onChange={(e) => set("method", e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Source" htmlFor={f("src")}>
              <Select id={f("src")} value={d.deploySource} onChange={(e) => set("deploySource", e.target.value as DraftStep["deploySource"])}>
                <option value="preset">An Intelligent Contract we host</option>
                <option value="code">Paste source</option>
              </Select>
            </Field>
            {d.deploySource === "preset" && (
              <Field label="Intelligent Contract" htmlFor={f("preset")}>
                <Select id={f("preset")} value={d.preset} onChange={(e) => set("preset", e.target.value)}>
                  {DEPLOY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}
      </div>

      {d.kind === "deploy" && d.deploySource === "code" && (
        <Field label="Intelligent Contract source (Python)" htmlFor={f("code")} error={errs.code} help="Pinned by hash when the job is created.">
          <Textarea id={f("code")} aria-invalid={!!errs.code} rows={8} value={d.code} onChange={(e) => set("code", e.target.value)} />
        </Field>
      )}

      <div className={d.kind === "write" ? "grid gap-4 sm:grid-cols-[2fr_1fr]" : "grid gap-4"}>
        <Field
          label={d.kind === "deploy" ? "Constructor args (JSON array)" : "Args (JSON array)"}
          htmlFor={f("args")}
          error={errs.args}
          help="Placeholders in strings: {{job_id}} {{run_id}} {{slot}} {{relayer}}"
        >
          <Textarea id={f("args")} aria-invalid={!!errs.args} className="min-h-16" rows={2} value={d.argsText} onChange={(e) => set("argsText", e.target.value)} />
        </Field>
        {d.kind === "write" && (
          <Field label="Value (GEN, optional)" htmlFor={f("value")} error={errs.value} help="Sent with the call; charged to the pool.">
            <Input id={f("value")} aria-invalid={!!errs.value} className="font-mono" value={d.value} placeholder="0" onChange={(e) => set("value", e.target.value)} />
          </Field>
        )}
      </div>

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input type="checkbox" className="accent-purple" checked={d.ownSchedule} onChange={(e) => set("ownSchedule", e.target.checked)} />
        Run this step on its own schedule
      </label>
      {d.ownSchedule && <ScheduleInput value={d.schedule} onChange={(s) => set("schedule", s)} compact />}
    </div>
  );
}

export function StepsEditor({ steps, onChange, showErrors }: { steps: DraftStep[]; onChange: (s: DraftStep[]) => void; showErrors: boolean }) {
  const update = (i: number, d: DraftStep) => onChange(steps.map((s, j) => (j === i ? d : s)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...steps];
    const [x] = next.splice(i, 1);
    next.splice(i + dir, 0, x);
    onChange(next);
  };
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        Steps run in order each slot; a failed step stops the run. Chain a deploy into later steps with <code className="text-foreground">$&lt;stepId&gt;.address</code>:
        the Intelligent Contract that deploy created in the same run, else in its latest accepted run.
      </p>
      {steps.map((d, i) => (
        <StepCard
          key={d.uid}
          d={d}
          idx={i}
          all={steps}
          showErrors={showErrors}
          onChange={(x) => update(i, x)}
          onRemove={() => onChange(steps.filter((_, j) => j !== i))}
          onMove={(dir) => move(i, dir)}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Add step:</span>
        {KINDS.map((k) => (
          <Button key={k.value} size="sm" variant="secondary" onClick={() => onChange([...steps, blankStep(k.value, steps)])}>
            + {k.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
