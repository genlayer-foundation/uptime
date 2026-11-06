# Bradbury deploy signer (local only)

**NOT AUDITED — TESTNET ONLY.** A static page that deploys two things to GenLayer Bradbury
(chain 4221). You sign every transaction in MetaMask; the page never touches a key.

```bash
python3 -m http.server 8799 --bind 127.0.0.1 --directory contracts/evm/sign
```

Then open http://127.0.0.1:8799/ and click **Connect MetaMask**. The page switches the wallet to
4221, adding the network first if MetaMask doesn't have it.

1. **UptimePool: 1 signature.** CREATE2 through `0x4e59…956C` with the same calldata as
   `script/DeployUptimePool.s.sol`: admin = the connected account, rotationDelay 0,
   scheduler `0xDcA4…84dd`, salt 0. Mailer defaults to zero because the constructor reverts
   when scheduler == mailer (`SpenderHasRole`).
2. **Delegation Framework v1.3.0 + EntryPoint v0.7: up to 44 signatures.** The canonical replay
   from `../../delegation/manifest/canonical-v1.3.0.json`, same as `DeployCanonical.s.sol`.
   Contracts that already have code are skipped. The txs go out one at a time, and each one
   waits for its receipt and checks the code. You can reload at any point: progress is read
   back from the chain, and a stored tx hash is waited on, never sent a second time.
3. **Set mailer: 2 signatures.** For the deployed pool (default the live
   `0x5ea3…1d0A`): `proposeSpender(2, mailer)`, then `executeSpender(2)` (rotationDelay is 0 on
   the live pool). Admin only; refuses the scheduler's address (`SpenderHasRole`).

Before every MetaMask prompt the page runs `eth_estimateGas` on Bradbury and sets the gas to the
estimate + 30% + 100k (no cap). It also shows a one-line summary of the tx.

Files: `lib.js` (all tx logic), `app.js` (UI), `data.js` (GENERATED initcode + manifest).

```bash
(cd contracts/evm && forge build) && node contracts/evm/sign/build-data.mjs   # regenerate data.js
node contracts/evm/sign/check.mjs estimate        # Bradbury, read-only: addresses + gas estimates
anvil --fork-url https://rpc.testnet-chain.genlayer.com --chain-id 4221 &
node contracts/evm/sign/check.mjs fork http://127.0.0.1:8545   # full flow on the fork (lib.js)
# full flow through the page UI on the fork, with a MetaMask stand-in that uses anvil's account 0:
#   open http://127.0.0.1:8799/fork-test.html ; the title shows RESULT {...} when it's done
```
