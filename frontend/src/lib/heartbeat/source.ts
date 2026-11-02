// Where GET /api/heartbeat reads its records from.
//
//   local       the real store: Postgres, KV as fallback (store.ts; the ONLY source in a deployed app)
//   demo        a deterministic synthetic history, generated in-process
//   production  the public endpoint of the deployed app, proxied (no secrets)
//
// The switch exists for local development only. It is enforced HERE, on the
// server: outside `next dev` every request resolves to "local", whatever the
// env, cookie or query string says. Hiding the toggle in the UI is not the
// guard.

export type DataSource = "local" | "demo" | "production";

export const SOURCES: readonly DataSource[] = ["local", "demo", "production"];
export const SOURCE_COOKIE = "hb-source";
export const SOURCE_PARAM = "source";
export const PRODUCTION_ENDPOINT = "https://uptime.genlayer.foundation/api/heartbeat";

function isSource(v: string | null | undefined): v is DataSource {
  return !!v && (SOURCES as readonly string[]).includes(v);
}

// True only under `next dev` on a machine that is not a Vercel deployment.
// `next build` inlines NODE_ENV="production", so in a deployed bundle this is
// constant-false and the alternate sources are unreachable.
export function sourceSwitchAllowed(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const vercel = process.env.VERCEL_ENV;
  return !vercel || vercel === "development";
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

// Precedence (dev only): ?source= → hb-source cookie → HEARTBEAT_DATA_SOURCE → demo.
export function resolveSource(request: Request): DataSource {
  if (!sourceSwitchAllowed()) return "local";
  const query = new URL(request.url).searchParams.get(SOURCE_PARAM);
  if (isSource(query)) return query;
  const cookie = cookieValue(request.headers.get("cookie"), SOURCE_COOKIE);
  if (isSource(cookie)) return cookie;
  const env = process.env.HEARTBEAT_DATA_SOURCE;
  if (isSource(env)) return env;
  return "demo";
}
