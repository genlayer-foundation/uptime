# Intelligent Contracts: one source, one build per network GenVM

Owner rule (2026-11-06): two versions of the contracts, and whenever Bradbury or Studio changes
GenVM we update them so they keep running. Backwards compatible from mainnet onwards.

```
contracts/src/<name>.py              THE source. Edit only this. Written against the newest SDK (v0.6).
contracts/targets.json               per target: runner pin, GenVM release, SDK dialect, RPC, rewrites, checks
contracts/build.py                   src/ -> build/<target>/<name>.py (+ frontend/src/lib/heartbeat/canary.ts)
contracts/build/bradbury/<name>.py   GENERATED, committed. Bradbury + studio-next (GenVM v0.6, babwp9t…)
contracts/build/studio/<name>.py     GENERATED, committed. studio.genlayer.com (GenVM v0.2.16, 1jb45aa8…)
contracts/overrides/<target>/        optional full per-target file, only where a rewrite can't express it
contracts/verify.sh [--network]      drift + direct tests + genvm-lint per target (+ read-only live load check)
contracts/load-check.mjs             Studio gen_getContractSchemaForCode / Bradbury gen_call deploy. No tx.
```

**Deploy from `contracts/build/<target>/`, never from `src/`** (src has no runner header).
The compat layer is small: the header, the import line, `gl.contract.Contract` vs `gl.Contract`,
`run_nondet` vs `run_nondet_unsafe`; sources read a UserError's text with `_err_text()`, which
handles `.data` (v0.6) and `.message` (v0.2). Value transfers use `emit_transfer`, which each SDK
lowers itself (EmitExternalMessage on v0.6, EthSend on v0.2).

## Verify

```bash
python3 contracts/build.py --check     # or: cd frontend && npm run contracts:check
contracts/verify.sh --network
```

Direct tests need one venv per SDK layout (gltest 0.30 reads only the v0.3+ layout; 0.29.2 is the
last that runs the v0.2 SDK):

```bash
python3 -m venv .venv && .venv/bin/pip install --pre 'genlayer-test>=0.30.0rc2' pytest pillow pycryptodome
uv venv -p 3.13 .venv-studio && uv pip install -p .venv-studio/bin/python 'genlayer-test==0.29.2' pytest pillow pycryptodome
UPTIME_TARGET=studio .venv-studio/bin/pytest test/direct -q    # UPTIME_TARGET picks contracts/build/<target>/
```

## When a network upgrades GenVM

1. Find the new runner hash (the node's GenVM release, or the error a deploy returns) and set
   `runner` + `genvm` (+ `genvm_repo` if the release moved) for that target in `targets.json`.
2. `python3 contracts/build.py`, then `contracts/verify.sh --network`.
3. If the SDK API changed: make `src/` speak the newest API, and add `rewrites` (and `forbid`
   guards) to the OLDER targets so they still build. Last resort: an `overrides/<target>/` file.
4. A new network GenVM that differs from every target = a new entry in `targets.json` (and in
   `Network` / `CANARY_SOURCES` in the frontend if the app runs jobs there).
5. Redeploy the long-lived contracts on that network from `build/<target>/` and update their env
   addresses (`deploy_env` in `targets.json`). Commit the rebuilt files with the pin change.

## Redeploy on a new consensus deployment (Bradbury Phase 3)

An intelligent contract lives in ONE consensus deployment. Bradbury Phase 3 (2026-11-24) is a
new deployment on the same rollup as Phase 2 (chain 4221), so the three long-lived Bradbury
contracts do not exist on it and must be deployed again. The EVM contracts under `evm/` and
`delegation/` are plain contracts on the rollup: they depend on the chain only, keep their
addresses and balances, and need nothing.

| Contract | Constructor | Env var to change (Vercel Production) |
|---|---|---|
| `build/bradbury/heartbeat.py` | `(fixture_base, operator)` | `HEARTBEAT_CONTRACT` |
| `build/bradbury/web_probe.py` | none | `UPTIME_WEBPROBE_BRADBURY` |
| `build/bradbury/ask.py` | none | `UPTIME_ASK_BRADBURY` |

Addresses live in env only (`deploy_env` in `targets.json`), never in code or the database.
The canary is deployed by every tick; `mail_escrow.py` was never deployed.

**Before anything** (each is a read, nothing is sent):

1. A GenLayer node RPC that tracks Phase 3. `rpc.testnet-chain.genlayer.com` serves no `gen_*`
   method, and on 2026-11-25 `rpc-bradbury.genlayer.com` still tracked Phase 2. A node that
   returns code for the Phase 2 Heartbeat is NOT a Phase 3 node:
   ```bash
   curl -s -X POST -H 'content-type: application/json' "$NODE_RPC" -d '{"jsonrpc":"2.0","id":1,
     "method":"gen_getContractCode","params":[{"address":"0x66a4bF89E8812Ced84C405c6f0Cb0E35153EBb3F"}]}'
   # Phase 3 node: "contract code not found".  A long base64 result: still Phase 2, stop.
   ```
2. The runner pin still loads on that node's GenVM (Phase 3 nodes run v0.6.0; the pin in
   `targets.json` was taken from GenVM v0.6.0-rc10 and has not been tried on a Phase 3 node):
   ```bash
   UPTIME_RPC_BRADBURY="$NODE_RPC" node contracts/load-check.mjs bradbury
   ```
   `invalid_contract runner malformed` or `runner absent` = follow "When a network upgrades
   GenVM" above first.
