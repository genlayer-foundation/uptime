// Confirmation link. GET only shows a button: link scanners prefetch GETs, and
// a prefetch must not confirm an address. The POST does the confirming.
import { confirmRecipient } from "@/lib/mailer/recipients";
import { depsOr503, page } from "@/lib/mailer/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return page("Confirm this address", "Send Uptime job alerts to this email.", { form: { label: "Confirm" } });
}

export async function POST(request: Request) {
  const deps = depsOr503();
  if (deps instanceof Response) {
    return page("Not available", "Email alerts are off right now.", { tone: "error", link: { href: "/", label: "Back to Uptime" } });
  }
  const q = new URL(request.url).searchParams;
  const ok = await confirmRecipient(deps, { r: q.get("r"), x: q.get("x"), t: q.get("t") });
  return ok
    ? page("Address confirmed", "You can now pick it for job alerts.", {
        tone: "success",
        link: { href: "/notifications", label: "Open notifications" },
      })
    : page("Link not valid", "It is invalid or expired. Add the address again.", {
        tone: "error",
        link: { href: "/notifications", label: "Open notifications" },
      });
}
