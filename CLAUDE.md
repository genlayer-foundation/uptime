# Heartbeat

A correctness-over-time benchmark for GenLayer's **Bradbury** testnet. Every hour
the same probes run; results are graded off-chain and served as JSON (for the
dashboard and for Grafana). Overview, probe table and setup: `README.md`.
External surface: `INTEGRATIONS.md`.

Uptime: a paid cron for GenLayer — schedule any call/deploy/read and track results; Bradbury Heartbeat is one example job.

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
genvm-lint check contracts/mail_escrow.py
.venv/bin/pytest test/direct -q
(cd contracts/evm && forge test)
cd frontend && npx tsc --noEmit && npx eslint src && npx next build
```

## Layout

```
contracts/heartbeat.py          probes + frozen question set
contracts/canary.py             deployed fresh each tick
contracts/mail_escrow.py        email credit escrow, fee released on DKIM evidence (MAIL_ESCROW.md)
frontend/public/heartbeat/      fixtures the contract fetches
frontend/src/lib/heartbeat/     runner (tick/reconcile), KV store, answer key, summary
frontend/src/app/api/cron/      heartbeat (hourly) + reconcile (10 min)
frontend/src/app/api/heartbeat  public JSON (summary, or ?format=rows for Grafana)
test/direct/                    direct-mode contract tests
```

UI uses the GenLayer Design System (`../design`). This repo is PUBLIC: never
commit F37 Lineca here.
