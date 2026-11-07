// One-click unsubscribe (RFC 8058: mail clients POST here directly). It can do
// exactly one thing: put that address on the suppression list. The answer is
// identical for a valid token, an invalid one and an unknown address, so the
// route is not a membership oracle. GET shows a button, so a link scanner's
// prefetch never unsubscribes anybody.
import { unsubscribe } from "@/lib/mailer/recipients";
import { depsOr503, page } from "@/lib/mailer/http";

export const dynamic = "force-dynamic";

const done = () =>
  page("Unsubscribed", "Uptime will not email this address again.", { tone: "success", link: { href: "/", label: "Back to Uptime" } });

export async function GET() {
  return page("Stop Uptime email", "Stop all Uptime email to this address.", { form: { label: "Unsubscribe" } });
}

export async function POST(request: Request) {
  const deps = depsOr503();
  if (deps instanceof Response) return done();
  const q = new URL(request.url).searchParams;
  try {
    await unsubscribe(deps, { e: q.get("e"), t: q.get("t") });
  } catch {
    // Same answer either way; only the fact of the failure is logged, never the address.
    console.warn("mailer: unsubscribe store write failed");
  }
  return done();
}
