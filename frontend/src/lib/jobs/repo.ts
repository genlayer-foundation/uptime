// Data layer. `Repo` is the seam: Postgres in production (PgRepo, below),
// an in-memory twin in tests (test/memoryRepo.ts). Times are unix seconds at
// this boundary; the SQL stores timestamptz.

import type { Pool, PoolClient } from "pg";
import { getPool } from "./db";
import type { JobRow, JobState, NewJob, RunRow, RunState, StepRunRow } from "./internal";
import type { ScheduleRow } from "./schedule";
import type { Assertion, Network, Schedule, Step } from "./types";

export interface JobPatch {
  name?: string;
  schedule?: Schedule;
  steps?: Step[];
  assertions?: Assertion[];
  public?: boolean;
  state?: JobState;
  stateReason?: string | null;
  perRunCapWei?: string | null;
}

export interface NewRunRow {
  id: string;
  jobId: string;
  group: string;
  scheduledFor: number;
  state: RunState;
  cursor?: number;
  pass?: boolean | null;
  error?: string | null;
  meta?: Record<string, unknown>;
}

export interface RunPatch {
  state?: RunState;
  cursor?: number;
  pass?: boolean | null;
  error?: string | null;
}

export interface DueItem {
  job: JobRow;
  schedule: ScheduleRow;
}

export interface ChargeLine {
  runId: string;
  idx: number;
  jobId: string;
  poolId: string;
  // From `unsettled`: the step's recorded gas. `settle` replaces it with the
  // amount actually charged (pricing.runChargeWei on the fee line).
  amountWei: string;
  // The run's first transaction step: it also carries the run's flat fee.
  runFee?: boolean;
}

export interface LineOutcome {
  charged: boolean;
  reason?: string;
}

export const MAX_CHARGE_ATTEMPTS = 3;

export interface Repo {
  upsertUser(wallet: string): Promise<void>;
  createNonce(nonce: string): Promise<void>;
  consumeNonce(nonce: string, maxAgeSec: number): Promise<boolean>;

  createJob(j: NewJob): Promise<JobRow>;
  getJob(id: string): Promise<JobRow | null>;
  listJobs(owner: string): Promise<JobRow[]>;
  listPublicJobs(): Promise<JobRow[]>;
  listAllJobs(limit: number): Promise<JobRow[]>; // operators only
  countLiveJobs(owner: string, network: Network): Promise<number>;
  findSystemJob(network: Network, preset: string): Promise<JobRow | null>;
  updateJob(id: string, patch: JobPatch): Promise<JobRow | null>;
  replaceSchedules(id: string, schedules: ScheduleRow[]): Promise<void>;

  dueSchedules(nowSec: number, limit: number): Promise<DueItem[]>;
  // Optimistic claim: succeeds only if nextDueAt is still `expectedNext`, so two
  // overlapping dispatchers can never both take one slot.
  claimSlot(jobId: string, group: string, expectedNext: number, slot: number, next: number): Promise<boolean>;

  // null when (job, group, scheduledFor) already exists.
  createRun(r: NewRunRow): Promise<RunRow | null>;
  updateRun(id: string, p: RunPatch): Promise<void>;
  saveStepRun(runId: string, s: StepRunRow): Promise<void>;
  getRun(id: string): Promise<RunRow | null>;
  runningRuns(limit: number): Promise<RunRow[]>;
  listRuns(jobId: string, limit: number): Promise<RunRow[]>;
  lastDeployAddress(jobId: string, stepId: string): Promise<string | null>;
  // Finished runs in a row (newest first) with pass === false.
  consecutiveFailures(jobId: string): Promise<number>;

