// Which of the owner's CONFIRMED addresses get this job's failure alerts.
// Ownership comes from the backend's job lookup (configureMailer `jobOwner`);
// without it the route answers 503.
import { setJobRule } from "@/lib/mailer/recipients";
import { depsOr503, json, readJson } from "@/lib/mailer/http";
import { jobOwnerLookup } from "@/lib/mailer/runtime";
import { sessionWallet } from "@/lib/mailer/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

async function resolve(request: Request, ctx: Ctx) {
  const deps = depsOr503();
  if (deps instanceof Response) return deps;
  const lookup = jobOwnerLookup();
  if (!lookup) return json({ error: "email alerts are not enabled" }, 503);
  const wallet = sessionWallet(request);
  if (!wallet) return json({ error: "not signed in" }, 401);
  const jobId = (await ctx.params).jobId;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) return json({ error: "job not found" }, 404);
  return { deps, wallet, jobId, owner: await lookup(jobId) };
}

export async function GET(request: Request, ctx: Ctx) {
  const o = await resolve(request, ctx);
  if (o instanceof Response) return o;
  if (!o.owner || o.owner.toLowerCase() !== o.wallet) return json({ error: "job not found" }, 404);
  const rule = await o.deps.repo.getRule(o.jobId);
  return json({ rule: rule ?? { jobId: o.jobId, enabled: false, failAfter: 1, recipientIds: [] } });
}

export async function PUT(request: Request, ctx: Ctx) {
  const o = await resolve(request, ctx);
  if (o instanceof Response) return o;
  const body = await readJson(request);
  if (!body) return json({ error: "expected a JSON body" }, 400);
  const res = await setJobRule(o.deps, o.wallet, o.owner, o.jobId, body);
  return res.ok ? json({ rule: res.value }) : json({ error: res.error }, res.status);
}
