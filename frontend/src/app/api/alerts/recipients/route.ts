// The signed-in owner's alert addresses. POST adds one and sends ONE
// confirmation email; the address is usable only after the link is clicked.
import { addRecipient, listRecipients } from "@/lib/mailer/recipients";
import { depsOr503, json, readJson } from "@/lib/mailer/http";
import { sessionWallet } from "@/lib/mailer/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const deps = depsOr503();
  if (deps instanceof Response) return deps;
  const wallet = sessionWallet(request);
  if (!wallet) return json({ error: "not signed in" }, 401);
  return json({ recipients: await listRecipients(deps, wallet) });
}

export async function POST(request: Request) {
  const deps = depsOr503();
  if (deps instanceof Response) return deps;
  const wallet = sessionWallet(request);
  if (!wallet) return json({ error: "not signed in" }, 401);
  const body = await readJson(request);
  if (!body) return json({ error: "expected a JSON body" }, 400);
  const res = await addRecipient(deps, wallet, body.email);
  if (!res.ok) return json({ error: res.error }, res.status);
  return json({
    recipient: res.value,
    message:
      res.value.state === "verified"
        ? "This address is already confirmed."
        : "If this address can receive email, a confirmation link is on its way.",
  });
}
