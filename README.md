> [!WARNING]
> **NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.**
> None of the contracts in this repo (`contracts/`) have been audited. They target GenLayer testnets only.

# Uptime by GenLayer

A paid cron for GenLayer: schedule any call, deploy or read, pay for it in GEN, and track the results over time.

## Example job: Bradbury Heartbeat

The first job running on Uptime is **Bradbury Heartbeat**. Every hour it runs five test types against GenLayer's **Bradbury** testnet, each one way real contracts depend on the network, plus an appeal every fifth hour. When a type goes red, that capability is broken for real contracts. Prompts and the answer key are constants in `contracts/src/heartbeat.py`, which grades every answer itself. Dashboard: `/examples/bradbury-heartbeat`.

## What a tick does

| Type | Probe | What it calls | Consensus | Graded |
|---|---|---|---|---|
| DEPLOY | canary | deploys `contracts/build/bradbury/canary.py` (no LLM, no web) | none | canary's `get_tick() == tick`; time to ACCEPTED **and** to FINALIZED |
| WRITE | bump | `bump(tick)`: a plain state write, no web, no LLM | none | `get_last_tick() == tick` (or `get_bump(tick)` once a later bump landed) |
| WEB | `f0-status` | `probe_status(tick)`: `web.get` of `status.json`, no LLM | `strict_eq` | exact canonical JSON |
| 2 rotating | `r1`…`r9` | `probe(tick, id)`, 2 of 9 per tick, each every 4.5 h | see below | on-chain: `correct` / `wrong` / `injected` |
| appeal | — | every 5th tick, appeals the tick's first rotating probe once decided (ACCEPTED or UNDETERMINED) | | `upheld` / `overturned` / `withdrawn` |

The rotating pool (`frontend/src/lib/heartbeat/probes.ts` lists it in rotation order; prompts and key live only in the contract):

| id | Type | Fixture | Consensus | Correct when |
|---|---|---|---|---|
| `r1-extract` | WEB | `primer.html` (rendered text; nav, decoy numbers) | `strict_eq` on the integer | `42` |
| `r2-answer42` | LLM | closed-book | `strict_eq` on the integer | `42` |
| `r3-laws` | LLM | closed-book | `prompt_comparative` | `count == 3` |
| `r4-rule` | LLM | `mandate.html` (an agent log that overspends) | `prompt_comparative` | `{"follows": false, "rule": 2}` |
| `r5-summary` | LLM | `primer.html`, Optimistic Democracy section | `prompt_non_comparative` | form only: ≤ 40 words, mentions validator and appeal |
| `r6-injection` | WEB | `appeals-note.html` (a hidden line says "answer 10") | custom validator | `2`; `10` = `injected` |
| `r7-card` | IMAGE | `card.png` bytes → `exec_prompt(images=…)` | `strict_eq` on the digits | `7319` |
| `r8-shot` | IMAGE | `web.render(shot.html, mode="screenshot")` | custom validator | `CONDORCET` |
| `r9-namesake` | LLM | closed-book | `prompt_comparative` | contains `451` |

The appealed index for the m-th appeal is (m − 2) mod 9, so every probe, images included, is appealed once every 45 hours.

**Fixtures** (`frontend/public/heartbeat/`, served `immutable` by `next.config.ts`) are frozen. Each HTML page carries a sentinel `HB2-<id>`; `card.png` is pinned by sha256 in the contract. A missing sentinel or another card is stored as an agreed `[EXTERNAL] fixture drift` error, never as a wrong answer. `card.png` and `shot.html` are generated, deterministically, by `frontend/scripts/heartbeat-fixtures.mjs` (`--check` verifies the committed bytes). The answer in each exists only as pixels.

**Images.** GenVM accepts text plus up to 2 images and fails the request on a validator with no vision model. Whether every Bradbury validator has one is unverified: `r7` and `r8` measure exactly that.

## How it runs

```
Vercel cron  */5 * * * *   /api/cron/dispatch    submit this tick's txs (hourly at :00), never wait
                           (/api/cron/heartbeat, hourly, does it instead when DATABASE_URL is unset)
Vercel cron  */10 * * * *  /api/cron/reconcile   read decided txs, copy on-chain grades, fire due appeals,
                                                 finalize canaries
                             │
                           Postgres  heartbeat_probes, heartbeat_state  (migrations/011_heartbeat.sql + 013_heartbeat_write.sql)
                             │
public                     /api/heartbeat                    summary + hourly series + runs (passed / failed / missed on our side) + latest run
                           /api/heartbeat?format=rows        flat rows for Grafana (Infinity)
                           /examples/bradbury-heartbeat      dashboard
```

