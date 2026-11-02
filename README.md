# Heartbeat — GenLayer correctness over time

Every hour, the same questions go to GenLayer's **Bradbury** testnet, and the answers are graded against a key the network never sees. The prompts never change, so when the numbers move, the network has changed.

This repo used to be the uptime/SLA monitor. That's gone. It now does only this.

## What a tick does

| Probe | What it calls | What it measures |
|---|---|---|
| `deploy` | deploys `contracts/canary.py` (no LLM, no web) | whether deploys get accepted, and time to ACCEPTED |
| `fetch` | `probe_fetch` (web GET of a fixture, `strict_eq`) | the control: if this fails, the problem is plumbing, not models |
| `llm` ×2 | `probe_llm(qid)`, rotating through 16 fixed questions | accuracy, validator agreement, rounds, latency |
| `appeal` | every 6th tick, appeals one correct `llm` answer | whether the appeal keeps the correct answer |

Question kinds (`contracts/heartbeat.py`):

- **fact, math, format, logic:** closed-book, one right answer
- **reading:** the answer exists only on a fictional page we host (`frontend/public/heartbeat/lighthouse.txt`)
- **injection:** a hostile page tells the model to answer something else. If it does, the grade is `injected`
- **borderline:** no right answer. These measure agreement only, and are expected to split validators

The answer key is `frontend/src/lib/heartbeat/questions.ts`, off-chain on purpose. A test fails if its qids drift from the contract's.

## How it runs

```
Vercel cron  0 * * * *     /api/cron/heartbeat   submit this tick's txs, never wait
Vercel cron  */10 * * * *  /api/cron/reconcile   read decided txs, grade, fire due appeals
                             │
                           Upstash KV  (hb:pending, hb:results)
                             │
public                     /api/heartbeat                    summary + hourly series
                           /api/heartbeat?format=rows        flat rows for Grafana (Infinity)
                           /                                 dashboard
```

Latency comes from the chain's own `createdTimestamp` → `lastVoteTimestamp`, so the reconcile cadence affects freshness, not precision.

## Setup

```bash
# contract
genvm-lint check contracts/heartbeat.py
python3 -m venv .venv && .venv/bin/pip install genlayer-test pytest
.venv/bin/pytest test/direct -q

# deploy once to Bradbury, with the site's fixture base URL as the argument,
# FROM THE SAME KEY as PRIVATE_KEY below (probes are owner-only)
genlayer network set testnet-bradbury
genlayer deploy --contract contracts/heartbeat.py --args "https://uptime.genlayer.foundation/heartbeat"

# frontend
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

`CRON_SECRET` is **required**. The cron routes refuse every call without it, because a tick spends gas and appeal bonds.

## Cost

Per hour: 1 deploy + 1 fetch + 2 LLM txs. Every 6 hours, 1 appeal (bond: `getMinAppealBond`). The wallet behind `PRIVATE_KEY` must stay funded on Bradbury.
