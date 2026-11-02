// Browser wallet (EIP-1193, e.g. MetaMask) for SIWE sign-in and the UptimePool.
// No wallet SDK: viem over the injected provider. The pool lives on the plain
// EVM side of Bradbury Phase 2 (chain 4221), so the wallet is switched there
// before any pool transaction.

import { createPublicClient, createWalletClient, custom, defineChain, http, type Address } from "viem";
import { BRADBURY_PHASE2 } from "@/lib/chains";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
  removeListener?(event: string, cb: (...a: unknown[]) => void): void;
};

export const bradburyEvm = defineChain({
  id: BRADBURY_PHASE2.chainId,
  name: "GenLayer Bradbury",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [BRADBURY_PHASE2.chainRpc] } },
  blockExplorers: { default: { name: "GenLayer Chain Explorer", url: BRADBURY_PHASE2.chainExplorer } },
  testnet: true,
});

export function injected(): Eip1193 | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum;
}

export async function requestAccount(): Promise<Address> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found. Install MetaMask or another EIP-1193 wallet.");
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) throw new Error("The wallet returned no account.");
  return accounts[0] as Address;
}

export async function signMessage(address: Address, message: string): Promise<`0x${string}`> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found.");
  const wc = createWalletClient({ transport: custom(eth) });
  return wc.signMessage({ account: address, message });
}

/** Switch the wallet to Bradbury (adding the network if the wallet lacks it). */
export async function ensureBradbury(): Promise<void> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found.");
  const hexId = `0x${bradburyEvm.id.toString(16)}`;
  const current = (await eth.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === hexId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    if ((e as { code?: number })?.code !== 4902) throw e;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: bradburyEvm.name,
          nativeCurrency: bradburyEvm.nativeCurrency,
          rpcUrls: bradburyEvm.rpcUrls.default.http,
          blockExplorerUrls: [BRADBURY_PHASE2.chainExplorer],
        },
      ],
    });
  }
}

export function walletClient() {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found.");
  return createWalletClient({ chain: bradburyEvm, transport: custom(eth) });
}

export const publicClient = createPublicClient({ chain: bradburyEvm, transport: http() });

export function onAccountsChanged(cb: (accounts: string[]) => void): () => void {
  const eth = injected();
  if (!eth?.on) return () => {};
  const h = (a: unknown) => cb((a as string[]) ?? []);
  eth.on("accountsChanged", h);
  return () => eth.removeListener?.("accountsChanged", h);
}