Time to decision comes from the chain's own `createdTimestamp` → `lastVoteTimestamp`, so the reconcile cadence affects freshness, not precision. Time to FINALIZED (canaries only) has no chain timestamp: it is measured when reconcile first sees FINALIZED, so its resolution is the 10-minute reconcile cadence.

**Store.** Results live in the app's Postgres (`DATABASE_URL`), the same database as the jobs backend (`src/lib/heartbeat/store.ts`). Upstash KV (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) is only a fallback: it is used when `DATABASE_URL` is unset, or while migrations 011 and 013 have not been applied yet. Nothing is copied between the two.

## Setup

```bash
# contracts. One source per contract (contracts/src/), one generated build per network
# GenVM: contracts/build/bradbury/ (py-genlayer:babwp9t…, GenVM v0.6.0-rc10) and
# contracts/build/studio/ (py-genlayer:1jb45aa8…, GenVM v0.2.16). See contracts/README.md.
python3 contracts/build.py          # after editing contracts/src/ or contracts/targets.json
contracts/verify.sh --network       # drift + direct tests + genvm-lint per target + read-only live load checks

# deploy once to Bradbury: args are the site's fixture base URL and the
# OPERATOR, the Bradbury scheduler wallet (RELAYER_KEY_BRADBURY) that signs the
# cron's probes and bumps, as a plain 0x address (the constructor takes an Address).
# The deployer becomes owner (may also probe, and is the only one who can
# set_operator), so you can deploy from your own wallet.
# GENLAYER_E2E_NO_OPEN=1 stops the CLI opening a browser; `genlayer wallet status`
# prints the signing URL to open yourself.
genlayer network set testnet-bradbury
GENLAYER_E2E_NO_OPEN=1 genlayer deploy --contract contracts/build/bradbury/heartbeat.py --wallet browser \
  --fees '{"distribution":{"leaderTimeunitsAllocation":"600","validatorTimeunitsAllocation":"600","appealRounds":"1","executionBudgetPerRound":"25000000000000000","rotations":["1","1"],"maxPriceGenPerTimeUnit":"2","storageFeeMaxGasPrice":"300000000","receiptFeeMaxGasPrice":"300000000"}}' \
  --args "https://uptime.genlayer.foundation/heartbeat" <SCHEDULER_ADDRESS>

# frontend
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

### Local development: demo / production / local data

`npm run dev` needs no secrets to show a full dashboard. `/api/heartbeat` reads from one of three sources:

| Source | What it serves | Needs |
|---|---|---|
| `demo` (dev default) | a deterministic synthetic 30-day history (`src/lib/heartbeat/demo.ts`) in the runner's own shapes: canary deploys with FINALIZED times, bumps, F0, 2 rotating probes per tick, appeals every 5th tick (upheld / overturned / withdrawn), wrong answers, injections, fixture drift, UNDETERMINED splits, timeouts, submit failures and a 6-hour outage | nothing |
| `production` | proxies the same query to the public `https://uptime.genlayer.foundation/api/heartbeat` | nothing (public, read-only) |
| `local` | the real store: Postgres, or KV as the fallback (see **Store** above) | `DATABASE_URL` (+ `npm run db:migrate`), or `KV_REST_API_URL`, `KV_REST_API_TOKEN` |

Pick one with `HEARTBEAT_DATA_SOURCE=demo|production|local` in `.env.local`, or with the dev-only **Demo / Production** switch at the top of the page (it sets an `hb-source` cookie). `?source=` on the API URL overrides both. A badge on the page always names the source on screen, and dev responses carry an `X-Heartbeat-Source` header. If production is unreachable or not deployed, the page shows the unavailable state, naming that source.

The switch exists only under `next dev`. In any build (`next build`, Vercel preview or production) the server always reads the real store and ignores the env var, cookie and query (`src/lib/heartbeat/source.ts`).

`CRON_SECRET` is **required**. The cron routes refuse every call without it, because a tick spends gas and appeal bonds.

## Cost

Per hour: 5 txs (1 deploy, 1 bump, 1 F0 fetch, 2 rotating probes), about 13 LLM calls on a 5-validator committee. Every 5 hours, 1 appeal (bond: `getMinAppealBond`). Each tx deposits ~0.05 GEN of Phase 2 fees (`BRADBURY_TX_FEES`, see INTEGRATIONS.md), ~0.25 GEN per tick; unused budget is refunded at finalization. The scheduler wallet behind `RELAYER_KEY_BRADBURY` must stay funded on Bradbury.

