# MetaMask Delegation Framework on Bradbury (chain 4221)

This directory deploys **MetaMask Delegation Framework v1.3.0** and the **ERC-4337 EntryPoint
v0.7** to GenLayer Bradbury. Once deployed, an Uptime user can grant a revocable allowance in
GEN (for example 1 GEN per day through `NativeTokenPeriodTransferEnforcer`) instead of locking
funds in the pool. Every contract lands at the **canonical address it has on the other ~50
chains MetaMask supports**, so MetaMask tooling works without modification.

**Status: deployed on Bradbury (2026-11-06).** All 44 canonical addresses have code
(`script/verify-onchain.sh` → 44 OK). Signed by Ivan in MetaMask through `contracts/evm/sign/`.

## Verdict

| Question | Answer |
|---|---|
| Can it be deployed on 4221? | **Yes.** The deterministic deployer `0x4e59…956C` is on 4221. |
| Same addresses as on every other chain? | **Yes, all 44.** `script/check-manifest.sh` checks this offline. |
| Does EntryPoint v0.7 have to be deployed first? | It isn't on 4221, and it **can be deployed deterministically** to `0x0000000071727De22E5E9d8BAf0edAc6f37da032`. Redemption doesn't need it, but a Hybrid smart account's owner does: actions such as **revoking** go through `handleOps`. So it is deployed first. |
| Who can deploy? | **Any funded EOA.** The sender's address doesn't enter any CREATE2 address. The intended deployer is Ivan's Uptime admin wallet `0x3B49b8ed8b0f59eea6805F87673920f2Fd43Da97`. |
| Cost | **About 0.0004 GEN** (38.9M gas at 0.01 gwei). The wallet already holds far more than this. |
| EIP-7702 on Bradbury | **Unproven, and probably off.** See [EIP-7702](#eip-7702). Hybrid smart accounts don't need it. The MetaMask-wallet (ERC-7715) flow does. |

## How it works: replaying the original deployments, not recompiling

The upstream scripts run `new DelegationManager{salt: "GATOR"}(msg.sender)`. Because the
deployer's address goes into the constructor, a recompile run from a different wallet gives a
**different** DelegationManager address. Every contract that embeds that address moves with
it: the three DeleGator implementations, `LogicalOrWrapperEnforcer` and
`NativeTokenPaymentEnforcer`.

So `manifest/canonical-v1.3.0.json` holds the **exact `salt ‖ initcode` that MetaMask sent to
the CREATE2 deployer**. These were extracted from the upstream repo's own `broadcast/` records
(MetaMask deployer `0xb0403b32f54d0bd752113f4009e8b534c6669f44`). The EntryPoint's creation
bytecode comes from the verified contract on eth.blockscout.com, with salt
`0x90d8…1de3`. `script/DeployCanonical.s.sol` sends each entry to `0x4e59…956C` as-is.

You don't have to trust where the bytes came from. A CREATE2 address is
`keccak(0xff ‖ factory ‖ salt ‖ keccak(initcode))`, so an initcode that produces the canonical
address *is* the canonical bytecode. The script checks this before every send, and
`check-manifest.sh` checks it offline.

How it was cross-checked:

- **Rebuilt from source.** Building upstream tag `v1.3.0` (solc 0.8.23, london) and running the
  upstream deploy scripts on local anvil as `0xb0403…` gave the canonical address for **all 37**
  contracts the tag defines.
- **Six contracts were added after the tag.** `SpecificActionERC20TransferBatchEnforcer` was
  redeployed to `0x6649…`, and `ApprovalRevocationEnforcer` plus four
  `*MultiOperationIncreaseBalanceEnforcer`s were added on upstream `main`. MetaMask still lists
  them under "v1.3.0". They are replayed from MetaMask's broadcasts, which are hash-verified,
  but they were not rebuilt from source here.
- **Checked against the npm package.** `@metamask/delegation-deployments@2.1.0` lists 39
  contracts under `1.3.0`. All 39 are in the manifest. The other 5 entries are the
  `SCL_RIP7212` library (`HybridDeleGatorImpl` links it) and the four MultiOperation enforcers,
  which upstream `documents/Deployments.md` lists but npm doesn't yet.

### Trust note: who owns the DelegationManager

The owner's address is part of the DelegationManager's initcode, so a canonical
DelegationManager is **owned by MetaMask's `0xb0403…`** on 4221, as it is on every other chain.
The owner can only `pause()` and `unpause()` `redeemDelegations`, an emergency stop. It can't
move funds or change delegations. The alternative is our own instance with a GenLayer owner.
That would put every address off-canonical, and every consumer would have to override them.
That trade isn't worth it.

## Addresses: computed vs canonical

Every row was computed from the manifest and **matches**. They were deployed on the anvil fork
from `0x3B49…Da97`, and the batched `eth_getCode` check passed for all 44.

| # | Contract | Canonical address = computed |
|---|---|---|
| 1 | EntryPoint (v0.7) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| 2 | SCL_RIP7212 (library) | `0xCCD3B747F3DBd349fa3af4eBC7d0C31aE6f21dd1` |
| 3 | SimpleFactory | `0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c` |
| 4 | DelegationManager | `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` |
| 5 | MultiSigDeleGatorImpl | `0x56a9EdB16a0105eb5a4C54f4C062e2868844f3A7` |
| 6 | HybridDeleGatorImpl | `0x48dBe696A4D990079e039489bA2053B36E8FFEC4` |
| 7 | EIP7702StatelessDeleGatorImpl | `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B` |
| 8 | AllowedCalldataEnforcer | `0xc2b0d624c1c4319760C96503BA27C347F3260f55` |
| 9 | AllowedMethodsEnforcer | `0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5` |
| 10 | AllowedTargetsEnforcer | `0x7F20f61b1f09b08D970938F6fa563634d65c4EeB` |
| 11 | BlockNumberEnforcer | `0x5d9818dF0AE3f66e9c3D0c5029DAF99d1823ca6c` |
| 12 | DeployedEnforcer | `0x24ff2AA430D53a8CD6788018E902E098083dcCd2` |
| 13 | ERC20BalanceChangeEnforcer | `0xcdF6aB796408598Cea671d79506d7D48E97a5437` |
| 14 | ERC20TransferAmountEnforcer | `0xf100b0819427117EcF76Ed94B358B1A5b5C6D2Fc` |
| 15 | ERC20PeriodTransferEnforcer | `0x474e3Ae7E169e940607cC624Da8A15Eb120139aB` |
| 16 | ERC20StreamingEnforcer | `0x56c97aE02f233B29fa03502Ecc0457266d9be00e` |
| 17 | ERC721BalanceChangeEnforcer | `0x8aFdf96eDBbe7e1eD3f5Cd89C7E084841e12A09e` |
| 18 | ERC721TransferEnforcer | `0x3790e6B7233f779b09DA74C72b6e94813925b9aF` |
| 19 | ERC1155BalanceChangeEnforcer | `0x63c322732695cAFbbD488Fc6937A0A7B66fC001A` |
| 20 | ExactCalldataBatchEnforcer | `0x982FD5C86BBF425d7d1451f974192d4525113DfD` |
| 21 | ExactCalldataEnforcer | `0x99F2e9bF15ce5eC84685604836F71aB835DBBdED` |
| 22 | ExactExecutionBatchEnforcer | `0x1e141e455d08721Dd5BCDA1BaA6Ea5633Afd5017` |
| 23 | ExactExecutionEnforcer | `0x146713078D39eCC1F5338309c28405ccf85Abfbb` |
| 24 | IdEnforcer | `0xC8B5D93463c893401094cc70e66A206fb5987997` |
| 25 | LogicalOrWrapperEnforcer | `0xE1302607a3251AF54c3a6e69318d6aa07F5eB46c` |
| 26 | LimitedCallsEnforcer | `0x04658B29F6b82ed55274221a06Fc97D318E25416` |
| 27 | MultiTokenPeriodEnforcer | `0xFB2f1a9BD76d3701B730E5d69C3219D42D80eBb7` |
| 28 | NativeBalanceChangeEnforcer | `0xbD7B277507723490Cd50b12EaaFe87C616be6880` |
| 29 | ArgsEqualityCheckEnforcer | `0x44B8C6ae3C304213c3e298495e12497Ed3E56E41` |
| 30 | NativeTokenPaymentEnforcer | `0x4803a326ddED6dDBc60e659e5ed12d85c7582811` |
| 31 | NativeTokenTransferAmountEnforcer | `0xF71af580b9c3078fbc2BBF16FbB8EEd82b330320` |
| 32 | NativeTokenStreamingEnforcer | `0xD10b97905a320b13a0608f7E9cC506b56747df19` |
| 33 | **NativeTokenPeriodTransferEnforcer** | `0x9BC0FAf4Aca5AE429F4c06aEEaC517520CB16BD9` |
| 34 | NonceEnforcer | `0xDE4f2FAC4B3D87A1d9953Ca5FC09FCa7F366254f` |
| 35 | OwnershipTransferEnforcer | `0x7EEf9734E7092032B5C56310Eb9BbD1f4A524681` |
| 36 | RedeemerEnforcer | `0xE144b0b2618071B4E56f746313528a669c7E65c5` |
| 37 | SpecificActionERC20TransferBatchEnforcer | `0x6649b61c873F6F9686A1E1ae9ee98aC380c7bA13` |
| 38 | TimestampEnforcer | `0x1046bb45C8d673d4ea75321280DB34899413c069` |
| 39 | ValueLteEnforcer | `0x92Bf12322527cAA612fd31a0e810472BBB106A8F` |
| 40 | ERC20MultiOperationIncreaseBalanceEnforcer | `0xeaA1bE91F0ea417820a765df9C5BE542286BFfDC` |
| 41 | ERC721MultiOperationIncreaseBalanceEnforcer | `0x44877cDAFC0d529ab144bb6B0e202eE377C90229` |
| 42 | ERC1155MultiOperationIncreaseBalanceEnforcer | `0x9eB86bbdaA71D4D8d5Fb1B8A9457F04D3344797b` |
| 43 | NativeTokenMultiOperationIncreaseBalanceEnforcer | `0xaD551E9b971C1b0c02c577bFfCFAA20b81777276` |
| 44 | ApprovalRevocationEnforcer | `0xe264F1f09A19505a1ca1a86D5b01E8bFdb64324A` |

## Fork dry run (2026-11-02, Bradbury block 208259)

- **Deploy:** 44 of 44 deployed from `0x3B49…Da97`, all with receipt status 1.
- **Smoke test** (`test/ForkSmoke.t.sol`), **3 of 3 passing**. Both account types run the
  same scenario:
  - A delegator grants an "Uptime" delegate an allowance of 1 GEN per day through
    `NativeTokenPeriodTransferEnforcer`.
  - The delegate redeems 0.6 GEN, which succeeds.
  - It tries another 0.6 GEN and is refused with `transfer-amount-exceeded`.
  - It redeems 0.4 GEN, which brings the remaining allowance to 0.
  - After one day it redeems 0.6 GEN again, which succeeds.
  - A different address tries to redeem and is refused with `InvalidDelegate`.
  - The delegator revokes, and the next redeem is refused with `CannotUseADisabledDelegation`.

  The two account types:
  - **Hybrid smart account:** an ERC1967Proxy to `HybridDeleGatorImpl`, created through
    `SimpleFactory`. The owner signs with ECDSA, which the account checks through ERC-1271. It
    revokes with a userOp through EntryPoint v0.7 `handleOps`, with the owner acting as its own
    bundler.
  - **EIP-7702 EOA:** an EOA upgraded in place to `EIP7702StatelessDeleGatorImpl`. It revokes
    by calling itself.
- **Real type-4 transaction on the fork:** `cast send <eoa> --auth 0x63c0…E32B` was mined as
  type `0x4`, status 1, using 36,844 gas. Afterwards the EOA's code was
  `0xef0100‖0x63c0…E32B`, and calls to it reach the delegator.
  **Caveat:** anvil runs revm, not Nitro. This shows the bytecode works with 7702. It does
  **not** show that Bradbury accepts type-4 transactions.

## Gas and funding

| | |
|---|---|
| Gas used on the fork (44 transactions) | **38,267,314**. The largest single transaction is 4.47M, under Nitro's default 32M per-transaction limit. |
| Nitro adjustment | Real `eth_estimateGas` for the DelegationManager deploy is 2,641,304, vs 2,597,734 on anvil (**+1.7%**, the parent-chain data component). |
| Estimated real total | about **38.9M gas** |
| Current base fee (`eth_gasPrice`, 2026-11-02) | **0.01 gwei** (10,000,000 wei) |
| **GEN needed** | **about 0.0004 GEN**. forge's padded worst case is 0.0011 GEN at 0.02 gwei. **Hold at least 0.01 GEN.** |
| Deployer balance (`0x3B49…Da97`, real chain, read through the fork) | 1,000,000 GEN, nonce 0. No funding needed. |

## Real deploy (Ivan)

Prerequisites: Foundry 1.5 or later, and the wallet imported as a keystore
(`cast wallet import ivan --interactive`). Never pass a raw private key.

```bash
cd contracts/delegation

# 0. offline: every manifest entry hashes to its canonical address (no RPC)
script/check-manifest.sh

# 1. dry run on a fork (one fork session; anvil caches it)
anvil --fork-url https://rpc-bradbury.genlayer.com --chain-id 4221 \
      --retries 12 --fork-retry-backoff 3000 &
forge script script/DeployCanonical.s.sol --rpc-url fork \
      --unlocked --sender 0x3B49b8ed8b0f59eea6805F87673920f2Fd43Da97 --broadcast --slow
forge test --fork-url http://127.0.0.1:8545 -vv          # 3 passing
script/verify-onchain.sh http://127.0.0.1:8545           # 44 OK
kill %1

# 2. REAL deploy to Bradbury (sends 44 transactions)
forge script script/DeployCanonical.s.sol --rpc-url bradbury \
      --account ivan --sender 0x3B49b8ed8b0f59eea6805F87673920f2Fd43Da97 \
      --broadcast --slow

# 3. verify: one batched eth_getCode for every address
script/verify-onchain.sh                                   # expect 44 OK, chainId 4221
```

- **The script is idempotent.** It skips any address that already has code. If the public RPC
  rate-limits partway through (about 45 calls, and a broadcast plus receipt polling makes more),
  wait a minute and run the same command again. It picks up where it stopped. A private RPC
  avoids the problem entirely.
- **Front-running can't hurt.** If anyone deploys one of these contracts first, the bytecode at
  that address is still byte-identical, and the script skips it.
- **`--rpc-url bradbury`** resolves to `https://rpc-bradbury.genlayer.com` in `foundry.toml`.
  `contracts/evm` uses `https://rpc.testnet-chain.genlayer.com` for the same chain. Only the
  former was used and verified here.
- **Verify by hand** if you prefer:
  `cast code 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3 --rpc-url bradbury` must not return
  `0x`. Also `cast call 0xdb9B…7dB3 'owner()(address)' --rpc-url bradbury` should return
  `0xB0403B32f54d0Bd752113f4009e8B534C6669f44`.

## EIP-7702

- **On the fork:** it works, both through the forge cheatcode and with a real type-4
  transaction (see above).
- **On real Bradbury (read-only probe):** `eth_estimateGas` for a type-4 request with one
  signed authorization returned **21,000**. That is the cost of a plain transfer. The same
  request on the fork returns **46,055**, which includes the 25,000 cost per authorization. So
  the node accepted the request and **ignored the authorization list**. That points to 7702
  being off on Bradbury, or to Nitro's estimator dropping the list. It isn't proof either way.
- **Definitive test** (costs a fraction of a cent, Ivan to run): from a throwaway EOA, after the
  deploy, run `cast send <eoa> --auth 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B --private-key …
  --rpc-url bradbury`, then `cast code <eoa>`. If 7702 is active, the code is
  `0xef0100…`. If it isn't, the transaction is rejected, or the code stays `0x`.
- **Without 7702:** Hybrid and MultiSig smart accounts still work fully, and Uptime can build on
  them. MetaMask's wallet-native flow (ERC-7715 `wallet_requestExecutionPermissions`) upgrades
  the user's EOA through 7702, so it won't work on 4221 until ArbOS 61-level 7702 is confirmed
  live.

## Using it from Uptime before MetaMask lists the chain

`@metamask/smart-accounts-kit` (2.0.0) exports `overrideDeployedEnvironment`. Uptime can
register chain 4221 with the canonical v1.3.0 addresses listed above without waiting for a
package release. There is **no ERC-4337 bundler** on 4221. Either the owner submits
`handleOps` itself, as the smoke test does, or the Uptime relayer does.

## Ask for MetaMask

> GenLayer Bradbury (chain 4221, Arbitrum Nitro, native token GEN,
> RPC `https://rpc-bradbury.genlayer.com`) now runs Delegation Framework v1.3.0 and EntryPoint
> v0.7 at the canonical addresses. These are byte-identical replays of your own CREATE2
> deployments from `0xb0403…`, so the DelegationManager is owned by your key, as on every other
> chain. Could you:
> 1. add 4221 to `@metamask/delegation-deployments` / smart-accounts-kit `CHAIN_ID` and
>    `DELEGATOR_CONTRACTS["1.3.0"]`, the same kind of PR as the Arc and Robinhood additions;
> 2. enable ERC-7715 Advanced Permissions (`wallet_requestExecutionPermissions`, native-token
>    periodic permission) for 4221 in MetaMask, once we confirm EIP-7702 is live on the chain;
> 3. tell us if you'd rather run the deployment from `0xb0403…` yourselves. The result is
>    identical.

## Files

| Path | What |
|---|---|
| `manifest/canonical-v1.3.0.json` | 44 entries: `{name, address, salt, initcode, source}`. `source` records the upstream chain and commit each entry was taken from. |
| `script/DeployCanonical.s.sol` | Idempotent replay through `0x4e59…956C`. Checks each address before and after sending. |
| `script/check-manifest.sh` | Offline CREATE2 check of every entry. |
| `script/verify-onchain.sh` | One batched `eth_getCode` request for all 44 addresses. |
| `test/ForkSmoke.t.sol`, `test/Interfaces.sol` | The fork smoke test, written against hand-written minimal ABIs, so no upstream source is vendored. Skips itself if the contracts aren't deployed. |
| `test/fixtures/ERC1967Proxy.creation.hex` | OpenZeppelin 5.0.2 `ERC1967Proxy` creation code, as built by upstream v1.3.0. |

## License

The bytecode in the manifest and the proxy fixture are compiled from
[MetaMask/delegation-framework](https://github.com/MetaMask/delegation-framework), which is
dual-licensed **MIT AND Apache-2.0** (Copyright 2022 ConsenSys Software Inc.). They include
OpenZeppelin Contracts (MIT), eth-infinitism account-abstraction v0.7.0 (GPL-3.0, for the
EntryPoint only), and the SCL/FreshCryptoLib libraries (MIT). See `NOTICE`. The scripts and
tests in this directory are MIT.
