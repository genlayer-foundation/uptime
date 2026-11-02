// Bounce sweep: an OUTBOUND poll of the provider's suppression list (hard
// bounces, spam complaints, provider-side unsubscribes), merged into ours.
// Cron only, CRON_SECRET, fail closed. Not scheduled in vercel.json yet.
import { authorized } from "@/lib/heartbeat/auth";
import { depsOr503, json } from "@/lib/mailer/http";
import { sweepBounces } from "@/lib/mailer/recipients";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
  const deps = depsOr503();
  if (deps instanceof Response) return deps;
  try {
    return json(await sweepBounces(deps));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "sweep failed" }, 502);
  }
}
