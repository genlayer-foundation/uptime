#!/usr/bin/env bash
# Offline: recompute every CREATE2 address in the manifest and compare with the
# canonical one. No RPC. Exit 1 on any mismatch.
set -euo pipefail
M="${1:-$(dirname "$0")/../manifest/canonical-v1.3.0.json}"
F=$(jq -r .factory "$M"); bad=0
while IFS=$'\t' read -r n a s i; do
  c=$(cast create2 --deployer "$F" --salt "$s" --init-code "$i" | grep -oE '0x[0-9a-fA-F]{40}')
  if [ "$(tr A-F a-f <<<"$c")" = "$(tr A-F a-f <<<"$a")" ]; then echo "OK        $a  $n"; else echo "MISMATCH  $a  $n (computed $c)"; bad=1; fi
done < <(jq -r '.contracts[] | [.name,.address,.salt,.initcode] | @tsv' "$M")
exit $bad
