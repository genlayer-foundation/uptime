// Postgres AlertsRepo for the mailer (lib/mailer/repo.ts), over the tables in
// migrations/010_alerts.sql. Semantics follow lib/mailer/memoryRepo.ts, the
// mailer's reference implementation.

import type { Pool } from "pg";
import type { AlertsRepo, EmailFilter } from "@/lib/mailer/repo";
import { COUNTED_OUTCOMES, type AlertRule, type EmailRow, type Recipient } from "@/lib/mailer/types";

type Row = Record<string, unknown>;
const d = (v: unknown) => (v ? new Date(v as string | Date) : null);

function toRecipient(r: Row): Recipient {
  return {
    id: Number(r.id),
    ownerWallet: r.owner_wallet as string,
    email: r.email as string,
    createdAt: d(r.created_at)!,
    verificationSentAt: d(r.verification_sent_at),
    verifiedAt: d(r.verified_at),
    removedAt: d(r.removed_at),
  };
}

function toEmail(r: Row): EmailRow {
  return {
    id: Number(r.id),
    claimKey: r.claim_key as string,
    kind: r.kind as EmailRow["kind"],
    jobId: (r.job_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    recipientId: r.recipient_id == null ? null : Number(r.recipient_id),
    email: r.email as string,
    ownerWallet: r.owner_wallet as string,
    network: (r.network as EmailRow["network"]) ?? null,
    outcome: r.outcome as EmailRow["outcome"],
    reason: (r.reason as string | null) ?? null,
    priceWei: r.price_wei == null ? null : String(r.price_wei),
    chargeTx: (r.charge_tx as string | null) ?? null,
    providerMessageId: (r.provider_message_id as string | null) ?? null,
    createdAt: d(r.created_at)!,
  };
}

function where(f: EmailFilter): { sql: string; vals: unknown[] } {
  const vals: unknown[] = [f.since, [...(f.outcomes ?? COUNTED_OUTCOMES)]];
  const parts = ["created_at >= $1", "outcome = ANY($2)"];
  const add = (col: string, v: unknown, op = "=") => {
    vals.push(v);
    parts.push(`${col} ${op} $${vals.length}`);
  };
  if (f.kind !== undefined) add("kind", f.kind);
  if (f.jobId !== undefined) add("job_id", f.jobId);
  if (f.email !== undefined) add("email", f.email);
  if (f.ownerWallet !== undefined) add("owner_wallet", f.ownerWallet);
  if (f.network !== undefined) add("network", f.network);
  if (f.excludeRunId !== undefined) add("run_id", f.excludeRunId, "IS DISTINCT FROM");
  return { sql: parts.join(" AND "), vals };
}

export function pgAlertsRepo(pool: Pool): AlertsRepo {
  return {
    async listRecipients(wallet) {
      const r = await pool.query("SELECT * FROM alert_recipients WHERE owner_wallet = $1 AND removed_at IS NULL ORDER BY id", [wallet]);
      return r.rows.map(toRecipient);
    },
    async getRecipient(id) {
      const r = await pool.query("SELECT * FROM alert_recipients WHERE id = $1", [id]);
      return r.rows[0] ? toRecipient(r.rows[0]) : null;
    },
    async upsertRecipient(wallet, email, now) {
      const ins = await pool.query(
        `INSERT INTO alert_recipients (owner_wallet, email, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (owner_wallet, email) WHERE removed_at IS NULL DO NOTHING RETURNING *`,
        [wallet, email, now]
      );
      if (ins.rows[0]) return { recipient: toRecipient(ins.rows[0]), created: true };
      const r = await pool.query(
        "SELECT * FROM alert_recipients WHERE owner_wallet = $1 AND email = $2 AND removed_at IS NULL",
        [wallet, email]
      );
      return { recipient: toRecipient(r.rows[0]), created: false };
    },
    async markVerificationSent(id, now) {
      await pool.query("UPDATE alert_recipients SET verification_sent_at = $2 WHERE id = $1", [id, now]);
    },
    async confirmRecipient(id, now) {
      const r = await pool.query(
        "UPDATE alert_recipients SET verified_at = coalesce(verified_at, $2) WHERE id = $1 AND removed_at IS NULL RETURNING id",
        [id, now]
      );
      return (r.rowCount ?? 0) > 0;
    },
    async removeRecipient(id, wallet, now) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await c.query(
          "UPDATE alert_recipients SET removed_at = $3 WHERE id = $1 AND owner_wallet = $2 AND removed_at IS NULL RETURNING id",
          [id, wallet, now]
        );
        if ((r.rowCount ?? 0) > 0) {
          await c.query("UPDATE alert_rules SET recipient_ids = array_remove(recipient_ids, $1::bigint) WHERE $1::bigint = ANY(recipient_ids)", [id]);
        }
        await c.query("COMMIT");
        return (r.rowCount ?? 0) > 0;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },

    async isSuppressed(email) {
      const r = await pool.query("SELECT 1 FROM alert_suppressions WHERE email = $1", [email]);
      return (r.rowCount ?? 0) > 0;
    },
    async suppress(email, reason, detail, now) {
      const r = await pool.query(
        "INSERT INTO alert_suppressions (email, reason, detail, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING email",
        [email, reason, detail, now]
      );
      return (r.rowCount ?? 0) > 0;
    },

    async getRule(jobId) {
      const r = await pool.query("SELECT * FROM alert_rules WHERE job_id = $1", [jobId]);
      const x = r.rows[0];
      if (!x) return null;
      const rule: AlertRule = {
        jobId: x.job_id,
        ownerWallet: x.owner_wallet,
        enabled: x.enabled,
        failAfter: Number(x.fail_after),
        recipientIds: (x.recipient_ids as unknown[]).map(Number),
      };
      return rule;
    },
    async setRule(rule, now) {
      await pool.query(
        `INSERT INTO alert_rules (job_id, owner_wallet, enabled, fail_after, recipient_ids, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (job_id) DO UPDATE SET owner_wallet = $2, enabled = $3, fail_after = $4, recipient_ids = $5, updated_at = $6`,
        [rule.jobId, rule.ownerWallet, rule.enabled, rule.failAfter, rule.recipientIds, now]
      );
    },

    async claimEmail(c, now) {
      const r = await pool.query(
        `INSERT INTO alert_emails (claim_key, kind, job_id, run_id, recipient_id, email, owner_wallet, network,
                                   outcome, reason, price_wei, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
         ON CONFLICT (claim_key) DO NOTHING RETURNING *`,
        [c.claimKey, c.kind, c.jobId, c.runId, c.recipientId, c.email, c.ownerWallet, c.network,
          c.outcome ?? "queued", c.reason ?? null, c.priceWei, now]
      );
      return r.rows[0] ? toEmail(r.rows[0]) : null;
    },
    async finishEmail(id, patch, now) {
      const sets = ["outcome = $2", "updated_at = $3"];
      const vals: unknown[] = [id, patch.outcome, now];
      const add = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (patch.reason !== undefined) add("reason", patch.reason);
      if (patch.chargeTx !== undefined) add("charge_tx", patch.chargeTx);
      if (patch.providerMessageId !== undefined) add("provider_message_id", patch.providerMessageId);
      await pool.query(`UPDATE alert_emails SET ${sets.join(", ")} WHERE id = $1`, vals);
    },
    async countEmails(f) {
      const w = where(f);
      const r = await pool.query(`SELECT count(*)::int AS n FROM alert_emails WHERE ${w.sql}`, w.vals);
      return Number(r.rows[0].n);
    },
    async lastEmailAt(f) {
      const w = where(f);
      const r = await pool.query(`SELECT max(created_at) AS t FROM alert_emails WHERE ${w.sql}`, w.vals);
      return d(r.rows[0].t);
    },
  };
}
