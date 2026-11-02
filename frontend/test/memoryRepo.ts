// In-memory Repo for unit tests: same contract as PgRepo, no database.
import type { JobRow, NewJob, RunRow, StepRunRow } from "@/lib/jobs/internal";
import {
  MAX_CHARGE_ATTEMPTS,
  type ChargeLine,
  type DueItem,
  type JobPatch,
  type LineOutcome,
  type NewRunRow,
  type Repo,
  type RunPatch,
} from "@/lib/jobs/repo";
import type { ScheduleRow } from "@/lib/jobs/schedule";
import type { Network } from "@/lib/jobs/types";

type Billing = { settledIn?: number; attempts: number; outcome?: string };

export class MemoryRepo implements Repo {
  jobs = new Map<string, JobRow>();
  runs: RunRow[] = [];
  billing = new Map<string, Billing>();
  private order = new Map<string, number>();
  nonces = new Map<string, { at: number; used: boolean }>();
  users = new Set<string>();
  settlements: { id: number; onchainId: bigint; lines: ChargeLine[]; ok?: boolean; keepLocked?: boolean }[] = [];
  private runSeq = 0; // tie-break for runs started in the same second
  constructor(private now: () => number = () => Math.floor(Date.now() / 1000)) {}

  private clone<T>(x: T): T {
    return structuredClone(x);
  }

