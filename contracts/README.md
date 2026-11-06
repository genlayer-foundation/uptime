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

## Deploy the Studio presets (owner signs in MetaMask)

**Deploy Studio builds with genlayer CLI 0.39.2 (`npx genlayer@0.39.2`), Bradbury with
0.40.0-rc.5.** 0.40.x bundles genlayer-js 2.x, which sends the fee-aware
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
