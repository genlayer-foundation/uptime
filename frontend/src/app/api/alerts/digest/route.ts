// Daily digest: one summary email per recipient per UTC day for every job whose
// owner turned the digest on. Cron only, CRON_SECRET, fail closed. Idempotent:
// a second call on the same UTC day sends nothing (claim key per job/day/recipient).
// Needs the backend's `digestSource` wiring (configureMailer); 503 without it.
// Scheduled daily at 08:00 UTC (vercel.json).
import { authorized } from "@/lib/heartbeat/auth";
import { depsOr503, json } from "@/lib/mailer/http";
import { sendDigestWith } from "@/lib/mailer/policy";
import { digestSourceLookup } from "@/lib/mailer/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
  const deps = depsOr503();
  if (deps instanceof Response) return deps;
  const source = digestSourceLookup();
  if (!source) return json({ error: "email alerts are not enabled" }, 503);
  const since = new Date(deps.now().getTime() - 24 * 3600_000);
  const counts: Record<string, number> = {};
  try {
    for (const rule of await deps.repo.listDigestRules()) {
      const got = await source(rule.jobId, since);
      const status = got ? (await sendDigestWith(deps, got.job, got.runs)).status : "job_missing";
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return json({ jobs: counts });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "digest failed" }, 502);
  }
}
