// Next.js boot hook: runs once per server instance before any request.
// Wires the mailer to the backend's Postgres (no-op without DATABASE_URL).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureMailerWired } = await import("@/lib/jobs/mailerWiring");
  ensureMailerWired();
}
