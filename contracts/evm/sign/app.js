// Page wiring. All transaction logic is in lib.js (the same code check.mjs runs on an anvil fork).
import { DATA } from "./data.js";
import * as L from "./lib.js";

const $ = (id) => document.getElementById(id);
const ZERO = "0x0000000000000000000000000000000000000000";
const eth = window.ethereum;
// ?rpc=<url> points reads at another node (used to test the page against a local anvil fork).
const rpcOverride = new URLSearchParams(location.search).get("rpc");
let reader = L.makeReader(rpcOverride || L.RPC_URLS[0]);
let account = null;
let busy = false;
let stopRequested = false;

$("rpc").textContent = reader.url;

// ---------------------------------------------------------------- storage (resume) + log

const store = {
  get(k) { try { return localStorage.getItem("uptime-sign:4221:" + k); } catch { return null; } },
  set(k, v) { try { v ? localStorage.setItem("uptime-sign:4221:" + k, v) : localStorage.removeItem("uptime-sign:4221:" + k); } catch {} },
};
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  $("log").textContent += line;
  $("log").scrollTop = $("log").scrollHeight;
  try { const all = (localStorage.getItem("uptime-sign:log") || "") + line; localStorage.setItem("uptime-sign:log", all.slice(-20000)); } catch {}
}
try { $("log").textContent = localStorage.getItem("uptime-sign:log") || ""; } catch {}

const errText = (e) => (e?.code === 4001 ? "rejected in MetaMask" : e?.message || String(e));

// ---------------------------------------------------------------- wallet + chain

async function ensureChain() {
  const id = await eth.request({ method: "eth_chainId" });
  if (id === L.CHAIN_ID_HEX) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: L.CHAIN_ID_HEX }] });
  } catch (e) {
    if (e.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
    await eth.request({ method: "wallet_addEthereumChain", params: [{
      chainId: L.CHAIN_ID_HEX, chainName: "GenLayer Bradbury Testnet",
      nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: L.RPC_URLS }] });
  }
  const after = await eth.request({ method: "eth_chainId" });
  if (after !== L.CHAIN_ID_HEX) throw new Error(`MetaMask is on chain ${parseInt(after, 16)}, not 4221`);
}

async function refreshWallet() {
  if (!eth) { updatePool(); return; }
  const accts = await eth.request({ method: "eth_accounts" });
  account = accts[0] ? L.checksum(accts[0]) : null;
  const id = await eth.request({ method: "eth_chainId" });
  $("acct").textContent = account || "not connected";
  $("net").innerHTML = id === L.CHAIN_ID_HEX ? `<span class="ok">Bradbury (4221)</span>` : `<span class="bad">chain ${parseInt(id, 16)} — will switch to 4221</span>`;
  if (account) {
    const bal = BigInt(await reader.call("eth_getBalance", [account, "latest"]));
    $("bal").textContent = `${(Number(bal / 10n ** 12n) / 1e6).toFixed(6)} GEN (on 4221)`;
  } else $("bal").textContent = "—";
  updatePool();
  updateDlgButtons();
  updateMailer();
}

$("connect").onclick = async () => {
  if (!eth) { alert("No window.ethereum: open this page in a browser with MetaMask."); return; }
  try {
    await eth.request({ method: "eth_requestAccounts" });
    await ensureChain();
  } catch (e) { log(`connect: ${errText(e)}`); }
  await refreshWallet();
};
if (eth) {
  eth.on?.("accountsChanged", refreshWallet);
  eth.on?.("chainChanged", refreshWallet);
}

const sendViaMetaMask = async (tx) => {
  await ensureChain();
  const [cur] = await eth.request({ method: "eth_accounts" });
  if (!cur || cur.toLowerCase() !== tx.from.toLowerCase()) throw new Error("MetaMask account changed; reconnect");
  // MetaMask can keep a stale local nonce for chain 4221 (Phase 1 history under the same
  // chain id -> "nonce too high"). Pin the chain's own pending nonce on every send.
  const nonce = await reader.call("eth_getTransactionCount", [tx.from, "pending"]);
  log(`nonce from chain: ${parseInt(nonce, 16)}`);
  return eth.request({ method: "eth_sendTransaction", params: [{ ...tx, nonce }] });
};

// ---------------------------------------------------------------- 1. UptimePool (v1) and 1b. UptimePoolV2
// Two copies of one section: same constructor, same CREATE2 path, different creation code.
// Element ids: <prefix>-delay, -scheduler, -mailer, -salt, -admin, -addr, -state, -summary, -go.

const D = DATA.pool.defaults;

