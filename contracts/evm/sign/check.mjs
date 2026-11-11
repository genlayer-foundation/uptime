// Read-only and fork checks for the signing page, using the page's own lib.js + data.js.
//
//   node check.mjs estimate [rpc]      Bradbury, READ-ONLY: Safe contracts present, predicted addresses
//                                      (the admin Safe, UptimePool, UptimePoolV2, the 44 delegation
//                                      contracts), eth_getCode, eth_estimateGas for every tx from
//                                      FROM (nothing is signed). The Safe is the one section 0
//                                      would create for SAFE_OWNERS / SAFE_THRESHOLD / SAFE_NONCE.
//   node check.mjs fork http://127.0.0.1:8545
//                                      Full flow against an anvil fork, sending from anvil's
//                                      unlocked account 0 through the same runTx() the page uses:
//                                      Safe, v2 pool with that Safe as admin, v1 pool, delegation.
//                                      Add `quick` to stop after the pools (skips the 44 delegation txs).
// Env: FROM (estimate mode; default the Uptime admin wallet), SCHEDULER, MAILER,
//      SAFE_VERSION (default 1.4.1), SAFE_OWNERS (comma-separated; default FROM), SAFE_THRESHOLD (default 1),
//      SAFE_NONCE (default 0).
import { DATA } from "./data.js";
import * as L from "./lib.js";

const [mode = "estimate", rpc = L.RPC_URLS[0], opt = ""] = process.argv.slice(2);
const reader = L.makeReader(rpc);
const D = DATA.pool.defaults;
const D2 = DATA.poolV2.defaults;
const scheduler = process.env.SCHEDULER || D.scheduler;
const mailer = process.env.MAILER || D.mailer;
const mailerV2 = process.env.MAILER || D2.mailer;
if (L.keccakHex(DATA.poolV2.creationCode) !== DATA.poolV2.creationCodeHash) throw new Error("data.js: poolV2 creation code does not match its hash");
console.log(`data.js UptimePoolV2 creation code keccak256 ${DATA.poolV2.creationCodeHash}`);

/** The admin Safe exactly as section 0 of the page builds it. */
async function safeTxFor(from) {
  const version = process.env.SAFE_VERSION || "1.4.1";
  for (const v of Object.keys(L.SAFE_DEPLOYMENTS)) { const d = await L.checkSafeDeployment(reader, v); console.log(`Safe ${v}: factory ${d.factory}, singleton ${d.singleton}, fallback handler ${d.fallbackHandler} have code, VERSION ok`); }
  const owners = (process.env.SAFE_OWNERS || from).split(",").map((x) => x.trim());
  return L.buildCreateSafeTx({ version, owners, threshold: Number(process.env.SAFE_THRESHOLD || 1), saltNonce: BigInt(process.env.SAFE_NONCE || 0) },
    await L.readProxyCreationCode(reader, version));
}

const chain = await reader.call("eth_chainId");
if (chain !== L.CHAIN_ID_HEX) throw new Error(`chainId ${chain}, want ${L.CHAIN_ID_HEX}`);
const dlg = L.buildDelegationTxs(DATA);
console.log(`rpc ${rpc} chainId ${parseInt(chain, 16)}; ${dlg.length} delegation txs, all CREATE2 addresses = manifest`);

