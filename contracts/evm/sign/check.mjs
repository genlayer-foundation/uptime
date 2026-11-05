// Read-only and fork checks for the signing page, using the page's own lib.js + data.js.
//
//   node check.mjs estimate [rpc]      Bradbury, READ-ONLY: predicted addresses, eth_getCode,
//                                      eth_estimateGas for every tx from FROM (nothing is signed).
//   node check.mjs fork http://127.0.0.1:8545
//                                      Full flow against an anvil fork, sending from anvil's
//                                      unlocked account 0 through the same runTx() the page uses.
// Env: FROM (estimate mode; default the Uptime admin wallet), SCHEDULER, MAILER.
import { DATA } from "./data.js";
import * as L from "./lib.js";

const [mode = "estimate", rpc = L.RPC_URLS[0]] = process.argv.slice(2);
const reader = L.makeReader(rpc);
const D = DATA.pool.defaults;
const scheduler = process.env.SCHEDULER || D.scheduler;
const mailer = process.env.MAILER || D.mailer;

const chain = await reader.call("eth_chainId");
if (chain !== L.CHAIN_ID_HEX) throw new Error(`chainId ${chain}, want ${L.CHAIN_ID_HEX}`);
const dlg = L.buildDelegationTxs(DATA);
console.log(`rpc ${rpc} chainId ${parseInt(chain, 16)}; ${dlg.length} delegation txs, all CREATE2 addresses = manifest`);

if (mode === "estimate") {
  const from = process.env.FROM || "0x3B49b8ed8b0f59eea6805F87673920f2Fd43Da97";
  const pool = L.buildPoolTx(DATA, { admin: from, rotationDelay: D.rotationDelay, scheduler, mailer, salt: D.salt });
  const all = [pool, ...dlg];
  const codes = await L.codeMap(reader, all);
  let ok = 0, fail = 0, total = 0n;
  for (const t of all) {
    let line;
    try {
      const est = await L.estimate(reader, from, t); total += est; ok++;
      line = `est ${est.toString().padStart(9)}  gas ${L.gasWithHeadroom(est).toString().padStart(9)}`;
    } catch (e) { fail++; line = `ESTIMATE FAILED: ${e.message}`; }
    console.log(`${codes[t.key] ? "HAS CODE" : "missing "} ${t.expected}  ${t.name.padEnd(48)} ${line}`);
  }
  console.log(`estimates ok ${ok}, failed ${fail}, total estimated gas ${total}`);
  process.exit(fail ? 1 : 0);
}

if (mode === "fork") {
  const [from] = await reader.call("eth_accounts");
  // Mine on a 1s interval instead of instantly, so receipts are awaited as on the real chain.
  await reader.call("evm_setAutomine", [false]);
  await reader.call("evm_setIntervalMining", [1]);
  const mem = new Map();
  const env = {
    reader, from,
    send: (tx) => reader.call("eth_sendTransaction", [tx]),
    store: { get: (k) => mem.get(k) || null, set: (k, v) => (v ? mem.set(k, v) : mem.delete(k)) },
    log: () => {}, status: () => {},
  };
  // Pool: admin = sender, as the page does with the connected MetaMask account.
  const pool = L.buildPoolTx(DATA, { admin: from, rotationDelay: D.rotationDelay, scheduler, mailer, salt: D.salt });
  const r = await L.runTx(env, pool);
  const st = await L.readPool(reader, pool.expected);
  console.log(`pool ${r.state} at ${pool.expected} gasUsed ${r.gasUsed} ->`, st);
  if (st.admin.toLowerCase() !== from.toLowerCase() || st.rotationDelay !== 0 ||
      st.scheduler.toLowerCase() !== scheduler.toLowerCase() || st.mailer.toLowerCase() !== mailer.toLowerCase())
    throw new Error("pool state mismatch");
  // Resume path: send tx #1 outside runTx and leave only its (unmined) hash in the store, as a
  // reload mid-flight would; runTx must wait for that hash instead of sending a second tx.
  const nonce0 = parseInt(await reader.call("eth_getTransactionCount", [from, "latest"]), 16);
  const pre = dlg[0];
  const gas0 = "0x" + L.gasWithHeadroom(await L.estimate(reader, from, pre)).toString(16);
  await reader.call("evm_setIntervalMining", [0]); // hold it in the mempool
  mem.set(pre.key, await env.send({ from, to: pre.to, data: pre.data, value: "0x0", gas: gas0 }));
  const seen = [];
  const resumed = L.runTx({ ...env, status: (k, s) => seen.push(s) }, pre);
  setTimeout(() => reader.call("evm_setIntervalMining", [1]), 3000);
  const r0 = await resumed;
  if (r0.state !== "deployed" || !seen.includes("waiting") || seen.includes("signing")) throw new Error(`resume path not taken: ${seen}`);
  console.log(`resume: ${pre.name} sent before "reload", runTx waited on the stored hash and did not re-send (${seen.join(" -> ")})`);
  const counts = { present: 0, deployed: 1 };
  for (const t of dlg.slice(1)) { const x = await L.runTx(env, t); counts[x.state]++; }
  const sent = parseInt(await reader.call("eth_getTransactionCount", [from, "latest"]), 16) - nonce0;
  console.log(`delegation pass 1: deployed ${counts.deployed}, already present ${counts.present}; delegation txs sent ${sent}`);
  if (counts.deployed !== dlg.length || sent !== dlg.length) throw new Error("count wrong");
  const again = { present: 0, deployed: 0 };
  for (const t of dlg) { const x = await L.runTx(env, t); again[x.state]++; }
  console.log(`delegation pass 2 (idempotency): deployed ${again.deployed}, already present ${again.present}`);
  const again2 = await L.runTx(env, pool);
  console.log(`pool pass 2: ${again2.state}`);
  if (again.deployed || again.present !== dlg.length || again2.state !== "present") throw new Error("not idempotent");
  console.log("FORK RUN OK");
}