function poolSection(prefix, build, label) {
  const el = (k) => $(`${prefix}-${k}`);
  el("delay").value = D.rotationDelay;
  el("scheduler").value = D.scheduler;
  el("mailer").value = D.mailer;
  el("salt").value = D.salt;
  let tx = null;
  let seq = 0;

  function args() {
    const scheduler = el("scheduler").value.trim(), mailer = el("mailer").value.trim(), salt = el("salt").value.trim();
    const delay = el("delay").value.trim();
    if (!account) return { err: "Connect MetaMask: admin is the connected account." };
    if (!L.isAddress(scheduler)) return { err: "scheduler is not an address" };
    if (!L.isAddress(mailer)) return { err: "mailer is not an address" };
    if (scheduler.toLowerCase() !== ZERO && scheduler.toLowerCase() === mailer.toLowerCase())
      return { err: "scheduler and mailer are the same address: the constructor reverts (SpenderHasRole). Use distinct addresses or zero for one." };
    if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) return { err: "salt must be 32 bytes hex" };
    if (!/^\d+$/.test(delay) || BigInt(delay) >= 2n ** 64n) return { err: "rotationDelay must be a uint64" };
    return { admin: account, rotationDelay: Number(delay), scheduler: L.checksum(scheduler), mailer: L.checksum(mailer), salt };
  }

  async function showDeployed(addr) {
    const st = await L.readPool(reader, addr);
    const a = tx?.args;
    const match = a && st.admin === L.checksum(a.admin) && st.rotationDelay === a.rotationDelay &&
      st.scheduler === L.checksum(a.scheduler) && st.mailer === L.checksum(a.mailer);
    el("state").innerHTML = `<span class="ok">DEPLOYED — code present.</span> On-chain: admin ${st.admin}, rotationDelay ${st.rotationDelay}, scheduler ${st.scheduler}, mailer ${st.mailer} ` +
      (match ? `<span class="ok">(matches)</span>` : `<span class="bad">(does NOT match the fields above)</span>`);
    store.set(`${prefix}:last`, addr);
  }

  async function update() {
    const my = ++seq;
    el("admin").value = account || "(connect MetaMask)";
    const a = args();
    el("go").disabled = true;
    if (a.err) { tx = null; el("addr").textContent = "—"; el("state").innerHTML = `<span class="bad">${a.err}</span>`; el("summary").textContent = ""; return; }
    tx = build(DATA, a);
    el("addr").textContent = tx.expected;
    el("state").textContent = "checking chain…";
    el("summary").textContent = "";
    try {
      const code = await reader.call("eth_getCode", [tx.expected, "latest"]);
      if (my !== seq) return;
      if (L.hasCode(code)) { await showDeployed(tx.expected); return; }
      const est = await L.estimate(reader, account, tx);
      if (my !== seq) return;
      const pending = store.get(tx.key);
      el("state").innerHTML = pending ? `<span class="warn">Not deployed yet; an earlier tx ${pending} is stored and will be awaited first.</span>` : "Not deployed yet.";
      el("summary").textContent = `On click: 1 MetaMask prompt — call CREATE2 factory 0x4e59…956C, deploys ${label} at ${tx.expected}, admin ${a.admin}, est ${est.toLocaleString("en-US")} gas, sent with gas ${L.gasWithHeadroom(est).toLocaleString("en-US")}, value 0.`;
      el("go").disabled = busy;
    } catch (e) {
      if (my === seq) el("state").innerHTML = `<span class="bad">eth_estimateGas failed: ${errText(e)} — not sendable as-is.</span>`;
    }
  }
  for (const k of ["delay", "scheduler", "mailer", "salt"]) el(k).addEventListener("input", update);

  el("go").onclick = async () => {
    if (!tx || busy) return;
    busy = true; disablePoolButtons(); updateDlgButtons();
    const t = tx;
    try {
      await L.runTx({
        reader, from: account, send: sendViaMetaMask, store, log,
        status: (k, s, x = {}) => {
          if (s === "signing") el("summary").textContent = "CONFIRM IN METAMASK: " + x.summary;
          if (s === "mining") el("summary").textContent = `Sent ${x.hash} — waiting for receipt…`;
          if (s === "waiting") el("summary").textContent = `Waiting for earlier tx ${x.hash}…`;
          if (s === "deployed") el("summary").textContent = `Deployed. Tx ${x.hash || ""}`;
        },
      }, t);
      await showDeployed(t.expected);
      log(`${label} at ${t.expected}`);
    } catch (e) {
      log(`${label}: ${errText(e)}`);
      el("summary").textContent = `Stopped: ${errText(e)}`;
    } finally { busy = false; updateDlgButtons(); updatePool(); }
  };

  return { update, disable: () => { el("go").disabled = true; } };
}

