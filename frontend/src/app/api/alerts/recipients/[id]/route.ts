// One of the signed-in owner's addresses. DELETE removes it (and drops it from
// every job rule); PATCH { dailyCap } sets its emails-per-day cap (1-100, null = default).
import { removeRecipient, setRecipientCap } from "@/lib/mailer/recipients";
import { depsOr503, json, readJson } from "@/lib/mailer/http";
import { sessionWallet } from "@/lib/mailer/session";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const deps = depsOr503();
  if (deps instanceof Response) return deps;
  const wallet = sessionWallet(request);
  if (!wallet) return json({ error: "not signed in" }, 401);
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "not found" }, 404);
  return (await removeRecipient(deps, wallet, id)) ? json({ removed: id }) : json({ error: "not found" }, 404);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const deps = depsOr503();
  if (deps instanceof Response) return deps;
  const wallet = sessionWallet(request);
  if (!wallet) return json({ error: "not signed in" }, 401);
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "not found" }, 404);
  const body = await readJson(request);
  if (!body || !("dailyCap" in body)) return json({ error: "expected { dailyCap }" }, 400);
  const res = await setRecipientCap(deps, wallet, id, body.dailyCap);
  return res.ok ? json({ recipient: res.value }) : json({ error: res.error }, res.status);
}
