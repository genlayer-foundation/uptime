# Uptime by GenLayer

Uptime: a paid GEN cron for GenLayer — schedule any call/deploy/read and track
results. **Bradbury Heartbeat** is ONE example job: a correctness-over-time
benchmark for the **Bradbury** testnet (same probes every hour, graded off-chain,
served as JSON for its dashboard and for Grafana). "Heartbeat" names only that
example job, its contract and its code — never the product.
Overview, probe table and setup: `README.md`. External surface: `INTEGRATIONS.md`.

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
(cd contracts/evm && forge test)
cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run && npx next build
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

UI: Uptime is a separate app with its OWN design — GenLayer-inspired but lightly
branded, NOT the GenLayer Design System (no `gl-*` classes, no design-system CSS).
Tokens in `frontend/src/app/globals.css`; build pages from
`frontend/src/components/ui/` and the shell in `components/shell/` (the
not-audited banner is on every page by the root layout). This repo is PUBLIC:
never commit F37 Lineca here.