const poolSections = [
  poolSection("p", L.buildPoolTx, "UptimePool"),
  poolSection("v", L.buildPoolV2Tx, "UptimePoolV2"),
];
function updatePool() { for (const s of poolSections) s.update(); }
function disablePoolButtons() { for (const s of poolSections) s.disable(); }

// ---------------------------------------------------------------- 2. Delegation

const dlg = L.buildDelegationTxs(DATA);
const rowState = {};
$("d-rows").innerHTML = dlg.map((t) => `<tr id="r-${t.index}"><td>${t.index + 1}</td><td>${t.name}</td><td class="mono">${t.expected}</td><td class="st">…</td><td class="gas mono"></td><td class="tx mono"></td></tr>`).join("");

const LABEL = { present: '<span class="ok">has code</span>', deployed: '<span class="ok">deployed now</span>', missing: "missing",
  estimating: '<span class="warn">estimating…</span>', signing: '<span class="warn">SIGN IN METAMASK</span>',
  mining: '<span class="warn">mining…</span>', waiting: '<span class="warn">awaiting stored tx…</span>', error: '<span class="bad">error</span>' };

function setRow(t, s, x = {}) {
  rowState[t.key] = s;
  const r = $(`r-${t.index}`);
  r.querySelector(".st").innerHTML = LABEL[s] || s;
  if (x.est) r.querySelector(".gas").textContent = `${x.est} / ${x.gas}`;
  if (x.hash) r.querySelector(".tx").textContent = x.hash;
  const done = dlg.filter((d) => rowState[d.key] === "present" || rowState[d.key] === "deployed").length;
  $("d-progress").innerHTML = done === dlg.length ? `<span class="ok">${done} / ${dlg.length} contracts have code — complete</span>` : `${done} / ${dlg.length} contracts have code · ${dlg.length - done} to send`;
}

async function scan() {
  $("d-summary").textContent = "Reading code at all 44 addresses…";
  try {
    const codes = await L.codeMap(reader, dlg);
    for (const t of dlg) {
      setRow(t, codes[t.key] ? "present" : "missing");
      const h = store.get(t.key);
      if (!codes[t.key] && h) $(`r-${t.index}`).querySelector(".tx").textContent = `${h} (stored, will be awaited)`;
    }
    const missing = dlg.filter((t) => !codes[t.key]).length;
    $("d-summary").textContent = missing ? `On click: up to ${missing} MetaMask prompts, one per missing contract, in order. Each prompt is preceded by its one-line summary here.` : "Nothing to send.";
  } catch (e) { $("d-summary").textContent = `Scan failed: ${errText(e)}`; }
  updateDlgButtons();
}

function updateDlgButtons() {
  const missing = dlg.some((t) => !["present", "deployed"].includes(rowState[t.key]));
  $("d-go").disabled = busy || !account || !missing;
  $("d-rescan").disabled = busy;
  $("d-stop").disabled = !busy || stopRequested;
}

$("d-rescan").onclick = scan;
$("d-stop").onclick = () => { stopRequested = true; updateDlgButtons(); log("stop requested: will stop after the current tx"); };
$("d-go").onclick = async () => {
  if (busy) return;
  busy = true; stopRequested = false; updateDlgButtons(); disablePoolButtons();
  const from = account;
  try {
    for (const t of dlg) {
      if (["present", "deployed"].includes(rowState[t.key])) continue;
      if (stopRequested) { log("stopped by request"); break; }
      const pos = dlg.filter((d) => !["present", "deployed"].includes(rowState[d.key])).length;
      await L.runTx({
        reader, from, send: sendViaMetaMask, store, log,
        status: (k, s, x = {}) => {
          setRow(t, s, x);
          if (s === "signing") $("d-summary").textContent = `CONFIRM IN METAMASK (#${t.index + 1}, ${pos} left): ${x.summary}`;
          if (s === "mining") $("d-summary").textContent = `#${t.index + 1} ${t.name}: sent ${x.hash}, waiting for receipt…`;
        },
      }, t).catch((e) => { setRow(t, "error"); throw e; });
    }
    if (dlg.every((t) => ["present", "deployed"].includes(rowState[t.key]))) {
      $("d-summary").textContent = "All 44 contracts have code at their canonical addresses.";
      log("delegation: all 44 present");
    }
  } catch (e) {
    log(`delegation: ${errText(e)}`);
    $("d-summary").textContent = `Stopped: ${errText(e)}. Click Deploy again to resume.`;
  } finally { busy = false; updateDlgButtons(); updatePool(); }
};