## Uptime contracts (in progress, not deployed)

The scheduled-actions product (design: `docs/PRODUCT.md`, local draft) adds these. Nothing below is deployed yet.

Every Python contract is built per network GenVM from one source: deploy `contracts/build/bradbury/<name>.py` on Bradbury and `contracts/build/studio/<name>.py` on Studio (GenVM v0.2.16). The app picks the build for the job's network (`contracts/README.md`).

| Contract | Network | What it is |
|---|---|---|
| `contracts/evm/src/UptimePool.sol` | Bradbury only (plain EVM on the Arbitrum Orbit chain, chain 4221) | Users lock GEN per uptime. Scheduler and mailer draw from it only within the owner's per-spender allowances. Owner can pause, revoke, or withdraw at any time Deployed at `0x5ea32AdBDF2f3C68C2Fe5566ec3156bF88e41d0A` (`UPTIME_POOL_BRADBURY`; admin `0x3B49…7Da97`, scheduler `0xDcA4…84dd`, mailer unset) |
| `contracts/src/web_probe.py` | Studio + Bradbury | Preset 2 `check_url` and preset 3 `check_api`. Bradbury: `0x9d1984c170c6E1ed0126925B4a345371239155cB` (`UPTIME_WEBPROBE_BRADBURY`); Studio: `0x4574A36757da191D34CE3a38060b229928766024` (`UPTIME_WEBPROBE_STUDIO`) |
| `contracts/src/ask.py` | Studio + Bradbury | Preset 4 `ask`: optional page read, an LLM question, a short normalized answer. Bradbury: `0xa47174e0A375C2116f9830498F59748A391D25d8` (`UPTIME_ASK_BRADBURY`); Studio: `0x3E6A11b37a94F7dA45E052aE6A2D289d3E8128e6` (`UPTIME_ASK_STUDIO`) |
| `contracts/src/heartbeat.py`, `contracts/src/canary.py` | Bradbury (canary: any network, per-network build) | Preset 1 (the Bradbury Heartbeat). Heartbeat deployed at `0x66a4bF89E8812Ced84C405c6f0Cb0E35153EBb3F` (`HEARTBEAT_CONTRACT`); canaries are a new deploy each tick |

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
- **Ids are first-come.** The backend assigns each Bradbury job its `uptimeId` (the job UUID, left-padded to 32 bytes; returned as `job.poolId` by `POST /api/jobs`), and the UI deposits under exactly that id. Before scheduling anything the backend checks `getPool(id).owner == job owner`, so someone squatting an id can block a job but never move its owner's funds.
- Kept from `NativeGenStaking` (validator-staking-program-tge): OpenZeppelin `ReentrancyGuard`, checks-effects-interactions, revert on a rejected transfer, permanent history plus events, no receive/fallback.

```bash
cd contracts/evm && forge test                    # dependencies vendored in lib/, hashes in dependencies.lock.json
# deploy: prepared, NOT run. Simulates unless --broadcast is added
SCHEDULER=0x… MAILER=0x… forge script script/DeployUptimePool.s.sol --rpc-url bradbury --force --account <name>
```

- **Admin is one plain wallet: the deployer** (the `--account` that signs), not a multisig. `ROTATION_DELAY` defaults to 0, so a spender rotation executes as soon as it is proposed. Override with `ADMIN=0x…` and `ROTATION_DELAY=<seconds>`. Not audited, testnet only.

### Presets that need no contract

The scheduler signs every run with the relayer key (`RELAYER_KEY_*`, resolved in `src/lib/signer.ts`; the Heartbeat uses the same Bradbury key), so the user's contract sees **the relayer address as `msg.sender`**. If an owner-gated contract should accept these runs, its owner has to authorize that address.

| Preset | Tx the scheduler sends (genlayer-js) |
|---|---|
| 5 Call your contract | `writeContract({ address: <user contract>, functionName, args, value: 0n })`, then optionally `readContract({ address, functionName: <view>, args })` to record a value |
| 6 Read a view | `readContract(...)` only, no tx |
| 7 Deploy your contract | `deployContract({ code: <user source, pinned by hash when the uptime is created>, args })` |
| 8 Deploy every X, call every Y | schedule A = preset 7. Schedule B = preset 5 against the address that A's latest ACCEPTED deploy returned |

### Bradbury Phase 2 chain config

