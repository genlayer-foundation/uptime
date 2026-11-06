import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import { createClient } from "genlayer-js";
import { DEFAULT_BRADBURY_FEES, feesFor, withFees } from "@/lib/genlayer/fees";
import { bradburyPhase2 } from "@/lib/chains";

function fakeClient() {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    account: { address: "0x1" },
    async deployContract(a: Record<string, unknown>) {
      calls.push({ op: "deploy", ...a });
      return "0xd";
    },
    async writeContract(a: Record<string, unknown>) {
      calls.push({ op: "write", ...a });
      return "0xw";
    },
    async readContract(a: Record<string, unknown>) {
      calls.push({ op: "read", ...a });
      return 1;
    },
  };
}

describe("feesFor", () => {
  it("Bradbury gets the default distribution; Studio is free", () => {
    expect(feesFor("bradbury", {})).toEqual({ distribution: DEFAULT_BRADBURY_FEES });
    expect(feesFor("studio", { BRADBURY_TX_FEES: '{"appealRounds":"1"}' })).toBeNull();
  });

  it("default funds a leader + one rotation, no pre-funded appeal", () => {
    const d = feesFor("bradbury", {})!.distribution;
    expect(d.appealRounds).toBe(0n);
    expect(d.rotations).toEqual([1n]);
    expect(d.executionBudgetPerRound).toBe(25_000_000_000_000_000n);
  });

  it("BRADBURY_TX_FEES overrides fields (as strings or numbers)", () => {
    const d = feesFor("bradbury", {
      BRADBURY_TX_FEES: '{"appealRounds":"1","rotations":["1",1],"executionBudgetPerRound":"10000000000000000"}',
    })!.distribution;
    expect(d).toMatchObject({ appealRounds: 1n, rotations: [1n, 1n], executionBudgetPerRound: 10_000_000_000_000_000n });
    expect(d.leaderTimeunitsAllocation).toBe(600n);
    expect(DEFAULT_BRADBURY_FEES.rotations).toEqual([1n]); // default not mutated
  });

  it("rejects bad overrides loudly", () => {
    expect(() => feesFor("bradbury", { BRADBURY_TX_FEES: "{" })).toThrow(/valid JSON/);
    expect(() => feesFor("bradbury", { BRADBURY_TX_FEES: '{"feeValue":"1"}' })).toThrow(/unknown field/);
    expect(() => feesFor("bradbury", { BRADBURY_TX_FEES: '{"appealRounds":"1"}' })).toThrow(/appealRounds \+ 1/);
    expect(() => feesFor("bradbury", { BRADBURY_TX_FEES: '{"leaderTimeunitsAllocation":"-1"}' })).toThrow(/>= 0/);
  });
});

describe("withFees", () => {
  it("adds fees to every Bradbury deploy and write, never to reads", async () => {
    const c = fakeClient();
    const w = withFees(c, "bradbury", {});
    await w.deployContract({ code: "x", args: [1n] });
    await w.writeContract({ address: "0xa", functionName: "bump", args: [1n], value: 0n });
    await w.readContract({ address: "0xa", functionName: "get_count", args: [] });
    expect(c.calls[0]).toMatchObject({ op: "deploy", fees: { distribution: DEFAULT_BRADBURY_FEES } });
    expect(c.calls[1]).toMatchObject({ op: "write", functionName: "bump", fees: { distribution: DEFAULT_BRADBURY_FEES } });
    expect(c.calls[2]).not.toHaveProperty("fees");
    expect(w.account).toBe(c.account);
  });

  it("a caller's own fees win", async () => {
    const c = fakeClient();
    const own = { distribution: { ...DEFAULT_BRADBURY_FEES, appealRounds: 1n, rotations: [1n, 1n] } };
    await withFees(c, "bradbury", {}).writeContract({ address: "0xa", functionName: "f", fees: own });
    expect(c.calls[0].fees).toBe(own);
  });

  it("Studio clients are returned unchanged", () => {
    const c = fakeClient();
    expect(withFees(c, "studio", {})).toBe(c);
  });
});

// The regression behind every SUBMIT_FAILED "Transaction reverted": genlayer-js
// 0.26 encoded the legacy 5/6-arg addTransaction, which Phase 2's
// ConsensusMainWithFees does not have. The SDK must encode the fee-aware
// addTransaction(params) (selector 0x35a251fb) with msg.value = deposit.
describe("Phase 2 submission encoding", () => {
  it("sends addTransaction(params) to ConsensusMainWithFees with a non-zero deposit", async () => {
    const FROM = "0xDcA42c83d171811EB1d886e13a07D5776AcA84dd";
    const DEPOSIT = 50_000_000_000_000_000n;
    let sent: { to: string; data: string; value: string } | undefined;
    const fetchStub = async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body));
      const one = (m: { id: number; method: string; params: unknown[] }) => {
        let result: unknown;
        switch (m.method) {
          case "eth_call": // FeeManager.calculateRoundFees
            result = "0x" + DEPOSIT.toString(16).padStart(64, "0");
            break;
          case "eth_getTransactionCount":
            result = "0x0";
            break;
          case "eth_estimateGas":
            result = "0x100000";
            break;
          case "eth_sendTransaction":
            sent = m.params[0] as typeof sent;
            throw new Error("captured");
          default:
            result = "0x1";
        }
        return { jsonrpc: "2.0", id: m.id, result };
      };
      try {
        const out = Array.isArray(body) ? body.map(one) : one(body);
        return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
      } catch {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "stop" } }), {
          headers: { "content-type": "application/json" },
        });
      }
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchStub as typeof fetch;
    try {
      const client = withFees(
        createClient({ chain: bradburyPhase2, account: { address: FROM, type: "json-rpc" } as never }),
        "bradbury",
        {}
      );
      await client
        .writeContract({ address: "0x66a4bF89E8812Ced84C405c6f0Cb0E35153EBb3F", functionName: "bump", args: [1n], value: 0n })
        .catch(() => undefined);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent).toBeDefined();
    expect(sent!.to.toLowerCase()).toBe(bradburyPhase2.consensusMainContract!.address.toLowerCase());
    expect(sent!.data.slice(0, 10)).toBe("0x35a251fb");
    expect(BigInt(sent!.value)).toBe(DEPOSIT);
    // and not the legacy selectors 0.26 sent
    const legacy = [
      toFunctionSelector("addTransaction(address,address,uint256,uint256,bytes)"),
      toFunctionSelector("addTransaction(address,address,uint256,uint256,bytes,uint256)"),
    ];
    expect(legacy).not.toContain(sent!.data.slice(0, 10));
  });
});