// ---------------------------------------------------------------- 3. Set mailer (spender role 2)

const LIVE_POOL = "0x5ea32AdBDF2f3C68C2Fe5566ec3156bF88e41d0A"; // UPTIME_POOL_BRADBURY, INTEGRATIONS.md
$("m-pool").value = store.get("v:last") || "0xcEb88f1f41AE2a12f50330C8c474C640D71dF355";
$("m-addr").value = "0xb69619D3D7923316bb442C1A4D2aD9DE88aF4774"; // "Uptime Mailer (Bradbury)", 1Password vault Uptime Production
let mSeq = 0;

async function updateMailer() {
  const seq = ++mSeq;
  const pool = $("m-pool").value.trim(), addr = $("m-addr").value.trim();
  $("m-propose").disabled = true; $("m-execute").disabled = true;
  if (!L.isAddress(pool)) { $("m-state").innerHTML = `<span class="bad">pool is not an address</span>`; return; }
  try {
    const st = await L.readPool(reader, pool);
    const p = await L.readPendingSpender(reader, pool, L.ROLE_MAILER);
    if (seq !== mSeq) return;
    const now = Math.floor(Date.now() / 1000);
    const pend = p.exists ? `pending ${p.spender}, executable ${p.eta <= now ? "now" : new Date(p.eta * 1000).toISOString()}` : "nothing pending";
    let msg = `On-chain: admin ${st.admin}, rotationDelay ${st.rotationDelay}s, scheduler ${st.scheduler}, mailer ${st.mailer}; role 2 ${pend}.`;
    let err = null;
    if (!account) err = "Connect MetaMask.";
    else if (account.toLowerCase() !== st.admin.toLowerCase()) err = `Connected account is not the pool admin ${st.admin}.`;
    $("m-execute").disabled = busy || !!err || !p.exists || p.eta > now;
    if (!err && !L.isAddress(addr)) err = "Enter the new mailer address.";
    else if (!err && addr.toLowerCase() === st.scheduler.toLowerCase()) err = "That is the scheduler: one address can hold only one role (SpenderHasRole).";
    else if (!err && addr.toLowerCase() === st.mailer.toLowerCase()) msg += ' <span class="ok">Already the mailer.</span>';
    $("m-state").innerHTML = msg + (err ? ` <span class="bad">${err}</span>` : "");
    $("m-propose").disabled = busy || !!err || addr.toLowerCase() === st.mailer.toLowerCase();
  } catch (e) {
    if (seq === mSeq) $("m-state").innerHTML = `<span class="bad">read failed: ${errText(e)}</span>`;
  }
}
for (const id of ["m-pool", "m-addr"]) $(id).addEventListener("input", updateMailer);

async function mailerTx(build) {
  if (busy) return;
  busy = true; $("m-propose").disabled = true; $("m-execute").disabled = true;
  try {
    const tx = build();
    await L.runCall({ reader, from: account, send: sendViaMetaMask, log,
      status: (s, x = {}) => {
        if (s === "signing") $("m-summary").textContent = "CONFIRM IN METAMASK: " + x.summary;
        if (s === "mining") $("m-summary").textContent = `Sent ${x.hash}, waiting for receipt…`;
      } }, tx);
    $("m-summary").textContent = `${tx.name}: done.`;
  } catch (e) {
    log(`mailer: ${errText(e)}`);
    $("m-summary").textContent = `Stopped: ${errText(e)}`;
  } finally { busy = false; updateMailer(); updateDlgButtons(); }
}
$("m-propose").onclick = () => mailerTx(() => L.buildProposeSpenderTx($("m-pool").value.trim(), L.ROLE_MAILER, $("m-addr").value.trim()));
$("m-execute").onclick = () => mailerTx(() => L.buildExecuteSpenderTx($("m-pool").value.trim(), L.ROLE_MAILER));

// ---------------------------------------------------------------- boot

(async () => {
  if (!rpcOverride) try { await reader.call("eth_chainId"); } catch { reader = L.makeReader(L.RPC_URLS[1]); $("rpc").textContent = reader.url; }
  const last = store.get("p:last") || store.get("pool:last");
  if (last) log(`last UptimePool deployed from this browser: ${last}`);
  const lastV2 = store.get("v:last");
  if (lastV2) log(`last UptimePoolV2 deployed from this browser: ${lastV2}`);
  await refreshWallet().catch((e) => log(errText(e)));
  await scan();
})();
