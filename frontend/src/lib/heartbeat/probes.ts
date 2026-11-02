// The Bradbury Heartbeat probe catalogue: ids, test types and how consensus is
// reached. NO answers here: prompts and the answer key live on-chain in
// contracts/heartbeat.py, which grades every probe itself. This file must list
// the same ids, types and equivalences in the same order as the contract's
// get_probe_set() (test/direct/test_heartbeat.py fails on drift). The rotating
// pool's ORDER is the rotation order.

export type TestType = "deploy" | "write" | "llm" | "web" | "image";
export type Equivalence = "none" | "strict_eq" | "comparative" | "non_comparative" | "custom";

export interface ProbeDef {
  id: string;
  type: TestType;
  eq: Equivalence;
  title: string;
  note: string;
}

// Every tick, alongside the canary deploy and the bump write.
export const F0: ProbeDef = { id: "f0-status", type: "web", eq: "strict_eq", title: "Status fetch", note: "web.get of a JSON fixture, no LLM: the plumbing control" };

// The rotating pool: 2 per tick, each probe every 4.5 hours.
export const POOL: ProbeDef[] = [
  { id: "r1-extract", type: "web", eq: "strict_eq", title: "Extract a fact", note: "Rendered primer page with nav and decoy numbers" },
  { id: "r2-answer42", type: "llm", eq: "strict_eq", title: "Constrained answer", note: "Closed-book, number only" },
  { id: "r3-laws", type: "llm", eq: "comparative", title: "Laws of Robotics", note: "Closed-book, open-ended, same meaning" },
  { id: "r4-rule", type: "llm", eq: "comparative", title: "Supervise an agent", note: "Does an action log follow its mandate?" },
  { id: "r5-summary", type: "llm", eq: "non_comparative", title: "Summary", note: "Graded on form: 40 words, validators and appeals" },
  { id: "r6-injection", type: "web", eq: "custom", title: "Untrusted page", note: "A hidden line asks for a different answer" },
  { id: "r7-card", type: "image", eq: "strict_eq", title: "Read an image", note: "A number that exists only in card.png" },
  { id: "r8-shot", type: "image", eq: "custom", title: "Read a screenshot", note: "A word drawn as SVG strokes, never DOM text" },
  { id: "r9-namesake", type: "llm", eq: "comparative", title: "Namesake", note: "Closed-book, same novel" },
];

export const PROBE_SET: ProbeDef[] = [F0, ...POOL];

export const ROTATING_PER_TICK = 2;
export const APPEAL_EVERY = 5;

export const TEST_TYPES: Array<{ type: TestType; label: string; note: string }> = [
  { type: "deploy", label: "Deploy", note: "A fresh canary contract every tick" },
  { type: "write", label: "Write", note: "bump(tick): a plain state write, no web, no LLM" },
  { type: "llm", label: "LLM", note: "Closed-book and page-based model answers" },
  { type: "web", label: "Web", note: "Fetching and rendering pages, incl. the no-LLM control" },
  { type: "image", label: "Image", note: "Vision: image bytes and rendered screenshots" },
];

export function probeDef(id: string | undefined): ProbeDef | undefined {
  return PROBE_SET.find((p) => p.id === id);
}

// The rotating probes a tick submits: indices ((tick-1)*2 + i) mod 9.
export function rotation(tick: number): ProbeDef[] {
  return Array.from({ length: ROTATING_PER_TICK }, (_, i) => POOL[((tick - 1) * ROTATING_PER_TICK + i) % POOL.length]);
}

// Every 5th tick appeals the tick's FIRST rotating probe, whatever its status.
// Its index is (2*5m - 2) mod 9 = (m - 2) mod 9 for the m-th appeal, so every
// probe is appealed once every 45 ticks. (An every-6th rule would only ever
// reach 3 of the 9.)
export function appealDue(tick: number, i: number): boolean {
  return i === 0 && tick % APPEAL_EVERY === 0;
}
