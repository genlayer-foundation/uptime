#!/usr/bin/env node
// Read-only load check of every build against the network it targets. NO transaction, NO deploy.
//
//   node contracts/load-check.mjs              # every target in contracts/targets.json
//   node contracts/load-check.mjs studio       # one target
//
// studio:   gen_getContractSchemaForCode(hex code) -> the network's GenVM loads the code and
//           returns its schema (proves runner pin + SDK dialect).
// bradbury: gen_call {type: "deploy"} -> runs the constructor on the network's real GenVM
//           without sending a transaction.
// Needs frontend/node_modules (genlayer-js) for the calldata/RLP encoding.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { abi } = await import(join(here, "../frontend/node_modules/genlayer-js/dist/index.js"));
const { targets } = JSON.parse(readFileSync(join(here, "targets.json"), "utf8"));

// Constructor args for the dry-run deploy: harmless placeholders, nothing is stored.
const ZERO = "0x0000000000000000000000000000000000000001";
const ARGS = {
  canary: [1],
  heartbeat: ["https://uptime.genlayer.foundation/heartbeat", ZERO],
  web_probe: [],
  ask: [],
  mail_escrow: [ZERO, ZERO, "example.com", "s1", "0".repeat(64), 1, 0, "https://dns.google/resolve"],
};

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    // Studio's edge rejects Python's default User-Agent; any browser-ish one passes.
    headers: { "content-type": "application/json", "user-agent": "uptime-load-check/1 (node)" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
  return body.result;
}

const checks = {
  async gen_getContractSchemaForCode(url, code) {
    const schema = await rpc(url, "gen_getContractSchemaForCode", [Buffer.from(code).toString("hex")]);
    const methods = Object.keys(schema?.methods ?? {}).length;
    return `schema ok, ${methods} methods`;
  },
  async gen_call_deploy(url, code, args) {
    const data = abi.transactions.serialize([
      code,
      abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args, undefined)),
      false,
    ]);
    const r = await rpc(url, "gen_call", [
      { type: "deploy", from: ZERO, data, transaction_hash_variant: "latest-nonfinal" },
    ]);
    // A wrong runner pin is an RPC error ("invalid_contract runner malformed"); a raising
    // constructor is a non-zero status.
    if (r?.status?.code !== 0) throw new Error(`constructor did not return: ${JSON.stringify(r?.status ?? r).slice(0, 300)}`);
    return "constructor ran";
  },
};

const only = process.argv.slice(2);
let failed = 0;
for (const [target, spec] of Object.entries(targets)) {
  if (only.length && !only.includes(target)) continue;
  for (const name of Object.keys(ARGS)) {
    const code = readFileSync(join(here, "build", target, `${name}.py`), "utf8");
    try {
      const msg = await checks[spec.load_check.method](spec.rpc, code, ARGS[name]);
      console.log(`ok   ${target}/${name}.py  ${msg}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${target}/${name}.py  ${e.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
