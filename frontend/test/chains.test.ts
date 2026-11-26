import { describe, expect, it } from "vitest";
import { testnetBradbury } from "genlayer-js/chains";
import { BRADBURY, bradburyChain, CHAINS } from "@/lib/chains";

// Deployments on the Bradbury rollup share a chain id and differ only by
// address, so one address left at the SDK default sends that call to another
// deployment without any error.
describe("Bradbury chain config", () => {
  const overridden = {
    consensusMainContract: BRADBURY.contracts.consensusMain,
    consensusDataContract: BRADBURY.contracts.consensusData,
    stakingContract: BRADBURY.contracts.staking,
    feeManagerContract: BRADBURY.contracts.feeManager,
    roundsStorageContract: BRADBURY.contracts.roundsStorage,
    appealsContract: BRADBURY.contracts.appeals,
  } as const;

  it("overrides every contract address the SDK chain carries", () => {
    const sdkContracts = Object.entries(testnetBradbury)
      .filter(([, v]) => v && typeof v === "object" && "address" in v)
      .map(([k]) => k)
      .sort();
    expect(sdkContracts).toEqual(Object.keys(overridden).sort());
    for (const [k, address] of Object.entries(overridden)) {
      expect((bradburyChain as unknown as Record<string, { address: string }>)[k].address).toBe(address);
    }
  });

  it("is Bradbury Phase 3 on chain 4221", () => {
    expect(bradburyChain.id).toBe(4221);
    expect(bradburyChain.name).toBe("GenLayer Bradbury Phase 3");
    expect(BRADBURY.contracts.addressManager).toBe("0x0192C6C9482251790965B7136352B26234d81d79");
    expect(BRADBURY.contracts.consensusMain).toBe("0x0f4F0e05475723790E4a2ed0598370783C300926");
    expect(CHAINS.bradbury.chain).toBe(bradburyChain);
  });
});
