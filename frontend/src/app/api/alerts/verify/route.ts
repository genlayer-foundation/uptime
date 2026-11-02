// Confirmation link. GET only shows a button: link scanners prefetch GETs, and
// a prefetch must not confirm an address. The POST does the confirming.
import { confirmRecipient } from "@/lib/mailer/recipients";
import { depsOr503, page } from "@/lib/mailer/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return page("Confirm this address", "Confirm that this address may receive GenLayer Uptime job alerts.", {
    label: "Confirm",
  });
}

export async function POST(request: Request) {
  const deps = depsOr503();
  if (deps instanceof Response) return page("Not available", "Email alerts are not enabled right now.");
  const q = new URL(request.url).searchParams;
  const ok = await confirmRecipient(deps, { r: q.get("r"), x: q.get("x"), t: q.get("t") });
  return ok
    ? page("Address confirmed", "This address can now be chosen for job alerts.")
    : page("Link not valid", "This confirmation link is invalid or has expired. Add the address again to get a new one.");
}
