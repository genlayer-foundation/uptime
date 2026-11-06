// Per-network submission shape, end to end through the executor's own
// genlayerClient(n) with a stubbed RPC: nothing leaves the process.
//
// Studio: genlayer-js 1.x, legacy addTransaction (0x27241a99), no value. Hosted
//   Studio cannot decode genlayer-js 2.x's fee-aware call: those txs finalized
//   NO_MAJORITY with no contract (0x23a1504a…, 0x0f76e4f4…, 2026-11-06).
// Bradbury: genlayer-js 2.x, addTransaction(params) (0x35a251fb) + fee deposit.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTransaction, type Hex } from "viem";
import { genlayerClient } from "@/lib/jobs/chain";
import { STUDIO_ADD_TRANSACTION_SELECTOR, studioChainV1 } from "@/lib/genlayer/studio";
import { bradburyPhase2 } from "@/lib/chains";

// Well-known Hardhat/Anvil dev key #1: never funded anywhere real.
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f668cdd6d8b690";
const DEPOSIT = 50_000_000_000_000_000n;
const FEE_SELECTOR = "0x35a251fb";

type Rpc = { id: number; method: string; params: unknown[] };

let sent: ReturnType<typeof parseTransaction>[] = [];
let methods: string[] = [];
const realFetch = globalThis.fetch;

function rpcStub() {
  return async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body));
    const one = (m: Rpc) => {
      methods.push(m.method);
      switch (m.method) {
        case "eth_sendRawTransaction":
          sent.push(parseTransaction(m.params[0] as Hex));
          return { jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "captured" } };
        case "eth_call": // Bradbury FeeManager.calculateRoundFees
          return { jsonrpc: "2.0", id: m.id, result: "0x" + DEPOSIT.toString(16).padStart(64, "0") };
        case "eth_getTransactionCount":
          return { jsonrpc: "2.0", id: m.id, result: "0x0" };
        case "eth_estimateGas":
          return { jsonrpc: "2.0", id: m.id, result: "0x100000" };
        default:
          return { jsonrpc: "2.0", id: m.id, result: "0x1" };
      }
    };
    const out = Array.isArray(body) ? body.map(one) : one(body);
    return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
  };
}

beforeEach(() => {
  sent = [];
  methods = [];
  process.env.RELAYER_KEY_STUDIO = TEST_KEY;
  process.env.RELAYER_KEY_BRADBURY = TEST_KEY;
  delete process.env.BRADBURY_TX_FEES;
  globalThis.fetch = rpcStub() as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.RELAYER_KEY_STUDIO;
  delete process.env.RELAYER_KEY_BRADBURY;
});

async function submitBoth(n: "studio" | "bradbury") {
  const c = genlayerClient(n);
  await c.writeContract({ address: "0x4574A36757da191D34CE3a38060b229928766024", functionName: "ping", args: [], value: 0n }).catch(() => undefined);
  await c.deployContract({ code: "# contract\n", args: [] }).catch(() => undefined);
  return sent;
}

describe("Studio jobs submit the call hosted Studio decodes", () => {
  it("write and deploy use the legacy addTransaction with no value and no fee pricing", async () => {
    const txs = await submitBoth("studio");
    expect(txs).toHaveLength(2);
    for (const tx of txs) {
      expect(tx.to!.toLowerCase()).toBe(studioChainV1.consensusMainContract!.address.toLowerCase());
      expect(tx.data!.slice(0, 10)).toBe(STUDIO_ADD_TRANSACTION_SELECTOR);
      expect(tx.data!.slice(0, 10)).not.toBe(FEE_SELECTOR);
      expect(tx.value ?? 0n).toBe(0n);
      expect(tx.chainId).toBe(61999);
    }
    expect(methods).not.toContain("eth_call"); // never priced a fee deposit
  });
});

describe("Bradbury jobs still pay the Phase 2 deposit", () => {
  it("write and deploy use addTransaction(params) with msg.value = deposit", async () => {
    const txs = await submitBoth("bradbury");
    expect(txs).toHaveLength(2);
    for (const tx of txs) {
      expect(tx.to!.toLowerCase()).toBe(bradburyPhase2.consensusMainContract!.address.toLowerCase());
      expect(tx.data!.slice(0, 10)).toBe(FEE_SELECTOR);
      expect(tx.value).toBe(DEPOSIT);
      expect(tx.chainId).toBe(4221);
    }
  });
});
