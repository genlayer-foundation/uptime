// "Run now" in the browser: build the SAME GenLayer transactions the executor
// sends, signed by the visitor's wallet (window.ethereum), then report each tx
// hash to /api/jobs/:id/manual, which verifies it on-chain before recording.
//
// Bradbury: genlayer-js 2.x with the Phase 2 fee distribution the server sends
// (lib/genlayer/fees.ts; the SDK computes the deposit from FeeManager).
// Studio: genlayer-js 1.x, the legacy addTransaction hosted Studio decodes
// (lib/genlayer/studio.ts), no fees. Both SDKs route eth_sendTransaction to the
// injected wallet when the client's account is a bare address.

import type { Address } from "viem";
import { apiCall } from "@/lib/jobs/client";
import { untagArgs, type ManualCall, type ManualStatus, type WireFees } from "@/lib/jobs/manualPlan";
import type { Network } from "@/lib/jobs/types";
import { ensureBradbury, injected, requestAccount } from "./wallet";

const STUDIO = { id: 61999, name: "GenLayer Studio", rpc: "https://studio.genlayer.com/api" };

async function ensureStudio() {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found.");
  const hexId = `0x${STUDIO.id.toString(16)}`;
  if (((await eth.request({ method: "eth_chainId" })) as string)?.toLowerCase() === hexId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    if ((e as { code?: number })?.code !== 4902) throw e;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hexId, chainName: STUDIO.name, nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: [STUDIO.rpc] }],
    });
  }
}

function feesOf(w: WireFees) {
  if (!w) return undefined;
  const d = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Array.isArray(v) ? v.map(BigInt) : BigInt(v)]));
  return { distribution: d };
}

type Submit = {
  deployContract(a: Record<string, unknown>): Promise<unknown>;
  writeContract(a: Record<string, unknown>): Promise<unknown>;
};

async function clientFor(network: Network, account: Address): Promise<Submit> {
  const eth = injected();
  if (network === "studio") {
    await ensureStudio();
    const [{ createClient }, { studionet }] = await Promise.all([import("genlayer-js-v1"), import("genlayer-js-v1/chains")]);
    return createClient({ chain: studionet, account }) as unknown as Submit;
  }
  await ensureBradbury();
  const [{ createClient }, { bradburyPhase2 }] = await Promise.all([import("genlayer-js"), import("@/lib/chains")]);
  return createClient({ chain: bradburyPhase2, account, provider: eth } as never) as unknown as Submit;
}

async function sign(network: Network, account: Address, call: ManualCall, wire: WireFees): Promise<string> {
  const c = await clientFor(network, account);
  const args = untagArgs(call.args) as unknown[];
  const fees = feesOf(wire);
  const out =
    call.kind === "deploy"
      ? await c.deployContract({ code: call.code, args, ...(fees ? { fees } : {}) })
      : await c.writeContract({ address: call.address, functionName: call.method, args, value: BigInt(0), ...(fees ? { fees } : {}) });
  if (typeof out !== "string" || !out.startsWith("0x")) throw new Error("The wallet returned no transaction hash.");
  return out;
}

const path = (jobId: string) => `/api/jobs/${encodeURIComponent(jobId)}/manual`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drive one manual run to its end. `onStep` reports progress for the button's
 * one-line status. Throws with the server's or the wallet's message.
 */
export async function runNow(
  jobId: string,
  onStep: (s: { phase: "sign" | "submitted" | "waiting"; stepId?: string; n: number; of: number }) => void,
  of: number
): Promise<{ runId: string; pass: boolean | null; error?: string | null }> {
  const account = await requestAccount();
  let st = await apiCall<ManualStatus>("POST", path(jobId), { runner: account });
  let n = 0;
  for (let guard = 0; guard < 400; guard++) {
    if (st.state === "done") return { runId: st.runId, pass: st.pass, error: st.error };
    if (st.state === "sign") {
      const s = st;
      n++;
      onStep({ phase: "sign", stepId: s.call.stepId, n, of });
      const txHash = await sign(s.network, account, s.call, s.fees);
      onStep({ phase: "submitted", stepId: s.call.stepId, n, of });
      // The tx may take a moment to show up on the node: retry "not found yet".
      for (let i = 0; ; i++) {
        try {
          st = await apiCall<ManualStatus>("POST", path(jobId), s.runId ? { runId: s.runId, txHash } : { token: s.token, txHash });
          break;
        } catch (e) {
          if ((e as { status?: number }).status !== 409 || !/not found/.test(String((e as Error).message)) || i >= 10) throw e;
          await wait(3000);
        }
      }
      continue;
    }
    onStep({ phase: "waiting", n, of });
    await wait(5000);
    st = await apiCall<ManualStatus>("GET", `${path(jobId)}?run=${st.runId}`);
  }
  throw new Error("Still waiting on consensus. The run keeps going; check its history later.");
}