  async upsertUser(w: string) {
    this.users.add(w.toLowerCase());
  }
  async createNonce(n: string) {
    this.nonces.set(n, { at: this.now(), used: false });
  }
  async consumeNonce(n: string, maxAge: number) {
    const x = this.nonces.get(n);
    if (!x || x.used || this.now() - x.at > maxAge) return false;
    x.used = true;
    return true;
  }
  async createJob(j: NewJob) {
    const t = this.now();
    const row: JobRow = {
      id: j.id, owner: j.owner, name: j.name, network: j.network, preset: j.preset, schedule: j.schedule, steps: j.steps,
      assertions: j.assertions, state: j.state, stateReason: null, system: !!j.system, public: !!j.public, poolId: j.poolId,
      perRunCapWei: j.perRunCapWei ?? null, createdAt: t, updatedAt: t, schedules: this.clone(j.schedules),
    };
    this.jobs.set(j.id, row);
    return this.clone(row);
  }
  async getJob(id: string) {
    const j = this.jobs.get(id);
    return j && j.state !== "deleted" ? this.clone(j) : null;
  }
  async listJobs(owner: string) {
    return [...this.jobs.values()].filter((j) => j.owner === owner && j.state !== "deleted").map((j) => this.clone(j));
  }
  async listPublicJobs() {
    return [...this.jobs.values()].filter((j) => j.public && j.state !== "deleted").map((j) => this.clone(j));
  }
  async listAllJobs(limit: number) {
    return [...this.jobs.values()].filter((j) => j.state !== "deleted").slice(0, limit).map((j) => this.clone(j));
  }
  async countLiveJobs(owner: string, n: Network) {
    return [...this.jobs.values()].filter((j) => j.owner === owner && j.network === n && j.state !== "deleted").length;
  }
  async findSystemJob(n: Network, preset: string) {
    const j = [...this.jobs.values()].find((x) => x.system && x.network === n && x.preset === preset);
    return j ? this.clone(j) : null;
  }
  async updateJob(id: string, p: JobPatch) {
    const j = this.jobs.get(id);
    if (!j) return null;
    for (const [k, v] of Object.entries(p)) if (v !== undefined) (j as unknown as Record<string, unknown>)[k] = this.clone(v);
    j.updatedAt = this.now();
    return this.clone(j);
  }
  async replaceSchedules(id: string, s: ScheduleRow[]) {
    this.jobs.get(id)!.schedules = this.clone(s);
  }
  async dueSchedules(now: number, limit: number) {
    const out: DueItem[] = [];
    for (const j of this.jobs.values()) {
      if (j.state !== "active") continue;
      for (const s of j.schedules) if (s.nextDueAt <= now) out.push({ job: this.clone(j), schedule: { ...s } });
    }
    return out.sort((a, b) => a.schedule.nextDueAt - b.schedule.nextDueAt).slice(0, limit);
  }
  async claimSlot(id: string, group: string, expected: number, slot: number, next: number) {
    const s = this.jobs.get(id)?.schedules.find((x) => x.action === group);
    if (!s || s.nextDueAt !== expected) return false;
    s.nextDueAt = next;
    s.lastSlotAt = slot;
    return true;
  }
  async createRun(n: NewRunRow) {
    if (this.runs.some((r) => r.jobId === n.jobId && r.group === n.group && r.scheduledFor === n.scheduledFor)) return null;
    const r: RunRow = {
      id: n.id, jobId: n.jobId, group: n.group, scheduledFor: n.scheduledFor, startedAt: this.now(), state: n.state,
      cursor: n.cursor ?? 0, pass: n.pass ?? null, error: n.error ?? null, meta: n.meta ?? {}, steps: [],
    };
    this.runs.push(r);
    this.order.set(r.id, ++this.runSeq);
    return this.clone(r);
  }
  async updateRun(id: string, p: RunPatch) {
    const r = this.runs.find((x) => x.id === id)!;
    for (const [k, v] of Object.entries(p)) if (v !== undefined) (r as unknown as Record<string, unknown>)[k] = v;
  }
  async saveStepRun(runId: string, s: StepRunRow) {
    const r = this.runs.find((x) => x.id === runId)!;
    const i = r.steps.findIndex((x) => x.idx === s.idx);
    if (i >= 0) r.steps[i] = this.clone(s);
    else r.steps.push(this.clone(s));
    r.steps.sort((a, b) => a.idx - b.idx);
  }
  async getRun(id: string) {
    const r = this.runs.find((x) => x.id === id);
    return r ? this.clone(r) : null;
  }
  async runningRuns(limit: number) {
    return this.runs.filter((r) => r.state === "RUNNING").slice(0, limit).map((r) => this.clone(r));
  }
  async listRuns(jobId: string, limit: number) {
    return this.runs
      .filter((r) => r.jobId === jobId)
      .sort((a, b) => b.scheduledFor - a.scheduledFor || this.order.get(b.id)! - this.order.get(a.id)!)
      .slice(0, limit)
      .map((r) => this.clone(r));
  }
  async lastDeployAddress(jobId: string, stepId: string) {
    const cands = this.runs
      .filter((r) => r.jobId === jobId)
      .flatMap((r) => r.steps)
      .filter((s) => s.stepId === stepId && s.kind === "deploy" && (s.status === "ACCEPTED" || s.status === "FINALIZED"))
      .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
    return ((cands[0]?.result as { address?: string } | undefined)?.address as string | undefined) ?? null;
  }
  async consecutiveFailures(jobId: string) {
    const done = this.runs.filter((r) => r.jobId === jobId && r.state === "DONE").sort((a, b) => b.scheduledFor - a.scheduledFor);
    let n = 0;
    for (const r of done) {
      if (r.pass) break;
      if (r.pass === false) n++;
    }
    return n;
  }
  private bill(runId: string, idx: number): Billing {
    const k = `${runId}:${idx}`;
    if (!this.billing.has(k)) this.billing.set(k, { attempts: 0 });
    return this.billing.get(k)!;
  }
  async unsettled(n: Network, until: number, max: number, opts: { feeLines?: boolean } = {}) {
    const out: ChargeLine[] = [];
    for (const r of this.runs) {
      const j = this.jobs.get(r.jobId)!;
      if (j.network !== n || j.system) continue;
      const txIdx = r.steps.filter((s) => s.txHash).map((s) => s.idx);
      const feeIdx = txIdx.length ? Math.min(...txIdx) : null;
      for (const s of r.steps) {
        const b = this.bill(r.id, s.idx);
        const gas = s.gasWei ? BigInt(s.gasWei) : BigInt(0);
        const runFee = s.idx === feeIdx;
        if (!(gas > BigInt(0) || (opts.feeLines && runFee))) continue;
        if (b.settledIn || b.outcome === "CHARGED" || b.attempts >= MAX_CHARGE_ATTEMPTS) continue;
        if (s.resolvedAt === null || s.resolvedAt >= until) continue;
        out.push({ runId: r.id, idx: s.idx, jobId: j.id, poolId: j.poolId, amountWei: gas.toString(), runFee });
      }
    }
    return out.slice(0, max);
  }
  async recordSettlement(_n: Network, _u: number, lines: ChargeLine[], min: bigint) {
    const id = this.settlements.length + 1;
    const prev = this.settlements.at(-1)?.onchainId ?? BigInt(0);
    const onchainId = prev + BigInt(1) > min ? prev + BigInt(1) : min;
    this.settlements.push({ id, onchainId, lines });
    for (const l of lines) this.bill(l.runId, l.idx).settledIn = id;
    return { id, onchainId };
  }
  async finishSettlement(id: number, r: { ok: boolean; outcomes?: LineOutcome[]; keepLocked?: boolean }) {
    const s = this.settlements[id - 1];
    s.ok = r.ok;
    s.keepLocked = r.keepLocked;
    if (!r.ok) {
      if (!r.keepLocked) for (const l of s.lines) delete this.bill(l.runId, l.idx).settledIn;
      return;
    }
    s.lines.forEach((l, i) => {
      const b = this.bill(l.runId, l.idx);
      if (r.outcomes?.[i]?.charged) b.outcome = "CHARGED";
      else {
        delete b.settledIn;
        b.attempts++;
        b.outcome = `SKIPPED:${r.outcomes?.[i]?.reason ?? "no event"}`;
      }
    });
  }
}
