"use client";

import { Trash2 } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { OPS } from "./assert";
import { assertionErrors, uid, type DraftAssertion, type DraftStep } from "./draft";

const GRID = "grid gap-2 sm:grid-cols-[1fr_1.2fr_0.8fr_1.2fr_auto] sm:items-start";

export function AssertionsEditor({
  assertions,
  steps,
  onChange,
  showErrors,
}: {
  assertions: DraftAssertion[];
  steps: DraftStep[];
  onChange: (a: DraftAssertion[]) => void;
  showErrors: boolean;
}) {
  const set = (i: number, patch: Partial<DraftAssertion>) => onChange(assertions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        A run passes when every step succeeded and every assertion holds on that step&apos;s recorded result. With no assertions, a run passes when every step is accepted.
        Paths are dot paths into the result (<code className="text-foreground">ok</code>, <code className="text-foreground">items.0.price</code>); leave empty to compare the
        whole result.
      </p>
      {assertions.length > 0 && (
        <div className={`${GRID} hidden sm:grid`} aria-hidden>
          <Label>Step</Label>
          <Label>Path</Label>
          <Label>Op</Label>
          <Label>Expected (JSON)</Label>
          <span className="w-8" />
        </div>
      )}
      {assertions.map((a, i) => {
        const err = showErrors ? assertionErrors(a, steps) : null;
        return (
          <div key={a.uid} className="grid gap-1.5">
            <div className={GRID}>
              <Select value={a.step} onChange={(e) => set(i, { step: e.target.value })} aria-label="Step" aria-invalid={!!err}>
                <option value="">step…</option>
                {steps.map((s) => (
                  <option key={s.uid} value={s.id}>
                    {s.id} ({s.kind})
                  </option>
                ))}
              </Select>
              <Input className="font-mono" value={a.path} placeholder="ok" onChange={(e) => set(i, { path: e.target.value })} aria-label="Path" />
              <Select value={a.op} onChange={(e) => set(i, { op: e.target.value as DraftAssertion["op"] })} aria-label="Operator">
                {OPS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Input
                className="font-mono"
                value={a.op === "exists" ? "" : a.expectedText}
                disabled={a.op === "exists"}
                placeholder={a.op === "exists" ? "—" : 'true, 200, "ok"'}
                onChange={(e) => set(i, { expectedText: e.target.value })}
                aria-label="Expected value"
              />
              <Button size="sm" variant="ghost" className="h-10" onClick={() => onChange(assertions.filter((_, j) => j !== i))} aria-label="Remove assertion">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {err && <p className="text-xs text-danger-fg">{err}</p>}
          </div>
        );
      })}
      <div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange([...assertions, { uid: uid(), step: steps[steps.length - 1]?.id ?? "", path: "", op: "eq", expectedText: "" }])}
        >
          + Add assertion
        </Button>
      </div>
    </div>
  );
}
