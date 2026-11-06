#!/usr/bin/env bash
# Verify every contract build for every target in contracts/targets.json. Read-only: no tx, no deploy.
#
#   contracts/verify.sh              # drift check + direct tests + genvm-lint, per target
#   contracts/verify.sh --network    # ...plus the read-only load check against each live network
#
# One-time setup (see contracts/README.md):
#   python3 -m venv .venv && .venv/bin/pip install --pre 'genlayer-test>=0.30.0rc2' pytest pillow pycryptodome
#   uv venv -p 3.13 .venv-studio && uv pip install -p .venv-studio/bin/python 'genlayer-test==0.29.2' pytest pillow pycryptodome
set -euo pipefail
cd "$(dirname "$0")/.."

LINT=(uvx -q --prerelease allow --from 'genvm-linter>=0.11.1rc2' genvm-lint)
field() { python3 -c "import json,sys; t=json.load(open('contracts/targets.json'))['targets']['$1']; v=t; [v:=v[k] for k in sys.argv[1:]]; print(v)" "${@:2}"; }

python3 contracts/build.py --check

for target in $(python3 -c "import json; print(' '.join(json.load(open('contracts/targets.json'))['targets']))"); do
  genvm=$(field "$target" genvm)
  repo=$(field "$target" genvm_repo)
  py=$(field "$target" direct_tests python)
  echo "== $target (GenVM $genvm, $(field "$target" runner))"
  UPTIME_TARGET=$target GENVM_VERSION=$genvm "$py" -m pytest test/direct -q -p no:cacheprovider 2>&1 | tail -1
  test "${PIPESTATUS[0]}" -eq 0
  for f in contracts/build/"$target"/*.py; do
    GENVM_REPO=$repo GENVM_VERSION=$genvm "${LINT[@]}" check "$f" >/dev/null || { echo "lint FAILED: $f"; exit 1; }
  done
  echo "genvm-lint: $(ls contracts/build/"$target"/*.py | wc -l | tr -d ' ') files ok"
done

if [[ "${1:-}" == "--network" ]]; then
  node contracts/load-check.mjs
fi
