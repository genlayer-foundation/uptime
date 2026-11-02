# INTEGRATIONS

Outward-facing surface of the Heartbeat. Env vars by NAME only.

## Outbound

| To | Transport | Auth | What | Cadence | Degrades to | Where |
|---|---|---|---|---|---|---|
| GenLayer Bradbury RPC (`genlayer-js` `testnetBradbury`) | JSON-RPC | `PRIVATE_KEY` (tx signer, contract owner) | deploy canary, `probe_fetch`, `probe_llm`, `appealTransaction` | hourly tick; appeal every `HEARTBEAT_APPEAL_EVERY` ticks | record `SUBMIT_FAILED` with the error | `frontend/src/lib/heartbeat/runner.ts` (`runTick`, `appeal`) |
| GenLayer Bradbury RPC | JSON-RPC | none | `getTransaction`, `readContract get_probe` | every 10 min | record stays pending; `TIMEOUT` after 6h | `frontend/src/lib/heartbeat/runner.ts` (`runReconcile`) |
| Heartbeat public endpoint `https://uptime.genlayer.foundation/api/heartbeat` (**`next dev` only**) | HTTPS GET | none | proxies `/api/heartbeat` when the dev data source is `production` (`HEARTBEAT_DATA_SOURCE`, `hb-source` cookie or `?source=`); never reachable in a build | per dashboard load / 60s poll, 10s timeout | 502 `{ error, source }`, dashboard shows the unavailable state | `frontend/src/app/api/heartbeat/route.ts` (`proxyProduction`), guard in `frontend/src/lib/heartbeat/source.ts` (`sourceSwitchAllowed`) |
| Upstash Redis | HTTPS REST | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | `hb:pending`, `hb:results`, `hb:tick` | every cron + every API read | cron/API return 500 | `frontend/src/lib/heartbeat/store.ts` |
| Postmark email API `https://api.postmarkapp.com` (override `MAILER_API_BASE`) | HTTPS JSON | `X-Postmark-Server-Token` from `MAILER_PROVIDER_TOKEN` | `POST /email` (job-failure alert, address confirmation) on stream `MAILER_STREAM` (default `outbound`); `GET /message-streams/{stream}/suppressions/dump` (bounce sweep) | per failed run that passes the send policy; per added address; sweep on each call of `/api/alerts/bounces` | **off unless `MAILER_ENABLED`** and armed (`MAILER_PROVIDER=postmark`, token, `MAILER_FROM`, `MAILER_TOKEN_SECRET`, `MAILER_PUBLIC_URL`). A failed send is recorded `failed`, never retried | `frontend/src/lib/mailer/provider.ts:41` (`postmarkProvider`) |
| UptimePool on Bradbury Phase 2 EVM (`BRADBURY_EVM_RPC`, default `https://rpc.testnet-chain.genlayer.com`) | JSON-RPC | `MAILER_KEY` (spender role 2) | `getPool` owner check, `eth_call` simulation of `charge([poolId],[MAILER_EMAIL_PRICE_WEI],emailId)`, then the tx; the email is sent only if the receipt has a matching `Charged` event (`ChargeSkipped` or anything else = refused, not sent) | once per Bradbury alert email, before sending | no charge = no email (`refused`). Chain id pinned to 4221 | `frontend/src/lib/mailer/charger.ts:141` (`evmPoolCharger`), `:109` (`interpretChargeLogs`) |

## Inbound