  // Decided Bradbury step runs not yet charged: every one with gas, plus (when
  // `feeLines`) each run's first transaction step even without gas, flagged
  // `runFee`, so the run's flat fee is charged exactly once.
  unsettled(network: Network, untilSec: number, maxLines: number, opts?: { feeLines?: boolean }): Promise<ChargeLine[]>;
  // Records the batch and returns its local id and the on-chain settlementId
  // (>= minOnchainId, strictly above every earlier one).
  recordSettlement(network: Network, untilSec: number, lines: ChargeLine[], minOnchainId: bigint): Promise<{ id: number; onchainId: bigint }>;
  finishSettlement(
    id: number,
    r: { ok: boolean; txHash: string | null; error: string | null; outcomes?: LineOutcome[]; chargedWei?: string; keepLocked?: boolean }
  ): Promise<void>;
}

// ---------------------------------------------------------------------------

const ts = (d: Date | null | undefined): number | null => (d ? Math.floor(d.getTime() / 1000) : null);
const at = (sec: number) => new Date(sec * 1000);
type Row = Record<string, unknown>;

function toSchedule(r: Row): ScheduleRow {
  return {
    action: r.grp as string,
    intervalSec: r.interval_sec == null ? null : Number(r.interval_sec),
    cron: (r.cron as string | null) ?? null,
    anchorAt: ts(r.anchor_at as Date)!,
    nextDueAt: ts(r.next_due_at as Date)!,
    lastSlotAt: ts(r.last_slot_at as Date | null),
  };
}

function toJobRow(r: Row, schedules: ScheduleRow[]): JobRow {
  return {
    id: String(r.id),
    owner: r.owner as string,
    name: r.name as string,
    network: r.network as Network,
    preset: (r.preset as string | null) ?? null,
    schedule: r.schedule as Schedule,
    steps: r.steps as Step[],
    assertions: (r.assertions as Assertion[]) ?? [],
    state: r.state as JobState,
    stateReason: (r.state_reason as string | null) ?? null,
    system: Boolean(r.system),
    public: Boolean(r.public),
    poolId: r.pool_id as string,
    perRunCapWei: r.per_run_cap_wei == null ? null : String(r.per_run_cap_wei),
    createdAt: ts(r.created_at as Date)!,
    updatedAt: ts(r.updated_at as Date)!,
    schedules,
  };
}

function toStepRun(r: Row): StepRunRow {
  const o: StepRunRow = {
    idx: Number(r.idx),
    stepId: r.step_id as string,
    kind: r.kind as StepRunRow["kind"],
    status: r.status as StepRunRow["status"],
    submittedAt: ts(r.submitted_at as Date | null),
    resolvedAt: ts(r.resolved_at as Date | null),
  };
  if (r.tx_hash) o.txHash = r.tx_hash as string;
  if (r.result !== null && r.result !== undefined) o.result = r.result;
  if (r.time_to_accepted_ms != null) o.timeToAcceptedMs = Number(r.time_to_accepted_ms);
  if (r.rounds != null) o.rounds = Number(r.rounds);
  if (r.votes) o.votes = r.votes as StepRunRow["votes"];
  if (r.gas_wei != null) o.gasWei = String(r.gas_wei);
  if (r.error) o.error = r.error as string;
  if (r.chain_status) o.chainStatus = r.chain_status as string;
  return o;
}