if (mode === "estimate") {
  const from = process.env.FROM || "0x3B49b8ed8b0f59eea6805F87673920f2Fd43Da97";
  const pool = L.buildPoolTx(DATA, { admin: from, rotationDelay: D.rotationDelay, scheduler, mailer, salt: D.salt });
  const safe = await safeTxFor(from);
  const poolV2 = L.buildPoolV2Tx(DATA, { admin: safe.expected, rotationDelay: D2.rotationDelay, scheduler, mailer: mailerV2, salt: D2.salt });
  console.log(`admin Safe ${safe.name}, owners ${safe.args.owners.join(",")}, saltNonce ${safe.args.saltNonce} -> ${safe.expected}`);
  console.log(`UptimePoolV2 with that admin, rotationDelay ${D2.rotationDelay}, scheduler ${scheduler}, mailer ${mailerV2} -> ${poolV2.expected}`);
  const all = [safe, pool, poolV2, ...dlg];
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
  // Section 0 then 1b: create the Safe, then the v2 pool with that Safe as admin.
  const safe = await safeTxFor(from);
  const sim = await reader.call("eth_call", [{ from, to: safe.to, data: safe.data }, "latest"]);
  if (sim.slice(26).toLowerCase() !== safe.expected.slice(2).toLowerCase()) throw new Error("Safe address prediction disagrees with the factory");
  const rs = await L.runTx(env, safe);
  const sst = await L.readSafe(reader, safe.expected);
  console.log(`safe ${rs.state} at ${safe.expected} gasUsed ${rs.gasUsed} ->`, sst);
  if (sst.threshold !== safe.args.threshold || sst.owners.join() !== safe.args.owners.join() || sst.version !== safe.args.version) throw new Error("safe state mismatch");
  const v2args = { admin: safe.expected, rotationDelay: D2.rotationDelay, scheduler, mailer: mailerV2, salt: D2.salt };
  for (const bad of [{ rotationDelay: 0 }, { rotationDelay: D2.rotationDelay - 1 }, { scheduler: safe.expected }]) {
    // The constructor must refuse a delay under 48 h and an admin that is also a spender.
    let refused = false;
    try { await L.estimate(reader, from, L.buildPoolV2Tx(DATA, { ...v2args, ...bad })); } catch { refused = true; }
    if (!refused) throw new Error(`v2 deploy with ${JSON.stringify(bad)} was NOT refused`);
  }
  console.log("v2 deploy refused for rotationDelay 0, rotationDelay 172799 and admin == scheduler");
  const poolV2 = L.buildPoolV2Tx(DATA, v2args);
  const r2 = await L.runTx(env, poolV2);
  const st2 = await L.readPool(reader, poolV2.expected);
  const min = await L.readMinRotationDelay(reader, poolV2.expected);
  console.log(`poolV2 ${r2.state} at ${poolV2.expected} gasUsed ${r2.gasUsed} MIN_ROTATION_DELAY ${min} ->`, st2);
  if (st2.admin.toLowerCase() !== safe.expected.toLowerCase() || st2.rotationDelay !== 172800 || min !== 172800 ||
      st2.scheduler.toLowerCase() !== scheduler.toLowerCase() || st2.mailer.toLowerCase() !== mailerV2.toLowerCase())
    throw new Error("poolV2 state mismatch");
  // The deployer (an owner key, but not the Safe itself) cannot rotate a spender.
  let direct = false;
  try { await L.estimate(reader, from, L.buildProposeSpenderTx(poolV2.expected, L.ROLE_MAILER, from)); direct = true; } catch {}
  if (direct) throw new Error("a non-admin could call proposeSpender");
  console.log("proposeSpender from the deployer (not the Safe) reverts: only the Safe is admin");
  // Pool v1: admin = sender, as the page does with the connected MetaMask account.
  const pool = L.buildPoolTx(DATA, { admin: from, rotationDelay: D.rotationDelay, scheduler, mailer, salt: D.salt });
  const r = await L.runTx(env, pool);
  const st = await L.readPool(reader, pool.expected);
  console.log(`pool ${r.state} at ${pool.expected} gasUsed ${r.gasUsed} ->`, st);
  if (st.admin.toLowerCase() !== from.toLowerCase() || st.rotationDelay !== 0 ||
      st.scheduler.toLowerCase() !== scheduler.toLowerCase() || st.mailer.toLowerCase() !== mailer.toLowerCase())
    throw new Error("pool state mismatch");
  for (const t of [safe, poolV2]) { const again = await L.runTx(env, t); if (again.state !== "present") throw new Error(`${t.name} not idempotent`); }
  if (opt === "quick") { console.log("FORK RUN OK (quick: delegation skipped)"); process.exit(0); }
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