| From | Route | Auth | What |
|---|---|---|---|
| Vercel Cron | `GET /api/cron/heartbeat` | `Authorization: Bearer $CRON_SECRET` (fail-closed) | submit a tick |
| Vercel Cron | `GET /api/cron/reconcile` | same | grade decided txs, fire appeals |
| Public / Grafana (Infinity) | `GET /api/heartbeat[?hours=N][&format=rows]` | none, read-only | summary JSON, or one row per probe |
| Bradbury validators (inside `probe_fetch` / `probe_llm`) | `GET /heartbeat/{static.json,lighthouse.txt,bakery.txt}` | none | frozen fixtures; base URL set at contract deploy |
| Signed-in owners (SIWE cookie `uptime_session`, `SESSION_SECRET`) | `GET`/`POST /api/alerts/recipients`, `DELETE /api/alerts/recipients/{id}` | session; 503 unless `MAILER_ENABLED` and wired | list / add (sends one confirmation email; max 3 per wallet) / remove alert addresses |
| Signed-in owners | `GET`/`PUT /api/alerts/jobs/{jobId}` | session + job owner (backend `jobOwner` lookup; 503 without it) | which confirmed addresses get a job's alerts, `failAfter` |
| Email recipients (link in the confirmation mail) | `GET`/`POST /api/alerts/verify?r&x&t` | HMAC token (`MAILER_TOKEN_SECRET`), bound to row + address + wallet, 24 h expiry | GET shows a button, POST confirms |
| Email recipients / mail clients (RFC 8058 one-click) | `GET`/`POST /api/alerts/unsubscribe?e&t` | HMAC token per address (`MAILER_TOKEN_SECRET`) | POST adds the address to the suppression list; identical answer whatever the token |
| Cron (not scheduled yet) | `GET /api/alerts/bounces` | `Authorization: Bearer $CRON_SECRET` (fail-closed) | merge the provider's suppression list into ours |
| Scheduler (in-process) | `notifyRunFailed(job, run, { consecutiveFailures })` from `@/lib/mailer` | n/a | evaluate the send policy for a decided run; never throws. Inert until `configureMailer({ repo, studioAllowed, jobOwner })` |

## On-chain

| Contract | Network | Address |
|---|---|---|
| `contracts/heartbeat.py` | Bradbury | `HEARTBEAT_CONTRACT` (not yet deployed) |
| `contracts/canary.py` | Bradbury | a new one each tick, address not tracked |
| `contracts/evm/src/UptimePool.sol` (EVM) | Bradbury Phase 2 chain RPC `https://rpc.testnet-chain.genlayer.com` (chain 4221) | `UPTIME_POOL_BRADBURY` (not yet deployed). Users: `deposit`/`topUp`/`withdraw`/`setPaused`/allowances from their own wallets. Scheduler (`RELAYER_KEY_BRADBURY`, role 1) and mailer (`MAILER_KEY`, role 2): `charge`. Admin multisig: spender rotation only. Read: `getPool`, `available`, events. Deploy script `contracts/evm/script/DeployUptimePool.s.sol` (CREATE2 factory `0x4e59…956C`). Not wired into the app yet |
| `contracts/web_probe.py` | Studio + Bradbury | not yet deployed. `check_url`, `check_api`. Results are filed under the caller, so read them under the relayer's address |
| `contracts/ask.py` | Studio + Bradbury | not yet deployed. `ask`. Results are filed under the caller |

Chain config: `frontend/src/lib/chains.ts` pins the Bradbury Phase 2 addresses (from `genlayerlabs/genlayer-consensus@4e5bacaa` `deployments/bradbury-phase-2.json`, checked against the live AddressManager `0x3F71…38E0`) over the stale `genlayer-js` `testnetBradbury` defaults. Nothing imports it yet. The client to switch is `frontend/src/lib/genlayer/client.ts:2-9`.

## Mailer env vars (names only)

`MAILER_ENABLED` (master switch, default off) · `MAILER_PROVIDER` (`postmark`, else nothing is sent) · `MAILER_PROVIDER_TOKEN` · `MAILER_FROM` · `MAILER_FROM_NAME` · `MAILER_REPLY_TO` · `MAILER_STREAM` · `MAILER_API_BASE` · `MAILER_PUBLIC_URL` (base for links) · `MAILER_TOKEN_SECRET` (>= 32 chars) · `MAILER_KEY` · `MAILER_EMAIL_PRICE_WEI` · `UPTIME_POOL_BRADBURY` (or `NEXT_PUBLIC_UPTIME_POOL_BRADBURY`) · `BRADBURY_EVM_RPC` · limits: `MAILER_JOB_COOLDOWN_MIN` (15), `MAILER_MAX_PER_JOB_DAY` (12), `MAILER_RECIPIENT_COOLDOWN_MIN` (10), `MAILER_MAX_PER_RECIPIENT_DAY` (20), `MAILER_GLOBAL_DAILY_CEILING` (500), `MAILER_STUDIO_DAILY_QUOTA` (20). Read at call time: `frontend/src/lib/mailer/config.ts`. Tables: `frontend/migrations/010_alerts.sql`.
