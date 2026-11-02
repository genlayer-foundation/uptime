# INTEGRATIONS

Outward-facing surface of the Heartbeat. Env vars by NAME only.

## Outbound

| To | Transport | Auth | What | Cadence | Degrades to | Where |
|---|---|---|---|---|---|---|
| GenLayer Bradbury RPC (`genlayer-js` `testnetBradbury`) | JSON-RPC | `PRIVATE_KEY` (tx signer, contract owner) | deploy canary, `probe_fetch`, `probe_llm`, `appealTransaction` | hourly tick; appeal every `HEARTBEAT_APPEAL_EVERY` ticks | record `SUBMIT_FAILED` with the error | `frontend/src/lib/heartbeat/runner.ts` (`runTick`, `appeal`) |
| GenLayer Bradbury RPC | JSON-RPC | none | `getTransaction`, `readContract get_probe` | every 10 min | record stays pending; `TIMEOUT` after 6h | `frontend/src/lib/heartbeat/runner.ts` (`runReconcile`) |
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
