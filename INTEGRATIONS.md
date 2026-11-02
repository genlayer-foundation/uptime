# INTEGRATIONS

Outward-facing surface of the Heartbeat. Env vars by NAME only.

## Outbound

| To | Transport | Auth | What | Cadence | Degrades to | Where |
|---|---|---|---|---|---|---|
| GenLayer Bradbury RPC (`genlayer-js` `testnetBradbury`) | JSON-RPC | `PRIVATE_KEY` (tx signer, contract owner) | deploy canary, `probe_fetch`, `probe_llm`, `appealTransaction` | hourly tick; appeal every `HEARTBEAT_APPEAL_EVERY` ticks | record `SUBMIT_FAILED` with the error | `frontend/src/lib/heartbeat/runner.ts` (`runTick`, `appeal`) |
| GenLayer Bradbury RPC | JSON-RPC | none | `getTransaction`, `readContract get_probe` | every 10 min | record stays pending; `TIMEOUT` after 6h | `frontend/src/lib/heartbeat/runner.ts` (`runReconcile`) |
| Heartbeat public endpoint `https://uptime.genlayer.foundation/api/heartbeat` (**`next dev` only**) | HTTPS GET | none | proxies `/api/heartbeat` when the dev data source is `production` (`HEARTBEAT_DATA_SOURCE`, `hb-source` cookie or `?source=`); never reachable in a build | per dashboard load / 60s poll, 10s timeout | 502 `{ error, source }`, dashboard shows the unavailable state | `frontend/src/app/api/heartbeat/route.ts` (`proxyProduction`), guard in `frontend/src/lib/heartbeat/source.ts` (`sourceSwitchAllowed`) |
| Upstash Redis | HTTPS REST | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | `hb:pending`, `hb:results`, `hb:tick` | every cron + every API read | cron/API return 500 | `frontend/src/lib/heartbeat/store.ts` |

## Inbound

| From | Route | Auth | What |
|---|---|---|---|
| Vercel Cron | `GET /api/cron/heartbeat` | `Authorization: Bearer $CRON_SECRET` (fail-closed) | submit a tick |
| Vercel Cron | `GET /api/cron/reconcile` | same | grade decided txs, fire appeals |
| Public / Grafana (Infinity) | `GET /api/heartbeat[?hours=N][&format=rows]` | none, read-only | summary JSON, or one row per probe |
| Bradbury validators (inside `probe_fetch` / `probe_llm`) | `GET /heartbeat/{static.json,lighthouse.txt,bakery.txt}` | none | frozen fixtures; base URL set at contract deploy |

## On-chain

| Contract | Network | Address |
|---|---|---|
| `contracts/heartbeat.py` | Bradbury | `HEARTBEAT_CONTRACT` (not yet deployed) |
| `contracts/canary.py` | Bradbury | a new one each tick, address not tracked |
| `contracts/evm/src/UptimePool.sol` (EVM) | Bradbury Phase 2 chain RPC `https://rpc.testnet-chain.genlayer.com` (chain 4221) | `UPTIME_POOL_BRADBURY` (not yet deployed). Users: `deposit`/`topUp`/`withdraw`/`setPaused`/allowances from their own wallets. Scheduler (`RELAYER_KEY_BRADBURY`, role 1) and mailer (`MAILER_KEY`, role 2): `charge`. Admin multisig: spender rotation only. Read: `getPool`, `available`, events. Deploy script `contracts/evm/script/DeployUptimePool.s.sol` (CREATE2 factory `0x4e59…956C`). Not wired into the app yet |
| MetaMask Delegation Framework v1.3.0 + ERC-4337 EntryPoint v0.7 (`contracts/delegation/`) | Bradbury chain 4221, RPC `https://rpc-bradbury.genlayer.com` | canonical CREATE2 addresses (DelegationManager `0xdb9B…7dB3`, NativeTokenPeriodTransferEnforcer `0x9BC0…6BD9`, EntryPoint `0x0000…a032`; full list in `contracts/delegation/README.md`). **Not yet deployed.** Deploy: `contracts/delegation/script/DeployCanonical.s.sol` replays MetaMask's own init code through CREATE2 factory `0x4e59…956C`, signer = forge `--account` keystore (no env var). Verify: `contracts/delegation/script/verify-onchain.sh` (one batched `eth_getCode`). DelegationManager owner (pause only) is MetaMask's `0xb0403…9f44`. Not wired into the app yet |
| `contracts/web_probe.py` | Studio + Bradbury | not yet deployed. `check_url`, `check_api`. Results are filed under the caller, so read them under the relayer's address |
| `contracts/ask.py` | Studio + Bradbury | not yet deployed. `ask`. Results are filed under the caller |

Chain config: `frontend/src/lib/chains.ts` pins the Bradbury Phase 2 addresses (from `genlayerlabs/genlayer-consensus@4e5bacaa` `deployments/bradbury-phase-2.json`, checked against the live AddressManager `0x3F71…38E0`) over the stale `genlayer-js` `testnetBradbury` defaults. Nothing imports it yet. The client to switch is `frontend/src/lib/genlayer/client.ts:2-9`.