`genlayer-js` `testnetBradbury` still carries the Phase 1 consensus and staking addresses. `frontend/src/lib/chains.ts` (`CHAINS.bradbury.chain` = `bradburyPhase2`) holds the Phase 2 addresses, verified against the live AddressManager. Both the Bradbury Heartbeat client (`frontend/src/lib/genlayer/client.ts`) and the job executor (`frontend/src/lib/jobs/chain.ts`) use it. `genlayer-js` is pinned at `2.0.0-rc.2`, whose ABIs are Phase 2's (fee-aware `addTransaction`); every Bradbury deploy/write carries a fee deposit from `frontend/src/lib/genlayer/fees.ts`. Studio jobs use genlayer-js 1.1.8 (aliased `genlayer-js-v1`, `frontend/src/lib/genlayer/studio.ts`): hosted Studio only decodes the legacy `addTransaction` (`0x27241a99`), and 2.x txs finalize `NO_MAJORITY` there with no contract. Studio txs carry no fees.

## Jobs backend (a generic paid cron)

A **job** is one network plus one or more **steps**, each an ordinary GenLayer action, on a schedule. Presets (check a URL, check an API, ask, call a contract, deploy, deploy-then-call, and the Bradbury Heartbeat example) are just prefilled jobs. The shared shapes are `frontend/src/lib/jobs/types.ts`; other workstreams code against that file.

```jsonc
// POST /api/jobs
{
  "name": "Deploy hourly, read it every 5 min",
  "network": "bradbury",                       // or "studio" (allowlisted wallets only)
  "schedule": { "everyMinutes": 60 },          // or { "cron": "0 * * * *" } (UTC); min 5 min either way
  "steps": [
    { "id": "deploy", "kind": "deploy", "preset": "canary", "args": ["{{slot}}"] },
    { "id": "check", "kind": "read", "contract": "$deploy.address", "method": "get_tick", "args": [],
      "schedule": { "everyMinutes": 5 } }       // a step with its own schedule runs on its own
  ],
  "assertions": [{ "step": "check", "op": "gt", "expected": 0 }]
}
```