3. At least 5 validators are selectable, else every submit reverts
   `TooFewValidatorsForAdmission` (11 on 2026-11-25):
   ```bash
   cast call 0xcE16862EAf10B97A0619BeBb662991fb4a52e346 'selectableValidators()(address[])' \
     --rpc-url https://rpc.testnet-chain.genlayer.com
   ```

**Deploy** with genlayer CLI 0.40.1, the first whose `testnet-bradbury` profile carries the
Phase 3 addresses (check them with `genlayer network info`: ConsensusMain must be
`0x0f4F0e05475723790E4a2ed0598370783C300926`). The deployer becomes the Heartbeat's owner
(`set_operator` only); the operator must be the address of the scheduler wallet
(`RELAYER_KEY_BRADBURY`), which signs every tick. The scheduler wallet can also be the
deployer. Each deploy deposits at most ~0.05 GEN plus chain gas, so 1 GEN in the deployer is
ample; unused deposit is refunded.

```bash
npx genlayer@0.40.1 network set testnet-bradbury
npx genlayer@0.40.1 network info                       # Phase 3 addresses?
GENLAYER_E2E_NO_OPEN=1 npx genlayer@0.40.1 deploy --rpc "$NODE_RPC" --wallet browser \
  --contract contracts/build/bradbury/heartbeat.py \
  --args "https://uptime.genlayer.foundation/heartbeat" <scheduler wallet address>
GENLAYER_E2E_NO_OPEN=1 npx genlayer@0.40.1 deploy --rpc "$NODE_RPC" --wallet browser --contract contracts/build/bradbury/web_probe.py
GENLAYER_E2E_NO_OPEN=1 npx genlayer@0.40.1 deploy --rpc "$NODE_RPC" --wallet browser --contract contracts/build/bradbury/ask.py
# check each once it is accepted:
npx genlayer@0.40.1 call <heartbeat address> get_operator --rpc "$NODE_RPC"   # = scheduler wallet
npx genlayer@0.40.1 call <heartbeat address> get_version --rpc "$NODE_RPC"
```

**Then**, on Vercel Production: set `HEARTBEAT_CONTRACT`, `UPTIME_WEBPROBE_BRADBURY`,
`UPTIME_ASK_BRADBURY` to the new addresses and `NEXT_PUBLIC_BRADBURY_GENLAYER_RPC` to the node
RPC (unless Labs repointed `rpc-bradbury.genlayer.com`), and deploy the app. Record the
addresses in `INTEGRATIONS.md` (On-chain) and the README table.

**Running cost**: the scheduler wallet pays ~0.25 GEN of deposits per hourly tick (5 txs, part
refunded) plus an appeal bond every 5th tick: at most ~6 GEN a day. Its balance is on the
rollup, not in a consensus deployment: Phase 2 funds are still there.

**What the switch does not move**: Heartbeat results of the old deployment stay in
`heartbeat_probes` and in `/api/heartbeat` windows that reach back before the switch; the tick
counter continues. User jobs keep the contract addresses they were created with: a job that
writes to a Phase 2 contract (including the old WebProbe and Ask addresses) has nothing to
call on Phase 3 until its owner edits it or recreates it from the preset.

## Deploy the Studio presets (owner signs in MetaMask)

**Deploy Studio builds with genlayer CLI 0.39.2 (`npx genlayer@0.39.2`), Bradbury with
0.40.1 (Phase 3; 0.40.0-rc.5 was Phase 2).** 0.40.x bundles genlayer-js 2.x, which sends the fee-aware
`addTransaction(params)` (`0x35a251fb`) that hosted Studio cannot decode: the tx finalizes
`NO_MAJORITY` with no contract (2026-11-06). 0.39.2 (genlayer-js 1.1.8) sends the legacy
`addTransaction` Studio expects; the app's Studio client uses the same 1.1.8
(`frontend/src/lib/genlayer/studio.ts`).

```bash
npx genlayer@0.39.2 network set studionet
GENLAYER_E2E_NO_OPEN=1 npx genlayer@0.39.2 deploy --contract contracts/build/studio/web_probe.py --wallet browser
GENLAYER_E2E_NO_OPEN=1 npx genlayer@0.39.2 deploy --contract contracts/build/studio/ask.py --wallet browser
genlayer network set bradbury-p2          # back to the default profile
# signing URL: `genlayer wallet status`. Then on Vercel Production:
# UPTIME_WEBPROBE_STUDIO=<web_probe address>  UPTIME_ASK_STUDIO=<ask address>
```

Live on Studio (2026-11-06, CLI 0.39.2): `web_probe` `0x4574A36757da191D34CE3a38060b229928766024`,
`ask` `0x3E6A11b37a94F7dA45E052aE6A2D289d3E8128e6`.
