# INTEGRATIONS

Outward-facing surface of the Heartbeat. Env vars by NAME only.

## Outbound

| To | Transport | Auth | What | Cadence | Degrades to | Where |
|---|---|---|---|---|---|---|
| GenLayer Bradbury RPC (`genlayer-js` `testnetBradbury`) | JSON-RPC | `PRIVATE_KEY` (tx signer, contract owner) | deploy canary, `probe_fetch`, `probe_llm`, `appealTransaction` | hourly tick; appeal every `HEARTBEAT_APPEAL_EVERY` ticks | record `SUBMIT_FAILED` with the error | `frontend/src/lib/heartbeat/runner.ts` (`runTick`, `appeal`) |
| GenLayer Bradbury RPC | JSON-RPC | none | `getTransaction`, `readContract get_probe` | every 10 min | record stays pending; `TIMEOUT` after 6h | `frontend/src/lib/heartbeat/runner.ts` (`runReconcile`) |
| Heartbeat public endpoint `https://uptime.genlayer.foundation/api/heartbeat` (**`next dev` only**) | HTTPS GET | none | proxies `/api/heartbeat` when the dev data source is `production` (`HEARTBEAT_DATA_SOURCE`, `hb-source` cookie or `?source=`); never reachable in a build | per dashboard load / 60s poll, 10s timeout | 502 `{ error, source }`, dashboard shows the unavailable state | `frontend/src/app/api/heartbeat/route.ts` (`proxyProduction`), guard in `frontend/src/lib/heartbeat/source.ts` (`sourceSwitchAllowed`) |
| Upstash Redis | HTTPS REST | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | `hb:pending`, `hb:results`, `hb:tick` | every cron + every API read | cron/API return 500 | `frontend/src/lib/heartbeat/store.ts` |
| Postmark email API `https://api.postmarkapp.com` (override `MAILER_API_BASE`) | HTTPS JSON | `X-Postmark-Server-Token` from `MAILER_PROVIDER_TOKEN` | `POST /email` (failure / assertion / recovery alert, daily digest, address confirmation) on stream `MAILER_STREAM` (default `outbound`); `GET /message-streams/{stream}/suppressions/dump` (bounce sweep) | per decided run that passes the send policy (owner's per-job cap, default 10/day, and cooldown, default 15 min); one digest per opted-in job per recipient per UTC day; per added address; sweep on each call of `/api/alerts/bounces` | **off unless `MAILER_ENABLED`** and armed (`MAILER_PROVIDER=postmark`, token, `MAILER_FROM`, `MAILER_TOKEN_SECRET`, `MAILER_PUBLIC_URL`). A failed send is recorded `failed`, never retried | `frontend/src/lib/mailer/provider.ts:41` (`postmarkProvider`) |
| UptimePool on Bradbury Phase 2 EVM (`BRADBURY_EVM_RPC`, default `https://rpc.testnet-chain.genlayer.com`) | JSON-RPC | `MAILER_KEY` (spender role 2) | `getPool` owner check, `eth_call` simulation of `charge([poolId],[email price from NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN],emailId)`, then the tx; the email is sent only if the receipt has a matching `Charged` event (`ChargeSkipped` or anything else = refused, not sent) | once per Bradbury alert or digest email, before sending | no charge = no email (`refused`). Chain id pinned to 4221 | `frontend/src/lib/mailer/charger.ts:141` (`evmPoolCharger`), `:109` (`interpretChargeLogs`) |

## Inbound

| From | Route | Auth | What |
|---|---|---|---|
| Vercel Cron | `GET /api/cron/heartbeat` | `Authorization: Bearer $CRON_SECRET` (fail-closed) | submit a tick |
| Vercel Cron | `GET /api/cron/reconcile` | same | grade decided txs, fire appeals |
| Public / Grafana (Infinity) | `GET /api/heartbeat[?hours=N][&format=rows]` | none, read-only | summary JSON, or one row per probe |
| Bradbury validators (inside `probe_fetch` / `probe_llm`) | `GET /heartbeat/{static.json,lighthouse.txt,bakery.txt}` | none | frozen fixtures; base URL set at contract deploy |
| Signed-in owners (SIWE cookie `uptime_session`, `SESSION_SECRET`) | `GET`/`POST /api/alerts/recipients`, `DELETE`/`PATCH /api/alerts/recipients/{id}` | session; 503 unless `MAILER_ENABLED` and wired | list / add (sends one confirmation email; max 3 per wallet) / remove alert addresses; `PATCH { dailyCap }` sets that address's emails per day (1-100, default 20). UI: `/notifications` |
| Signed-in owners | `GET`/`PUT /api/alerts/jobs/{jobId}` | session + job owner (backend `jobOwner` lookup; 503 without it) | the job's self-serve rule: recipients (confirmed addresses), triggers `onFailure` / `onAssertion` / `onRecovery` / `digest`, `failAfter`, `perJobPerDay` (1-50, default 10), `cooldownMin` (5-120, default 15). Validated by `frontend/src/lib/mailer/limits.ts`. UI: Alerts section of `/jobs/{id}` |
| Email recipients (link in the confirmation mail) | `GET`/`POST /api/alerts/verify?r&x&t` | HMAC token (`MAILER_TOKEN_SECRET`), bound to row + address + wallet, 24 h expiry | GET shows a button, POST confirms |
| Email recipients / mail clients (RFC 8058 one-click) | `GET`/`POST /api/alerts/unsubscribe?e&t` | HMAC token per address (`MAILER_TOKEN_SECRET`) | POST adds the address to the suppression list; identical answer whatever the token |
| Cron (not scheduled yet) | `GET /api/alerts/bounces` | `Authorization: Bearer $CRON_SECRET` (fail-closed) | merge the provider's suppression list into ours |
| Cron (not scheduled yet) | `GET /api/alerts/digest` | `Authorization: Bearer $CRON_SECRET` (fail-closed); 503 without the backend's `digestSource` wiring | send the daily digest for every job with it on; idempotent per UTC day (`frontend/src/app/api/alerts/digest/route.ts:14`) |
| Scheduler (in-process) | `notifyRunDecided(job, run, { consecutiveFailures })` from `@/lib/mailer` (`notifyRunFailed` kept as an alias) | n/a | call for EVERY decided run, pass or fail: a failure may send a failure/assertion alert, a pass may send a recovery email; never throws. Inert until `configureMailer({ repo, studioAllowed, jobOwner, digestSource })` |

## On-chain

| Contract | Network | Address |
|---|---|---|
| `contracts/heartbeat.py` | Bradbury | `HEARTBEAT_CONTRACT` (not yet deployed) |
| `contracts/canary.py` | Bradbury | a new one each tick, address not tracked |
| `contracts/evm/src/UptimePool.sol` (EVM) | Bradbury Phase 2 chain RPC `https://rpc.testnet-chain.genlayer.com` (chain 4221) | `UPTIME_POOL_BRADBURY` (not yet deployed). Users: `deposit`/`topUp`/`withdraw`/`setPaused`/allowances from their own wallets; the Alerts section has the owner sign `setAllowance(uptimeId, 2, terms)` sized to their alert limits (`frontend/src/components/jobs/pool.ts:220`, terms from `frontend/src/lib/pricing.ts` `mailerAllowanceTerms`). Scheduler (`RELAYER_KEY_BRADBURY`, role 1) and mailer (`MAILER_KEY`, role 2): `charge`. Admin multisig: spender rotation only. Read: `getPool`, `available`, events. Deploy script `contracts/evm/script/DeployUptimePool.s.sol` (CREATE2 factory `0x4e59…956C`). Not wired into the app yet |
| `contracts/web_probe.py` | Studio + Bradbury | not yet deployed. `check_url`, `check_api`. Results are filed under the caller, so read them under the relayer's address |
| `contracts/ask.py` | Studio + Bradbury | not yet deployed. `ask`. Results are filed under the caller |

Chain config: `frontend/src/lib/chains.ts` pins the Bradbury Phase 2 addresses (from `genlayerlabs/genlayer-consensus@4e5bacaa` `deployments/bradbury-phase-2.json`, checked against the live AddressManager `0x3F71…38E0`) over the stale `genlayer-js` `testnetBradbury` defaults. Nothing imports it yet. The client to switch is `frontend/src/lib/genlayer/client.ts:2-9`.

## Mailer env vars (names only)

`MAILER_ENABLED` (master switch, default off) · `MAILER_PROVIDER` (`postmark`, else nothing is sent; the Foundation Postmark account) · `MAILER_PROVIDER_TOKEN` (Postmark server token) · `MAILER_FROM` (address on the verified sending domain) · `MAILER_FROM_NAME` · `MAILER_REPLY_TO` · `MAILER_STREAM` · `MAILER_API_BASE` · `MAILER_PUBLIC_URL` (base for links) · `MAILER_TOKEN_SECRET` (>= 32 chars) · `MAILER_KEY` · `UPTIME_POOL_BRADBURY` (or `NEXT_PUBLIC_UPTIME_POOL_BRADBURY`) · `BRADBURY_EVM_RPC` · operator limits: `MAILER_GLOBAL_DAILY_CEILING` (500, the global cap no owner setting can exceed), `MAILER_RECIPIENT_COOLDOWN_MIN` (5, failure alerts to one mailbox across jobs), `MAILER_STUDIO_DAILY_QUOTA` (20). Per-job and per-address limits are the owner's, stored in the rule / recipient rows (`frontend/src/lib/mailer/limits.ts`); `MAILER_EMAIL_PRICE_WEI`, `MAILER_JOB_COOLDOWN_MIN`, `MAILER_MAX_PER_JOB_DAY` and `MAILER_MAX_PER_RECIPIENT_DAY` are no longer read. Read at call time: `frontend/src/lib/mailer/config.ts`. Tables: `frontend/migrations/010_alerts.sql`, `011_alerts_selfserve.sql`.

## Price env vars (names only)

One module, `frontend/src/lib/pricing.ts:54` (`readPrices`), used by the wizard's funding estimate, the alerts UI and the mailer's charge. Decimal GEN; unset or malformed = the default. `NEXT_PUBLIC_` because the browser shows them, so they are inlined at build time (a change needs a redeploy).

`NEXT_PUBLIC_UPTIME_PRICE_EMAIL_GEN` (0.01, per Bradbury alert/digest email; 0 = Bradbury alerts not armed) · `NEXT_PUBLIC_UPTIME_PRICE_RUN_FEE_GEN` (0.001, flat fee per scheduled run, plus actual gas via `runChargeWei`; the scheduler is not wired to it yet) · `NEXT_PUBLIC_UPTIME_GAS_PER_TX_ESTIMATE_GEN` (0.00001, display estimate only).
