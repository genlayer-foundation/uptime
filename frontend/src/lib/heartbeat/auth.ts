// Vercel cron sends `Authorization: Bearer $CRON_SECRET`. Fail closed: without
// a secret configured nobody can trigger a tick, because a tick spends gas.
export function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
