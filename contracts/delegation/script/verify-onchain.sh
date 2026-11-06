#!/usr/bin/env bash
# eth_getCode on every canonical address in ONE JSON-RPC batch (the public Bradbury RPC
# rate-limits after ~45 calls). Prints OK/MISSING per contract, exit 1 if any is missing.
# Request ids start at 1: the Bradbury RPC echoes a batch id of 0 back as 1.
#   script/verify-onchain.sh [rpc-url]     (default https://rpc-bradbury.genlayer.com)
set -euo pipefail
RPC="${1:-https://rpc-bradbury.genlayer.com}"
M="$(dirname "$0")/../manifest/canonical-v1.3.0.json"
req=$(jq -c '[.contracts | to_entries[] | {jsonrpc:"2.0", id:(.key+1), method:"eth_getCode", params:[.value.address,"latest"]}]
             + [{jsonrpc:"2.0", id:9999, method:"eth_chainId", params:[]}]' "$M")
resp=$(curl -sS -X POST -H 'content-type: application/json' --data "$req" "$RPC")
chain=$(jq -r '.[] | select(.id==9999) | .result' <<<"$resp")
echo "chainId $chain ($((chain)))"
bad=0
while IFS=$'\t' read -r i name addr; do
  code=$(jq -r --argjson i "$i" '.[] | select(.id==($i+1)) | (.result // ("ERR " + (.error.message // "?")))' <<<"$resp")
  if [[ "$code" == 0x?* && "$code" != "0x" ]]; then printf 'OK       %s  %-48s %d bytes\n' "$addr" "$name" $(( (${#code}-2)/2 ));
  else printf 'MISSING  %s  %-48s %s\n' "$addr" "$name" "$code"; bad=1; fi
done < <(jq -r '.contracts | to_entries[] | [.key, .value.name, .value.address] | @tsv' "$M")
exit $bad
