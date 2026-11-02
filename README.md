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
                           /examples/bradbury-heartbeat      dashboard
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

### Local development: demo / production / local data

`npm run dev` needs no secrets to show a full dashboard. `/api/heartbeat` reads from one of three sources:

| Source | What it serves | Needs |
|---|---|---|
| `demo` (dev default) | a deterministic synthetic 30-day history (`src/lib/heartbeat/demo.ts`): canary deploys, fetches, 2 rotating questions per tick, appeals every 6th tick, wrong answers, injections, borderline splits, timeouts, submit failures and a 6-hour outage | nothing |
| `production` | proxies the same query to the public `https://uptime.genlayer.foundation/api/heartbeat` | nothing (public, read-only) |
| `local` | the real KV path | `KV_REST_API_URL`, `KV_REST_API_TOKEN` |

Pick one with `HEARTBEAT_DATA_SOURCE=demo|production|local` in `.env.local`, or with the dev-only **Demo / Production** switch at the top of the page (it sets an `hb-source` cookie). `?source=` on the API URL overrides both. A badge on the page always names the source on screen, and dev responses carry an `X-Heartbeat-Source` header. If production is unreachable or not deployed, the page shows the unavailable state, naming that source.

The switch exists only under `next dev`. In any build (`next build`, Vercel preview or production) the server always reads KV and ignores the env var, cookie and query (`src/lib/heartbeat/source.ts`).

`CRON_SECRET` is **required**. The cron routes refuse every call without it, because a tick spends gas and appeal bonds.

## Cost

Per hour: 1 deploy + 1 fetch + 2 LLM txs. Every 6 hours, 1 appeal (bond: `getMinAppealBond`). The wallet behind `PRIVATE_KEY` must stay funded on Bradbury.

## Uptime contracts (in progress, not deployed)

The scheduled-actions product (design: `docs/PRODUCT.md`, local draft) adds these. Nothing below is deployed yet.

| Contract | Network | What it is |
|---|---|---|
| `contracts/evm/src/UptimePool.sol` | Bradbury only (plain EVM on the Arbitrum Orbit chain, chain 4221) | Users lock GEN per uptime. Scheduler and mailer draw from it only within the owner's per-spender allowances. Owner can pause, revoke, or withdraw at any time |
| `contracts/web_probe.py` | Studio + Bradbury | Preset 2 `check_url` and preset 3 `check_api` |
| `contracts/ask.py` | Studio + Bradbury | Preset 4 `ask`: optional page read, an LLM question, a short normalized answer |
| `contracts/heartbeat.py`, `contracts/canary.py` | Bradbury | Preset 1 (unchanged) |

### UptimePool

```
deposit(bytes32 uptimeId, uint8[] roles, Terms[] terms) payable   create the pool, become its owner, grant allowances
topUp(bytes32 uptimeId) payable                                   owner only
withdraw(bytes32 uptimeId, uint256 amount) → uint256              owner only, immediate, works while paused; amount = ALL takes everything
withdrawTo(bytes32 uptimeId, uint256 amount, address to) → uint256
setPaused(bytes32 uptimeId, bool)                                 kill switch: every charge on the pool is refused
setAllowance(bytes32 uptimeId, uint8 role, Terms)                 grant or replace (resets the period count)
setAllowancePaused(bytes32 uptimeId, uint8 role, bool)
revokeAllowance(bytes32 uptimeId, uint8 role)
charge(bytes32[] ids, uint256[] amounts, uint256 settlementId) → uint256   spender only
proposeSpender(uint8 role, address) / executeSpender(uint8) / cancelSpender(uint8)   admin only, behind rotationDelay
getPool · getAllowance · available · getHistory · spenderOf · roleOf · lastSettlement · pendingSpender
Terms = { uint128 periodAmount, uint64 periodDuration, uint64 startDate (0 = now), uint64 expiry (0 = never), uint128 maxPerCharge (0 = no cap) }
```

- **Spenders are roles.** 1 = scheduler (pays run gas), 2 = mailer (pays email fees, charged before each send). The owner grants an allowance to a role, and the admin decides which address holds that role. The admin cannot touch balances or raise an allowance.
- **Allowance = MetaMask `NativeTokenPeriodTransferEnforcer` semantics.** `periodAmount` per fixed window of `periodDuration` from `startDate`, no carry-over, plus `expiry`, `maxPerCharge` and a pause. The scheduler and mailer speak "charge spender X within its period allowance". A later move to ERC-7710 delegations then swaps only the payer.
- **One line = one run or one email.** Ids may repeat in a batch, so `maxPerCharge` is the per-run cap and `periodAmount` the per-day cap.
- **Replay:** `settlementId` must strictly increase per role. A new spender continues the old one's sequence.
- **A refused line is skipped, not reverted** (`ChargeSkipped(id, role, settlementId, amount, reason)`), so one pool pausing cannot block the others' settlement. Simulate with `eth_call` first and read the events after.
- **Ids are first-come.** Pick a random `uptimeId` off-chain. The backend must check `getPool(id).owner == uptime owner` before it schedules anything.
- Kept from `NativeGenStaking` (validator-staking-program-tge): OpenZeppelin `ReentrancyGuard`, checks-effects-interactions, revert on a rejected transfer, permanent history plus events, no receive/fallback.

```bash
cd contracts/evm && forge test                    # dependencies vendored in lib/, hashes in dependencies.lock.json
# deploy: prepared, NOT run. Simulates unless --broadcast is added
ADMIN=0x… SCHEDULER=0x… MAILER=0x… forge script script/DeployUptimePool.s.sol --rpc-url bradbury --force
```

### Presets that need no contract

The scheduler signs every run with the relayer key (`RELAYER_KEY_*`), so the user's contract sees **the relayer address as `msg.sender`**. If an owner-gated contract should accept these runs, its owner has to authorize that address.

| Preset | Tx the scheduler sends (genlayer-js) |
|---|---|
| 5 Call your contract | `writeContract({ address: <user contract>, functionName, args, value: 0n })`, then optionally `readContract({ address, functionName: <view>, args })` to record a value |
| 6 Read a view | `readContract(...)` only, no tx |
| 7 Deploy your contract | `deployContract({ code: <user source, pinned by hash when the uptime is created>, args })` |
| 8 Deploy every X, call every Y | schedule A = preset 7. Schedule B = preset 5 against the address that A's latest ACCEPTED deploy returned |

### Bradbury Phase 2 chain config

`genlayer-js` `testnetBradbury` still carries the Phase 1 consensus and staking addresses. Use `frontend/src/lib/chains.ts` (`CHAINS.bradbury.chain`) instead. It holds the Phase 2 addresses, verified against the live AddressManager. The app is not wired to it yet. Its import point is `frontend/src/lib/genlayer/client.ts`.
