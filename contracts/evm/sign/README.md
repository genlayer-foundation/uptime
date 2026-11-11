# Bradbury deploy signer (local only)

**NOT AUDITED — TESTNET ONLY.** A static page that creates the admin Safe and deploys three things to
GenLayer Bradbury (chain 4221). You sign every transaction in MetaMask; the page never touches a key.

```bash
node contracts/evm/sign/serve.mjs      # http://127.0.0.1:8799/  (PORT=… for another port; Ctrl-C to stop)
```

Use `serve.mjs`, not `python3 -m http.server`: it answers every request with
`Cache-Control: no-store`. The page also loads `app.js`, `lib.js` and `data.js` with a fresh query
string on every load, so a cached module cannot be served by any server (a stale cached `data.js`
once blocked a deploy). The v2 section prints the keccak256 of the creation code it will deploy;
`node contracts/evm/sign/build-data.mjs --check` prints the one the current forge build gives.
They must be equal.

Then open http://127.0.0.1:8799/ and click **Connect MetaMask**. The page switches the wallet to
4221, adding the network first if MetaMask doesn't have it.

0. **Admin Safe: 1 signature.** Creates the multisig that will be the v2 pool's admin
   (PRODUCT.md D11) through Safe's own proxy factory, already on 4221:
   `createProxyWithNonce(singleton, setup(owners, threshold, …), saltNonce)`. Inputs: Safe version
   (1.4.1 by default), owners (one per line), threshold, saltNonce. A plain Safe: no modules, no
   payment, the standard fallback handler. The address is computed before anything is sent and
   checked against the chain afterwards (code present, same owners and threshold). Any account
   can send it. Safe contracts on 4221 (eth_getCode + `VERSION()`, 2026-11-10):

   | | 1.4.1 | 1.3.0 (canonical) |
   |---|---|---|
   | proxy factory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | `0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2` |
   | singleton (L2, used here) | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` |
   | singleton (L1) | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552` |
   | fallback handler | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` | `0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4` |

   The 1.3.0 EIP-155 set (`0xC228…10BC` factory) and both versions' MultiSend, MultiSendCallOnly,
   SignMessageLib, CreateCall and SimulateTxAccessor have code too.
1. **UptimePool (v1): 1 signature.** CREATE2 through `0x4e59…956C` with the same calldata as
   `script/DeployUptimePool.s.sol`: admin = the connected account, rotationDelay 0,
   scheduler `0xDcA4…84dd`, salt 0. Mailer defaults to zero because the constructor reverts
   when scheduler == mailer (`SpenderHasRole`). Already deployed (`0x5ea3…1d0A`).
1b. **UptimePool v2 (community pools): 1 signature.** CREATE2 through `0x4e59…956C` with the
   same calldata as `script/DeployUptimePoolV2.s.sol`. Defaults: admin = the Safe from section 0
   (the page refuses an address that is not a deployed Safe), rotationDelay 172800 (48 hours, the
   contract's minimum: a shorter one reverts `InvalidRotationDelay`), scheduler `0xDcA4…84dd`,
   mailer `0xb696…4774`, salt 0. Both spenders are set by the constructor, with no wait; it is
   the only time that is possible, so a role left zero here costs a 48-hour rotation later.
   Admin, scheduler and mailer must be three different addresses. The address depends on the
   Safe, so it is shown once the admin is filled in. v1 stays live; the app moves to v2 only
   when `UPTIME_POOL_V2_BRADBURY` is set to the new address. The first v2
   (`0xcEb88f1f41AE2a12f50330C8c474C640D71dF355`, admin a plain wallet, rotationDelay 0, share
   math that could brick top-ups) is superseded.
2. **Delegation Framework v1.3.0 + EntryPoint v0.7: up to 44 signatures.** The canonical replay
   from `../../delegation/manifest/canonical-v1.3.0.json`, same as `DeployCanonical.s.sol`.
   Contracts that already have code are skipped. The txs go out one at a time, and each one
   waits for its receipt and checks the code. You can reload at any point: progress is read
   back from the chain, and a stored tx hash is waited on, never sent a second time.
3. **Set mailer: 2 signatures.** For a pool whose admin is the connected wallet (default the live
   v1 `0x5ea3…1d0A`): `proposeSpender(2, mailer)`, then `executeSpender(2)` (rotationDelay is 0 on
   v1). Admin only; refuses the scheduler's address (`SpenderHasRole`). It cannot change a pool
   whose admin is a Safe (see below).

**Rotating a spender on v2 later.** Both calls must come from the Safe: `proposeSpender(role,
address)`, wait rotationDelay, `executeSpender(role)`; `cancelSpender(role)` drops a pending one.
This page has no section for Safe transactions yet. Without Safe's web app (not known to serve
chain 4221), a Safe transaction is: each signing owner calls `approveHash(hash)` on the Safe,
where `hash = getTransactionHash(pool, 0, calldata, 0, 0, 0, 0, 0x0, 0x0, nonce())`, then anyone
calls `execTransaction(pool, 0, calldata, 0, 0, 0, 0, 0x0, 0x0, signatures)` with, per approving
owner in ascending address order, `owner (32 bytes) ++ 0 (32 bytes) ++ 0x01`. Checked on an anvil
fork with a 2-of-3 Safe 1.4.1: propose, execute refused before 48 h, execute accepted after.

Before every MetaMask prompt the page runs `eth_estimateGas` on Bradbury and sets the gas to the
estimate + 30% + 100k (no cap). It also shows a one-line summary of the tx.

Files: `lib.js` (all tx logic), `app.js` (UI), `data.js` (GENERATED initcode + manifest),
`serve.mjs` (no-cache local server), `check.mjs` + `fork-test.html` (checks, below).

```bash
(cd contracts/evm && forge build) && node contracts/evm/sign/build-data.mjs   # regenerate data.js
node contracts/evm/sign/build-data.mjs --check    # exit 1 if data.js is stale; prints the v2 creation code hash
node contracts/evm/sign/check.mjs estimate        # Bradbury, read-only: Safe contracts, addresses + gas estimates
anvil --fork-url https://rpc.testnet-chain.genlayer.com --chain-id 4221 &
node contracts/evm/sign/check.mjs fork http://127.0.0.1:8545         # full flow on the fork (lib.js): Safe, v2, v1, delegation
node contracts/evm/sign/check.mjs fork http://127.0.0.1:8545 quick   # Safe + pools only
# the same through the page UI on the fork, with a MetaMask stand-in that uses anvil's account 0:
#   open http://127.0.0.1:8799/fork-test.html?flow=v2 ; the title shows RESULT {...} (or FAILED ...)
```
