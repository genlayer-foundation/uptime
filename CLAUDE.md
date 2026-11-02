# Heartbeat

A correctness-over-time benchmark for GenLayer's **Bradbury** testnet. Every hour
the same probes run; results are graded off-chain and served as JSON (for the
dashboard and for Grafana). Overview, probe table and setup: `README.md`.
External surface: `INTEGRATIONS.md`.

This repo was the uptime/SLA monitor until 2026-10. All of that (multi-network
uptime checks, SLA contracts, ZKSync sync) was removed on purpose — do not
revive it here.

## Invariants

- **Prompts are frozen.** `QUESTIONS` in `contracts/heartbeat.py` is the
  benchmark. Editing a prompt breaks comparability with history; add a NEW qid
  instead, and add it to `frontend/src/lib/heartbeat/questions.ts` in the same
  commit (`test/direct` fails on qid drift).
- **The answer key never goes on-chain.** Grading lives in `questions.ts`.
- **Fixtures are frozen too.** `frontend/public/heartbeat/*` is fetched by the
  contract; changing a fixture changes the question.
- `frontend/src/lib/heartbeat/canary.ts` inlines `contracts/canary.py`
  byte-for-byte (a test enforces it) — Vercel's root is `frontend/`.
- The tick never waits on consensus (60s function limit). Submit in `tick`,
  measure in `reconcile`, using chain timestamps.
- Cron routes fail closed without `CRON_SECRET`.
- Pushing `main` deploys to Vercel production.

## Verify

```bash
genvm-lint check contracts/heartbeat.py
.venv/bin/pytest test/direct -q
cd frontend && npx tsc --noEmit && npx eslint src && npx next build
```

## Layout

```
contracts/heartbeat.py          probes + frozen question set
contracts/canary.py             deployed fresh each tick
frontend/public/heartbeat/      fixtures the contract fetches
frontend/src/lib/heartbeat/     runner (tick/reconcile), KV store, answer key, summary
frontend/src/app/api/cron/      heartbeat (hourly) + reconcile (10 min)
frontend/src/app/api/heartbeat  public JSON (summary, or ?format=rows for Grafana)
test/direct/                    direct-mode contract tests
```

UI is ONE design: the light zinc + purple Uptime look restored from b6d39c7
(owner decision 2026-11). Tokens in `frontend/src/app/globals.css`; build pages
from `frontend/src/components/ui/` and the shell in `components/shell/` (the
not-audited banner is on every page by the root layout). This repo is PUBLIC: never
commit F37 Lineca here.
