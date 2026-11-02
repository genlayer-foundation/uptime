// Remove one of the signed-in owner's addresses (also drops it from every job rule).
import { removeRecipient } from "@/lib/mailer/recipients";
import { depsOr503, json } from "@/lib/mailer/http";
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
