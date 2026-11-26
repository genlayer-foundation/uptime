// Server-only: split a GenLayer node RPC's traffic by method, retry its flaky reads, and refuse
// transactions signed with genlayer-js's blind gas fallback.
//
// genlayer-js 2.x sends every JSON-RPC call of a client to the chain's single `rpcUrls.default`
// URL through the global fetch, and has no option to split them. On Bradbury Phase 3 no public
// host serves both kinds well:
//  - the GenLayer node RPC (https://rpc.bradbury.genlayer.com) is the only host for gen_*, but it
//    answers eth_sendRawTransaction "method not found", and its eth_* pass-through is slow (2-7s
//    on 2026-11-26) and intermittently answers JSON-RPC -32603 "Internal error" (every reconcile
//    run logged some; ticks 461, 463, 464 lost an action to it);
//  - the chain RPC serves every eth_* method quickly and no gen_*.
//
// routeRpc(from, to) wraps the global fetch once. A single (non-batch) JSON-RPC request POSTed to
// `from` whose method is eth_*, net_* or web3_* goes to `to`; gen_* and everything else stays on
// `from`. Other hosts pass through untouched. Idempotent; a later call adds or replaces a route.
//
// On a routed read (anything but a send), a network failure, an HTTP 5xx or a JSON-RPC -32603 is
// retried once. That covers FeeManager.calculateRoundFees (eth_call) and eth_estimateGas.
//
// genlayer-js signs with a gas limit of exactly 200_000 when eth_estimateGas throws, and a
// Bradbury addTransaction needs 2-4M: tick 463's f0-status tx 0xf7ceda10… reverted out of gas
// (191,839 of 200,000) and burned its deposit. So a routed eth_sendRawTransaction whose gas limit
// is that fallback is answered with a JSON-RPC error and never sent: the caller records
// SUBMIT_FAILED, and the nonce stays unused.

import { parseTransaction, type Hex } from "viem";
import type { Deployment } from "../chains";

type Fetch = typeof globalThis.fetch;

const MARK = "__uptimeRpcRoute";
const routes = new Map<string, string>();

/** The gas limit genlayer-js 2.x signs with when eth_estimateGas fails. */
export const SDK_GAS_FALLBACK = 200_000n;
const INTERNAL_ERROR = -32603;
const ROUTED = /^(eth|net|web3)_/;
const SENDS = new Set(["eth_sendRawTransaction", "eth_sendTransaction"]);

const norm = (u: string) => u.trim().replace(/\/+$/, "");

function urlOf(input: Parameters<Fetch>[0]): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return null; // a Request object: genlayer-js never passes one
}

interface Call {
  id: unknown;
  method: string;
  params: unknown[];
}

function callOf(body: unknown): Call | null {
  if (typeof body !== "string") return null;
  try {
    const j = JSON.parse(body);
    if (Array.isArray(j) || typeof j?.method !== "string") return null;
    return { id: j.id ?? null, method: j.method, params: Array.isArray(j.params) ? j.params : [] };
  } catch {
    return null;
  }
}

/** Where a request to `url` with `body` should go, or null to leave it alone. */
export function rpcTarget(url: string, body: unknown): string | null {
  const to = routes.get(norm(url));
  if (!to) return null;
  const call = callOf(body);
  return call && ROUTED.test(call.method) ? to : null;
}

/** True when a signed transaction carries genlayer-js's blind 200_000 gas fallback. */
export function usesGasFallback(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  try {
    return parseTransaction(raw as Hex).gas === SDK_GAS_FALLBACK;
  } catch {
    return false;
  }
}

export const GAS_FALLBACK_REFUSED =
  "not sent: gas estimation failed twice and genlayer-js fell back to a 200000 gas limit, which reverts out of gas on Bradbury";

function rpcError(id: unknown, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type Attempt = { res: Response; retry: boolean } | { err: unknown; retry: true };

// One read: a thrown fetch, a 5xx or a -32603 body is worth one retry; anything else is final.
async function attempt(f: Fetch, target: string, init: Parameters<Fetch>[1]): Promise<Attempt> {
  let res: Response;
  try {
    res = await f(target, init);
  } catch (err) {
    return { err, retry: true };
  }
  if (res.status >= 500) return { res, retry: true };
  const text = await res.text();
  const copy = new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
  try {
    if (JSON.parse(text)?.error?.code === INTERNAL_ERROR) return { res: copy, retry: true };
  } catch {
    // not JSON: hand it back as it came
  }
  return { res: copy, retry: false };
}

async function routedRead(f: Fetch, target: string, init: Parameters<Fetch>[1]): Promise<Response> {
  const first = await attempt(f, target, init);
  if (!first.retry && "res" in first) return first.res;
  const second = await attempt(f, target, init);
  if ("res" in second) return second.res;
  throw second.err;
}

export function routeRpc(from: string, to: string): void {
  if (!from?.trim() || !to?.trim() || norm(from) === norm(to)) return;
  routes.set(norm(from), to.trim());
  const current = globalThis.fetch as Fetch & Record<string, unknown>;
  if (current[MARK]) return;
  const wrapped = (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const url = urlOf(input);
    const target = url ? rpcTarget(url, init?.body) : null;
    if (!target) return current(input, init);
    const call = callOf(init?.body)!;
    if (!SENDS.has(call.method)) return routedRead(current, target, init);
    if (call.method === "eth_sendRawTransaction" && usesGasFallback(call.params[0])) {
      return rpcError(call.id, GAS_FALLBACK_REFUSED);
    }
    return current(target, init);
  }) as Fetch & Record<string, unknown>;
  // Keep Next's markers (__nextPatched, _nextOriginalFetch) so it does not patch over us.
  for (const k of Object.keys(current)) wrapped[k] = current[k];
  wrapped[MARK] = true;
  globalThis.fetch = wrapped;
}

/** Route a deployment's eth_* traffic to its `ethRpc`, if it names one. */
export function routeDeployment(d: Pick<Deployment, "genlayerRpc" | "ethRpc">): void {
  if (d.ethRpc) routeRpc(d.genlayerRpc, d.ethRpc);
}

/** Tests only. */
export function _clearRoutesForTests(): void {
  routes.clear();
}
