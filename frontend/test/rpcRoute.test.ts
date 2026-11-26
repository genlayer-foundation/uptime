import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BRADBURY } from "@/lib/chains";
import {
  _clearRoutesForTests,
  GAS_FALLBACK_REFUSED,
  routeDeployment,
  routeRpc,
  rpcTarget,
  usesGasFallback,
} from "@/lib/genlayer/rpcRoute";

const NODE = "https://node.example/";
const CHAIN = "https://chain.example";
// Well-known Hardhat/Anvil dev key #1: never funded anywhere real.
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f668cdd6d8b690";
const body = (method: string, params: unknown[] = []) => JSON.stringify({ jsonrpc: "2.0", id: 7, method, params });
const ok = (result: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 7, result });
const internal = JSON.stringify({ jsonrpc: "2.0", id: 7, error: { code: -32603, message: "Internal error" } });

async function signed(gas: bigint): Promise<Hex> {
  const account = privateKeyToAccount(TEST_KEY);
  return account.signTransaction({
    to: BRADBURY.contracts.consensusMain,
    data: "0x35a251fb",
    gas,
    gasPrice: 10_000_000n,
    nonce: 1,
    chainId: BRADBURY.chainId,
    type: "legacy",
  });
}

describe("routeRpc", () => {
  const realFetch = globalThis.fetch;
  let calls: string[];
  let replies: (string | Error | Response)[];

  beforeEach(() => {
    calls = [];
    replies = [];
    const fake = vi.fn(async (input: unknown) => {
      calls.push(String(input));
      const r = replies.shift() ?? "{}";
      if (r instanceof Error) throw r;
      return r instanceof Response ? r : new Response(r);
    }) as unknown as typeof fetch & Record<string, unknown>;
    fake.__nextPatched = true; // as Next leaves it
    globalThis.fetch = fake;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    _clearRoutesForTests();
  });

  it("sends every eth_* for the node to the chain RPC and keeps gen_* on the node", async () => {
    routeRpc(NODE, CHAIN);
    for (const m of ["eth_sendRawTransaction", "gen_call", "eth_call", "eth_estimateGas", "eth_getTransactionReceipt", "gen_getContractCode"]) {
      await fetch(NODE, { method: "POST", body: body(m) });
    }
    await fetch("https://other.example", { method: "POST", body: body("eth_call") });
    expect(calls).toEqual([CHAIN, NODE, CHAIN, CHAIN, CHAIN, NODE, "https://other.example"]);
  });

  it("matches the node URL with or without a trailing slash; ignores batches and bad JSON", () => {
    routeRpc(NODE, CHAIN);
    expect(rpcTarget("https://node.example", body("eth_blockNumber"))).toBe(CHAIN);
    expect(rpcTarget(NODE, body("gen_call"))).toBeNull();
    expect(rpcTarget(NODE, `[${body("eth_call")}]`)).toBeNull();
    expect(rpcTarget(NODE, "eth_call{")).toBeNull();
    expect(rpcTarget(NODE, undefined)).toBeNull();
  });

  it("retries a routed read once on -32603, a 5xx or a network error", async () => {
    routeRpc(NODE, CHAIN);
    replies = [internal, ok("0x1")];
    expect(await (await fetch(NODE, { method: "POST", body: body("eth_call") })).json()).toEqual(JSON.parse(ok("0x1")));
    replies = [new Response("bad gateway", { status: 502 }), ok("0x2")];
    expect((await (await fetch(NODE, { method: "POST", body: body("eth_estimateGas") })).json()).result).toBe("0x2");
    replies = [new Error("ECONNRESET"), ok("0x3")];
    expect((await (await fetch(NODE, { method: "POST", body: body("eth_blockNumber") })).json()).result).toBe("0x3");
    expect(calls).toEqual([CHAIN, CHAIN, CHAIN, CHAIN, CHAIN, CHAIN]);
  });

  it("gives up after the second failure and passes other errors through without retrying", async () => {
    routeRpc(NODE, CHAIN);
    replies = [internal, internal];
    expect((await (await fetch(NODE, { method: "POST", body: body("eth_call") })).json()).error.code).toBe(-32603);
    replies = [JSON.stringify({ jsonrpc: "2.0", id: 7, error: { code: 3, message: "execution reverted" } })];
    expect((await (await fetch(NODE, { method: "POST", body: body("eth_call") })).json()).error.code).toBe(3);
    replies = [new Error("down"), new Error("still down")];
    await expect(fetch(NODE, { method: "POST", body: body("eth_call") })).rejects.toThrow("still down");
    expect(calls).toHaveLength(5);
  });

  it("never retries a send, and never retries gen_*", async () => {
    routeRpc(NODE, CHAIN);
    replies = [internal];
    await fetch(NODE, { method: "POST", body: body("eth_sendRawTransaction", [await signed(3_000_000n)]) });
    replies = [internal];
    await fetch(NODE, { method: "POST", body: body("gen_call") });
    expect(calls).toEqual([CHAIN, NODE]);
  });

  it("refuses a signed tx carrying genlayer-js's 200000 gas fallback without sending it", async () => {
    routeRpc(NODE, CHAIN);
    const raw = await signed(200_000n);
    expect(usesGasFallback(raw)).toBe(true);
    expect(usesGasFallback(await signed(4_323_688n))).toBe(false);
    expect(usesGasFallback("0xzz")).toBe(false);
    const res = await (await fetch(NODE, { method: "POST", body: body("eth_sendRawTransaction", [raw]) })).json();
    expect(res).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32000, message: GAS_FALLBACK_REFUSED } });
    expect(calls).toEqual([]);
  });

  it("wraps once and keeps Next's fetch markers", () => {
    routeRpc(NODE, CHAIN);
    const first = globalThis.fetch;
    routeRpc(NODE, CHAIN);
    expect(globalThis.fetch).toBe(first);
    expect((globalThis.fetch as unknown as Record<string, unknown>).__nextPatched).toBe(true);
  });

  it("does nothing when both hosts are the same", () => {
    const before = globalThis.fetch;
    routeRpc(CHAIN, CHAIN + "/");
    expect(globalThis.fetch).toBe(before);
  });

  it("Bradbury: the node RPC's eth_* go to the chain RPC, gen_* stays", () => {
    expect(BRADBURY.ethRpc).toBe(BRADBURY.chainRpc);
    routeDeployment(BRADBURY);
    expect(rpcTarget(BRADBURY.genlayerRpc, body("eth_sendRawTransaction"))).toBe(BRADBURY.chainRpc);
    expect(rpcTarget(BRADBURY.genlayerRpc, body("eth_call"))).toBe(BRADBURY.chainRpc);
    expect(rpcTarget(BRADBURY.genlayerRpc, body("gen_call"))).toBeNull();
  });
});
