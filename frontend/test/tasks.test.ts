// The home page cards and the wizard's first screen come from ONE task list;
// every task must open a template that exists on both networks.
import { describe, expect, it } from "vitest";
import { SHOWCASE, TASKS, taskById } from "@/components/jobs/tasks";
import { templates } from "@/lib/jobs/presets";

describe("tasks", () => {
  it("every task opens an existing template, never the Heartbeat", () => {
    for (const n of ["bradbury", "studio"] as const) {
      const ids = templates(n).map((t) => t.preset);
      for (const t of TASKS) expect(ids).toContain(t.preset);
    }
    expect(TASKS.map((t) => t.preset)).not.toContain("heartbeat");
  });

  it("every home card links to a task", () => {
    for (const c of SHOWCASE) expect(taskById(c.task)).toBeDefined();
  });
});
