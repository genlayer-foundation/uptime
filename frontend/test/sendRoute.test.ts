import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRADBURY } from "@/lib/chains";
import { _clearRoutesForTests, rawSendTarget, rerouteRawSends, routeDeploymentSends } from "@/lib/genlayer/sendRoute";

const NODE = "https://node.example/";
const CHAIN = "https://chain.example";
const body = (method: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] });

describe("rerouteRawSends", () => {
  const realFetch = globalThis.fetch;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    const fake = vi.fn(async (input: unknown) => {
      calls.push(String(input));
      return new Response("{}");
    }) as unknown as typeof fetch & Record<string, unknown>;
    fake.__nextPatched = true; // as Next leaves it
    globalThis.fetch = fake;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    _clearRoutesForTests();
  });

  it("sends eth_sendRawTransaction for the node to the chain RPC, nothing else", async () => {
    rerouteRawSends(NODE, CHAIN);
    await fetch(NODE, { method: "POST", body: body("eth_sendRawTransaction") });
    await fetch(NODE, { method: "POST", body: body("gen_call") });
    await fetch(NODE, { method: "POST", body: body("eth_getTransactionReceipt") });
    await fetch("https://other.example", { method: "POST", body: body("eth_sendRawTransaction") });
    expect(calls).toEqual([CHAIN, NODE, NODE, "https://other.example"]);
  });

  it("matches the node URL with or without a trailing slash; ignores batches and bad JSON", () => {
    rerouteRawSends(NODE, CHAIN);
    expect(rawSendTarget("https://node.example", body("eth_sendRawTransaction"))).toBe(CHAIN);
    expect(rawSendTarget(NODE, `[${body("eth_sendRawTransaction")}]`)).toBeNull();
    expect(rawSendTarget(NODE, "eth_sendRawTransaction{")).toBeNull();
    expect(rawSendTarget(NODE, undefined)).toBeNull();
  });

  it("wraps once and keeps Next's fetch markers", () => {
    rerouteRawSends(NODE, CHAIN);
    const first = globalThis.fetch;
    rerouteRawSends(NODE, CHAIN);
    expect(globalThis.fetch).toBe(first);
    expect((globalThis.fetch as unknown as Record<string, unknown>).__nextPatched).toBe(true);
  });

  it("does nothing when both hosts are the same", () => {
    const before = globalThis.fetch;
    rerouteRawSends(CHAIN, CHAIN + "/");
    expect(globalThis.fetch).toBe(before);
  });

  it("Bradbury: the node RPC's signed txs go to the chain RPC", () => {
    expect(BRADBURY.sendRpc).toBe(BRADBURY.chainRpc);
    routeDeploymentSends(BRADBURY);
    expect(rawSendTarget(BRADBURY.genlayerRpc, body("eth_sendRawTransaction"))).toBe(BRADBURY.chainRpc);
  });
});