- **Step kinds.** `write` (any write method, any args, optional `value` in wei), `deploy` (`code`, or `preset: "canary"`), `read` (a view: no tx, records the value and RPC latency).
- **Order and chaining.** Steps without their own schedule run in order on the job schedule. A write or deploy is submitted and the next step starts once reconcile sees it decided. `"$<deployStep>.address"` is the contract that deploy created in the same run, else its latest accepted deploy.
- **Placeholders** in string args: `{{job_id}}`, `{{run_id}}` (`<group>:<slot>`, stable across retries), `{{slot}}` (unix seconds; a bare `"{{slot}}"` becomes an integer), `{{relayer}}` (the address that signs runs; the preset contracts file results under it).
- **Tracking.** Per step run: tx hash, status (`PENDING`, `ACCEPTED`, `FINALIZED`, `UNDETERMINED`, `TIMEOUT`, `SUBMIT_FAILED`, `ERROR`), recorded result (deploys: `{ address }`; reads: the returned value; writes: the execution outcome, since the node's tx view does not reliably expose return values, so read them with a `read` step), time to ACCEPTED from chain timestamps, rounds, votes, and `gasGen`. **`gasGen` is a flat estimate** (`UPTIME_RUN_COST_WEI` per tx on Bradbury) until real fees are measured.
- **Pass/fail.** A run passes when every step succeeded and every assertion (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists`, with an optional dot `path` into the result) on a step of that run holds.
- **Export.** `GET /api/jobs/:id/runs?format=rows` gives one flat row per step run, in the `/api/heartbeat?format=rows` shape (time in ms, status, latency_sec, rounds, votes_*, answer, tx, error), for Grafana Infinity.

API: `POST /api/auth/nonce`, `POST /api/auth/verify` (SIWE / EIP-4361, EOA signatures), `POST /api/auth/logout`, `GET /api/me`; `GET`/`POST /api/jobs` (`?public=1` lists public example jobs without sign-in); `GET`/`PATCH`/`DELETE /api/jobs/:id`; `POST /api/jobs/:id/pause|resume`; `GET /api/jobs/:id/runs?limit=&format=json|rows`; `GET /api/presets?network=`.

**Gates, enforced on the server at create/edit/resume AND by the scheduler before every run:**

- **Studio** is only for pre-approved GenLayer Labs and Foundation wallets: the owner must be in the env var `STUDIO_ALLOWLIST` (comma-separated addresses, normalized, read at call time). Unset or empty means nobody gets Studio. Quota: `STUDIO_MAX_JOBS_PER_WALLET` (default 10). Everyone else uses Bradbury and pays for their own runs from their own pool.
- **Operators:** wallets in `UPTIME_ADMIN_WALLETS` (same format, fail-closed) may list every job (`GET /api/jobs?all=1`), read any job and its runs, and pause any job, system jobs included. `GET /api/me` reports `isAdmin`. The pool contract's admin is separate: the `ADMIN` env of `contracts/evm/script/DeployUptimePool.s.sol`.
- **Bradbury:** a job starts as a draft. Before every run the scheduler reads its pool: the on-chain owner must be the job's owner (pool ids are first-come), the pool and the scheduler allowance must not be paused, and `available(poolId, 1)` must cover the next tx. Without a pool contract configured, only allowlisted wallets may run on Bradbury (the relayer pays).
- **Pool id** = the job UUID's 16 bytes left-padded to bytes32: job `1b4e28ba-2fa1-41d2-883f-0016d3cca427` → pool `0x000000000000000000000000000000001b4e28ba2fa141d2883f0016d3cca427` (`frontend/src/lib/jobs/ids.ts`).
- **Settlement** (`/api/cron/settle`, hourly) is **OFF unless `POOL_CHARGING_ENABLED=1`**. When on: one `charge` per period as role 1, one line per finished run (its fee plus all its steps' gas, clamped to the per-run cap, so the pool's `maxPerCharge` caps the whole run), `settlementId` above the on-chain `lastSettlement(1)`, `eth_call` first, then the per-line outcome from the receipt's `Charged` / `ChargeSkipped` events. Skipped lines retry up to 3 times. A sent charge whose receipt cannot be read keeps its lines locked, so it is never charged twice.

### Run it locally (Postgres)

```bash
# Postgres 14+: Postgres.app, Homebrew (`brew services start postgresql@16`) or
#   docker run -d --name uptime-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
createdb uptime_dev
cd frontend
export DATABASE_URL=postgres://localhost/uptime_dev      # (docker: postgres://postgres@localhost/uptime_dev)
npm run db:migrate                                       # applies migrations/*.sql once each
# .env.local: DATABASE_URL, SESSION_SECRET (>= 32 chars), CRON_SECRET, RELAYER_KEY_STUDIO / RELAYER_KEY_BRADBURY,
#   optionally STUDIO_ALLOWLIST / UPTIME_ADMIN_WALLETS (comma-separated wallets)
npm run dev
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/dispatch    # what the 5-min cron does
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/reconcile

npm test                                                 # unit tests; the Postgres suite needs:
createdb uptime_test && TEST_DATABASE_URL=postgres://localhost/uptime_test npm test   # DROPS that DB's schema
```

Without `DATABASE_URL` the jobs API answers 503, the dispatcher is idle, and `/api/cron/heartbeat` keeps ticking the Heartbeat exactly as before. With it, the Heartbeat becomes the public system job "Bradbury Heartbeat" (created on the first dispatch, owner = the Bradbury scheduler wallet, hourly at :00), dispatched through the same runner and the same Postgres store, so `/api/heartbeat` and its dashboard are unchanged, and the legacy route stands down.

Production data is planned on Neon via the Vercel Marketplace. Nothing is provisioned yet: run `npm run db:migrate` against its `DATABASE_URL` once it exists. Neon's URL carries `sslmode=require`, which `pg` honours.

### Backups

`.github/workflows/db-backup.yml` runs nightly at 03:30 UTC (and on demand): `pg_dump -Fc` (client 17, Neon's major) piped through `age` to the public key in repo variable `UPTIME_BACKUP_AGE_RECIPIENT`, uploaded as an Actions artifact kept 30 days. It reads only the secret `UPTIME_DATABASE_URL` (Neon DIRECT string) and fails closed without it. Restore:

1. `gh run list --repo genlayer-foundation/uptime --workflow db-backup.yml` and pick a green run id.
2. `gh run download <run-id> --repo genlayer-foundation/uptime --dir restore/` (one `uptime-<ts>.dump.age`).
3. `op document get uptime-backup-age --vault "Uptime Production" > /tmp/k && age -d -i /tmp/k -o restore/uptime.dump restore/*/*.dump.age && rm /tmp/k`
4. `pg_restore --list restore/uptime.dump | head` to check it, then restore into a NEW Neon branch/database, never over prod: `pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" restore/uptime.dump`.
5. Point `DATABASE_URL` at it only after checking row counts; delete `restore/` when done.
