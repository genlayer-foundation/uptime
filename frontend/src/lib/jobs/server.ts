// Production wiring: real Postgres, the committed allowlist, the pool reader,
// the relayer clients and the Heartbeat runner. Routes import from here;
// tests build their own deps instead.

import { NextResponse } from "next/server";
import { CANARY_SOURCE } from "@/lib/heartbeat/canary";
import { runTick } from "@/lib/heartbeat/runner";
import { STUDIO_ALLOWLIST } from "./allowlist";
import { getSession, requestHost, sessionSecret, type Session } from "./auth/session";
import { genlayerClient, relayerAddress, type ChainClient } from "./chain";
import { hasDatabase } from "./db";
import { isId } from "./ids";
import type { ExecutorDeps } from "./executor";
import { ensureMailerWired, onRunFailed } from "./mailerWiring";
import { evmPoolReader, makeFundingCheck, runCostWei } from "./pool/pool";
import { getRepo } from "./repo";
import type { ServiceDeps } from "./service";
import type { Network } from "./types";

const now = () => Math.floor(Date.now() / 1000);

export async function serviceDeps(): Promise<ServiceDeps> {
  return {
    repo: getRepo(),
    gate: { allowlist: STUDIO_ALLOWLIST, funding: makeFundingCheck(await evmPoolReader()) },
    nowSec: now,
  };
}

export async function executorDeps(): Promise<ExecutorDeps> {
  ensureMailerWired();
  const clients = new Map<Network, ChainClient>();
  return {
    ...(await serviceDeps()),
    clientFor: (n) => {
      if (!clients.has(n)) clients.set(n, genlayerClient(n));
      return clients.get(n)!;
    },
    relayerFor: (n) => relayerAddress(n) ?? "0x0000000000000000000000000000000000000000",
    deployPresets: { canary: CANARY_SOURCE },
    heartbeatTick: async () => {
      const recs = await runTick();
      return {
        tick: recs[0]?.tick ?? 0,
        probes: recs.map((r) => ({ kind: r.kind, qid: r.qid, txHash: r.txHash, status: r.status, error: r.error })),
      };
    },
    runCostWei,
    onRunFailed,
  };
}

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export function ready(): NextResponse | null {
  if (!hasDatabase()) return jsonError(503, "DATABASE_URL not configured");
  if (!sessionSecret()) return jsonError(503, "SESSION_SECRET not configured");
  return null;
}

// Mutations must come from this site (the cookie is SameSite=Lax as well).
export function sameOrigin(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === requestHost(request);
  } catch {
    return false;
  }
}

// Every user route: Postgres + session secret configured, same origin, signed in.
export function requireUser(request: Request): { session: Session } | { response: NextResponse } {
  const notReady = ready();
  if (notReady) return { response: notReady };
  if (!sameOrigin(request)) return { response: jsonError(403, "cross-site request refused") };
  const session = getSession(request);
  if (!session) return { response: jsonError(401, "Sign in with your wallet first") };
  return { session };
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await request.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// A job id from the route, or "" when it is not a UUID (→ 404 downstream).
export async function idParam(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  const raw = (await ctx.params).id.toLowerCase();
  return isId(raw) ? raw : "";
}