function toRun(r: Row, steps: StepRunRow[]): RunRow {
  return {
    id: String(r.id),
    jobId: String(r.job_id),
    group: r.grp as string,
    scheduledFor: ts(r.scheduled_for as Date)!,
    startedAt: ts(r.started_at as Date)!,
    state: r.state as RunState,
    cursor: Number(r.cursor),
    pass: (r.pass as boolean | null) ?? null,
    error: (r.error as string | null) ?? null,
    meta: (r.meta as Record<string, unknown>) ?? {},
    steps,
  };
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

async function insertSchedules(c: PoolClient, id: string, schedules: ScheduleRow[]) {
  for (const s of schedules) {
    await c.query(
      `INSERT INTO schedules (job_id, grp, interval_sec, cron, anchor_at, next_due_at, last_slot_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, s.action, s.intervalSec ?? null, s.cron ?? null, at(s.anchorAt), at(s.nextDueAt), s.lastSlotAt ? at(s.lastSlotAt) : null]
    );
  }
}

export class PgRepo implements Repo {
  constructor(private pool: Pool = getPool()) {}

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  private async jobsWithSchedules(rows: Row[]): Promise<JobRow[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => String(r.id));
    const s = await this.pool.query("SELECT * FROM schedules WHERE job_id = ANY($1) ORDER BY grp", [ids]);
    return rows.map((r) => toJobRow(r, s.rows.filter((x) => x.job_id === r.id).map(toSchedule)));
  }

  private async runsWithSteps(rows: Row[]): Promise<RunRow[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => String(r.id));
    const s = await this.pool.query("SELECT * FROM step_runs WHERE run_id = ANY($1) ORDER BY run_id, idx", [ids]);
    return rows.map((r) => toRun(r, s.rows.filter((x) => x.run_id === r.id).map(toStepRun)));
  }

  async upsertUser(wallet: string) {
    await this.pool.query(
      `INSERT INTO users (wallet, last_login) VALUES ($1, now())
       ON CONFLICT (wallet) DO UPDATE SET last_login = now()`,
      [wallet.toLowerCase()]
    );
  }

  async createNonce(nonce: string) {
    await this.pool.query("INSERT INTO auth_nonces (nonce) VALUES ($1)", [nonce]);
    await this.pool.query("DELETE FROM auth_nonces WHERE created_at < now() - interval '1 day'");
  }

  async consumeNonce(nonce: string, maxAgeSec: number) {
    const r = await this.pool.query(
      `UPDATE auth_nonces SET used_at = now()
       WHERE nonce = $1 AND used_at IS NULL AND created_at > now() - make_interval(secs => $2)
       RETURNING nonce`,
      [nonce, maxAgeSec]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async createJob(j: NewJob) {
    return this.tx(async (c) => {
      await c.query("INSERT INTO users (wallet) VALUES ($1) ON CONFLICT DO NOTHING", [j.owner]);
      const r = await c.query(
        `INSERT INTO jobs (owner, name, network, preset, schedule, steps, assertions, state, system, public, pool_id, per_run_cap_wei, id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [j.owner, j.name, j.network, j.preset, json(j.schedule), json(j.steps), json(j.assertions), j.state,
          j.system ?? false, j.public ?? false, j.poolId, j.perRunCapWei ?? null, j.id]
      );
      await insertSchedules(c, j.id, j.schedules);
      return toJobRow(r.rows[0], j.schedules);
    });
  }

  async getJob(id: string) {
    const r = await this.pool.query("SELECT * FROM jobs WHERE id = $1 AND state <> 'deleted'", [id]);
    return (await this.jobsWithSchedules(r.rows))[0] ?? null;
  }

  async listJobs(owner: string) {
    const r = await this.pool.query(
      "SELECT * FROM jobs WHERE owner = $1 AND state <> 'deleted' ORDER BY created_at DESC",
      [owner.toLowerCase()]
    );
    return this.jobsWithSchedules(r.rows);
  }

  async listPublicJobs() {
    const r = await this.pool.query("SELECT * FROM jobs WHERE public AND state <> 'deleted' ORDER BY system DESC, created_at");
    return this.jobsWithSchedules(r.rows);
  }

  async listAllJobs(limit: number) {
    const r = await this.pool.query("SELECT * FROM jobs WHERE state <> 'deleted' ORDER BY created_at DESC LIMIT $1", [limit]);
    return this.jobsWithSchedules(r.rows);
  }

  async countLiveJobs(owner: string, network: Network) {
    const r = await this.pool.query(
      "SELECT count(*)::int AS n FROM jobs WHERE owner = $1 AND network = $2 AND state <> 'deleted'",
      [owner.toLowerCase(), network]
    );
    return Number(r.rows[0].n);
  }

  async findSystemJob(network: Network, preset: string) {
    const r = await this.pool.query("SELECT * FROM jobs WHERE system AND network = $1 AND preset = $2", [network, preset]);
    return (await this.jobsWithSchedules(r.rows))[0] ?? null;
  }

  async updateJob(id: string, p: JobPatch) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (p.name !== undefined) add("name", p.name);
    if (p.schedule !== undefined) add("schedule", json(p.schedule));
    if (p.steps !== undefined) add("steps", json(p.steps));
    if (p.assertions !== undefined) add("assertions", json(p.assertions));
    if (p.public !== undefined) add("public", p.public);
    if (p.state !== undefined) add("state", p.state);
    if (p.stateReason !== undefined) add("state_reason", p.stateReason);
    if (p.perRunCapWei !== undefined) add("per_run_cap_wei", p.perRunCapWei);
    if (sets.length) {
      vals.push(id);
      await this.pool.query(`UPDATE jobs SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
    }
    const r = await this.pool.query("SELECT * FROM jobs WHERE id = $1", [id]);
    return (await this.jobsWithSchedules(r.rows))[0] ?? null;
  }

  async replaceSchedules(id: string, schedules: ScheduleRow[]) {
    await this.tx(async (c) => {
      await c.query("DELETE FROM schedules WHERE job_id = $1", [id]);
      await insertSchedules(c, id, schedules);
    });
  }

  async dueSchedules(nowSec: number, limit: number) {
    const r = await this.pool.query(
      `SELECT s.* FROM schedules s JOIN jobs j ON j.id = s.job_id
       WHERE j.state = 'active' AND s.next_due_at <= $1
       ORDER BY s.next_due_at LIMIT $2`,
      [at(nowSec), limit]
    );
    if (r.rows.length === 0) return [];
    const ids = [...new Set(r.rows.map((x) => String(x.job_id)))];
    const j = await this.pool.query("SELECT * FROM jobs WHERE id = ANY($1)", [ids]);
    const byId = new Map((await this.jobsWithSchedules(j.rows)).map((x) => [x.id, x]));
    return r.rows.map((row) => ({ job: byId.get(String(row.job_id))!, schedule: toSchedule(row) }));
  }

  async claimSlot(jobId: string, group: string, expectedNext: number, slot: number, next: number) {
    const r = await this.pool.query(
      `UPDATE schedules SET next_due_at = $5, last_slot_at = $4
       WHERE job_id = $1 AND grp = $2 AND next_due_at = $3`,
      [jobId, group, at(expectedNext), at(slot), at(Math.min(next, 253402300799))]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async createRun(n: NewRunRow) {
    const r = await this.pool.query(
      `INSERT INTO runs (job_id, grp, scheduled_for, state, cursor, pass, error, meta, id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (job_id, grp, scheduled_for) DO NOTHING RETURNING *`,
      [n.jobId, n.group, at(n.scheduledFor), n.state, n.cursor ?? 0, n.pass ?? null, n.error ?? null, json(n.meta ?? {}), n.id]
    );
    return r.rows[0] ? toRun(r.rows[0], []) : null;
  }

  async updateRun(id: string, p: RunPatch) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (p.state !== undefined) add("state", p.state);
    if (p.cursor !== undefined) add("cursor", p.cursor);
    if (p.pass !== undefined) add("pass", p.pass);
    if (p.error !== undefined) add("error", p.error);
    if (!sets.length) return;
    vals.push(id);
    await this.pool.query(`UPDATE runs SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
  }

  async saveStepRun(runId: string, s: StepRunRow) {
    const result = s.result === undefined ? null : JSON.stringify(s.result);
    const capped = result && result.length > 16_000 ? JSON.stringify({ truncated: result.slice(0, 16_000) }) : result;
    await this.pool.query(
      `INSERT INTO step_runs (run_id, idx, step_id, kind, status, chain_status, tx_hash, submitted_at, resolved_at,
                              result, time_to_accepted_ms, rounds, votes, gas_wei, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (run_id, idx) DO UPDATE SET
         status = $5, chain_status = $6, tx_hash = $7, submitted_at = $8, resolved_at = $9, result = $10,
         time_to_accepted_ms = $11, rounds = $12, votes = $13, gas_wei = $14, error = $15`,
      [runId, s.idx, s.stepId, s.kind, s.status, s.chainStatus ?? null, s.txHash ?? null,
        s.submittedAt ? at(s.submittedAt) : null, s.resolvedAt ? at(s.resolvedAt) : null, capped,
        s.timeToAcceptedMs ?? null, s.rounds ?? null, json(s.votes), s.gasWei ?? null, s.error ?? null]
    );
  }

  async getRun(id: string) {
    const r = await this.pool.query("SELECT * FROM runs WHERE id = $1", [id]);
    return (await this.runsWithSteps(r.rows))[0] ?? null;
  }

  async runningRuns(limit: number) {
    const r = await this.pool.query("SELECT * FROM runs WHERE state = 'RUNNING' ORDER BY started_at LIMIT $1", [limit]);
    return this.runsWithSteps(r.rows);
  }

  async listRuns(jobId: string, limit: number) {
    const r = await this.pool.query(
      "SELECT * FROM runs WHERE job_id = $1 ORDER BY scheduled_for DESC, started_at DESC LIMIT $2",
      [jobId, limit]
    );
    return this.runsWithSteps(r.rows);
  }

  async lastDeployAddress(jobId: string, stepId: string) {
    const r = await this.pool.query(
      `SELECT sr.result->>'address' AS address FROM step_runs sr JOIN runs r ON r.id = sr.run_id
       WHERE r.job_id = $1 AND sr.step_id = $2 AND sr.kind = 'deploy'
         AND sr.status IN ('ACCEPTED', 'FINALIZED') AND sr.result ? 'address'
       ORDER BY sr.resolved_at DESC NULLS LAST LIMIT 1`,
      [jobId, stepId]
    );
    return (r.rows[0]?.address as string | undefined) ?? null;
  }

  async consecutiveFailures(jobId: string) {
    const r = await this.pool.query(
      `SELECT count(*)::int AS n FROM runs
       WHERE job_id = $1 AND state = 'DONE' AND pass = false
         AND scheduled_for > coalesce((SELECT max(scheduled_for) FROM runs WHERE job_id = $1 AND state = 'DONE' AND pass), '-infinity')`,
      [jobId]
    );
    return Number(r.rows[0].n);
  }

  async unsettled(network: Network, untilSec: number, maxLines: number, opts: { feeLines?: boolean } = {}) {
    const r = await this.pool.query(
      `SELECT * FROM (
         SELECT sr.run_id, sr.idx, r.job_id, j.pool_id, coalesce(sr.gas_wei, 0)::text AS amount, sr.resolved_at,
                sr.settled_in, sr.charge_outcome, sr.charge_attempts, sr.gas_wei,
                sr.idx = (SELECT min(s2.idx) FROM step_runs s2 WHERE s2.run_id = sr.run_id AND s2.tx_hash IS NOT NULL) AS run_fee
         FROM step_runs sr JOIN runs r ON r.id = sr.run_id JOIN jobs j ON j.id = r.job_id
         WHERE j.network = $1 AND NOT j.system
       ) x
       WHERE x.settled_in IS NULL AND (x.gas_wei > 0 OR ($5 AND x.run_fee))
         AND x.charge_outcome IS DISTINCT FROM 'CHARGED' AND x.charge_attempts < $3
         AND x.resolved_at IS NOT NULL AND x.resolved_at < $2
       ORDER BY x.resolved_at LIMIT $4`,
      [network, at(untilSec), MAX_CHARGE_ATTEMPTS, maxLines, !!opts.feeLines]
    );
    return r.rows.map((x) => ({
      runId: String(x.run_id), idx: Number(x.idx), jobId: String(x.job_id), poolId: x.pool_id as string, amountWei: x.amount as string,
      runFee: x.run_fee === true,
    }));
  }

  async recordSettlement(network: Network, untilSec: number, lines: ChargeLine[], minOnchainId: bigint) {
    return this.tx(async (c) => {
      const total = lines.reduce((s, l) => s + BigInt(l.amountWei), BigInt(0));
      const prev = await c.query("SELECT coalesce(max(onchain_id), 0)::text AS m FROM settlements WHERE network = $1", [network]);
      const r = await c.query("INSERT INTO settlements (network, period_end, total_wei) VALUES ($1,$2,$3) RETURNING id", [
        network, at(untilSec), total.toString(),
      ]);
      const id = Number(r.rows[0].id);
      let onchainId = BigInt(prev.rows[0].m) + BigInt(1);
      if (onchainId < minOnchainId) onchainId = minOnchainId;
      await c.query("UPDATE settlements SET onchain_id = $2 WHERE id = $1", [id, onchainId.toString()]);
      let line = 0;
      for (const l of lines) {
        await c.query(
          "INSERT INTO settlement_lines (settlement_id, line, run_id, idx, job_id, amount_wei) VALUES ($1,$2,$3,$4,$5,$6)",
          [id, line++, l.runId, l.idx, l.jobId, l.amountWei]
        );
        await c.query("UPDATE step_runs SET settled_in = $1 WHERE run_id = $2 AND idx = $3", [id, l.runId, l.idx]);
      }
      return { id, onchainId };
    });
  }

  async finishSettlement(
    id: number,
    r: { ok: boolean; txHash: string | null; error: string | null; outcomes?: LineOutcome[]; chargedWei?: string; keepLocked?: boolean }
  ) {
    await this.tx(async (c) => {
      await c.query("UPDATE settlements SET status = $2, tx_hash = $3, error = $4, charged_wei = $5 WHERE id = $1", [
        id, r.ok ? "SENT" : "FAILED", r.txHash, r.error, r.chargedWei ?? null,
      ]);
      if (!r.ok) {
        // A sent tx with an unknown outcome keeps its lines locked (a human
        // checks the explorer); otherwise nothing moved: release them.
        if (r.keepLocked) return;
        await c.query("UPDATE step_runs SET settled_in = NULL WHERE settled_in = $1", [id]);
        return;
      }
      const lines = await c.query("SELECT line, run_id, idx FROM settlement_lines WHERE settlement_id = $1 ORDER BY line", [id]);
      for (const l of lines.rows) {
        const o = r.outcomes?.[Number(l.line)];
        if (o?.charged) {
          await c.query("UPDATE settlement_lines SET outcome = 'CHARGED' WHERE settlement_id = $1 AND line = $2", [id, l.line]);
          await c.query("UPDATE step_runs SET charge_outcome = 'CHARGED' WHERE run_id = $1 AND idx = $2", [l.run_id, l.idx]);
        } else {
          // Skipped (or no event seen): moved nothing. Retry later, a bounded number of times.
          const reason = o?.reason ?? "no event";
          await c.query("UPDATE settlement_lines SET outcome = 'SKIPPED', skip_reason = $3 WHERE settlement_id = $1 AND line = $2", [id, l.line, reason]);
          await c.query(
            `UPDATE step_runs SET settled_in = NULL, charge_attempts = charge_attempts + 1, charge_outcome = $3
             WHERE run_id = $1 AND idx = $2`,
            [l.run_id, l.idx, `SKIPPED:${reason}`]
          );
        }
      }
    });
  }
}

let repo: Repo | null = null;
export function getRepo(): Repo {
  repo ??= new PgRepo();
  return repo;
}
