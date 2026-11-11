// Page wiring. All transaction logic is in lib.js (the same code check.mjs runs on an anvil fork).
// lib.js and data.js are loaded with this module's own cache-busting query (index.html adds a
// fresh one on every page load), so a cached copy of either can never be served: a stale data.js
// once blocked a deploy.
const BUST = new URL(import.meta.url).search || `?v=${Date.now()}`;
const { DATA } = await import(`./data.js${BUST}`);
const L = await import(`./lib.js${BUST}`);

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

// v2 only: is data.js the build that has the 48 h floor, and is its creation code intact?
const V2 = DATA.poolV2;
const v2BuildError = !V2?.minRotationDelay || !V2.defaults ? "data.js is from before the 48 h rotation floor (stale). Run build-data.mjs and reload."
  : L.keccakHex(V2.creationCode) !== V2.creationCodeHash ? "data.js creation code does not match its own hash. Run build-data.mjs and reload." : null;
if ($("v-build")) $("v-build").innerHTML = v2BuildError ? `<span class="bad">${v2BuildError}</span>`
  : `data.js: UptimePoolV2 creation code keccak256 ${V2.creationCodeHash} (compare with <code>node build-data.mjs --check</code>)`;

/** One pool deploy section. `safeAdmin`: admin is typed in and must be a deployed Safe (v2);
 *  otherwise admin is the connected account (v1). */
function poolSection({ prefix, build, label, defaults: D, safeAdmin = false, blocked = null }) {
  const el = (k) => $(`${prefix}-${k}`);
  el("delay").value = D.rotationDelay;
  el("scheduler").value = D.scheduler;
  el("mailer").value = D.mailer;
  el("salt").value = D.salt;
  if (safeAdmin) el("admin").value = store.get("s:last") || "";
  let tx = null;
  let seq = 0;

  function args() {
    const scheduler = el("scheduler").value.trim(), mailer = el("mailer").value.trim(), salt = el("salt").value.trim();
    const delay = el("delay").value.trim();
    if (blocked) return { err: blocked };
    if (!account) return { err: safeAdmin ? "Connect MetaMask (any account can send the deploy)." : "Connect MetaMask: admin is the connected account." };
    const admin = safeAdmin ? el("admin").value.trim() : account;
    if (!L.isAddress(admin) || admin.toLowerCase() === ZERO) return { err: "admin: paste the Safe address from section 0 (or click “Use as v2 admin” there)." };
    if (!L.isAddress(scheduler)) return { err: "scheduler is not an address" };
    if (!L.isAddress(mailer)) return { err: "mailer is not an address" };
    if (scheduler.toLowerCase() !== ZERO && scheduler.toLowerCase() === mailer.toLowerCase())
      return { err: "scheduler and mailer are the same address: the constructor reverts (SpenderHasRole). Use distinct addresses or zero for one." };
    if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) return { err: "salt must be 32 bytes hex" };
    if (!/^\d+$/.test(delay) || BigInt(delay) >= 2n ** 64n) return { err: "rotationDelay must be a uint64" };
    if (safeAdmin) {
      if ([scheduler, mailer].some((x) => x.toLowerCase() === admin.toLowerCase())) return { err: "admin cannot also be a spender: the constructor reverts (SpenderIsAdmin)." };
      if (Number(delay) < V2.minRotationDelay || Number(delay) > V2.maxRotationDelay)
        return { err: `rotationDelay must be ${V2.minRotationDelay} (48 h) to ${V2.maxRotationDelay} (30 days): the constructor reverts otherwise (InvalidRotationDelay).` };
    }
    return { admin: L.checksum(admin), rotationDelay: Number(delay), scheduler: L.checksum(scheduler), mailer: L.checksum(mailer), salt };
  }

  async function showDeployed(addr) {
    const st = await L.readPool(reader, addr);
    const a = tx?.args;
    const match = a && st.admin === L.checksum(a.admin) && st.rotationDelay === a.rotationDelay &&
      st.scheduler === L.checksum(a.scheduler) && st.mailer === L.checksum(a.mailer);
    let floor = "";
    if (safeAdmin) {
      const min = await L.readMinRotationDelay(reader, addr);
      floor = min === V2.minRotationDelay ? ` <span class="ok">MIN_ROTATION_DELAY ${min}s on chain.</span>` : ` <span class="bad">This code has no 48 h floor (MIN_ROTATION_DELAY ${min}).</span>`;
    }
    el("state").innerHTML = `<span class="ok">DEPLOYED — code present.</span> On-chain: admin ${st.admin}, rotationDelay ${st.rotationDelay}, scheduler ${st.scheduler}, mailer ${st.mailer} ` +
      (match ? `<span class="ok">(matches)</span>` : `<span class="bad">(does NOT match the fields above)</span>`) + floor;
    store.set(`${prefix}:last`, addr);
  }

  async function update() {
    const my = ++seq;
    if (!safeAdmin) el("admin").value = account || "(connect MetaMask)";
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
      let adminNote = "";
      if (safeAdmin) {
        // The admin is permanent: refuse anything that is not a deployed Safe.
        let safe;
        try {
          if (!L.hasCode(await reader.call("eth_getCode", [a.admin, "latest"]))) throw new Error("no code at that address on 4221: create the Safe first (section 0)");
          safe = await L.readSafe(reader, a.admin);
        } catch (e) {
          if (my === seq) el("state").innerHTML = `<span class="bad">admin ${a.admin}: ${errText(e)}</span>`;
          return;
        }
        if (my !== seq) return;
        adminNote = ` Admin is a Safe ${safe.version}, ${safe.threshold} of ${safe.owners.length}: ${safe.owners.join(", ")}.`;
      }
      const est = await L.estimate(reader, account, tx);
      if (my !== seq) return;
      const pending = store.get(tx.key);
      el("state").innerHTML = (pending ? `<span class="warn">Not deployed yet; an earlier tx ${pending} is stored and will be awaited first.</span>` : "Not deployed yet.") + adminNote;
      el("summary").textContent = `On click: 1 MetaMask prompt — call CREATE2 factory 0x4e59…956C, deploys ${label} at ${tx.expected}, admin ${a.admin}, rotationDelay ${a.rotationDelay}s, scheduler ${a.scheduler}, mailer ${a.mailer}, est ${est.toLocaleString("en-US")} gas, sent with gas ${L.gasWithHeadroom(est).toLocaleString("en-US")}, value 0.`;
      el("go").disabled = busy;
    } catch (e) {
      if (my === seq) el("state").innerHTML = `<span class="bad">eth_estimateGas failed: ${errText(e)} — not sendable as-is.</span>`;
    }
  }
  for (const k of ["delay", "scheduler", "mailer", "salt", ...(safeAdmin ? ["admin"] : [])]) el(k).addEventListener("input", update);

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
  poolSection({ prefix: "p", build: L.buildPoolTx, label: "UptimePool", defaults: DATA.pool.defaults }),
  poolSection({ prefix: "v", build: L.buildPoolV2Tx, label: "UptimePoolV2", defaults: V2.defaults || DATA.pool.defaults, safeAdmin: true, blocked: v2BuildError }),
];
function updatePool() { for (const s of poolSections) s.update(); updateSafe(); }
function disablePoolButtons() { for (const s of poolSections) s.disable(); $("s-go").disabled = true; }

// ---------------------------------------------------------------- 0. Admin Safe

$("s-version").innerHTML = Object.entries(L.SAFE_DEPLOYMENTS).map(([v, d]) => `<option value="${v}">${d.label} — factory ${d.factory}, singleton ${d.singleton}</option>`).join("");
$("s-threshold").value = store.get("s:threshold") || "";
$("s-owners").value = store.get("s:owners") || "";
$("s-nonce").value = store.get("s:nonce") || "0";
let safeTx = null, sSeq = 0;
const creationCode = {}; // version -> proxyCreationCode, read from the factory once

async function updateSafe() {
  const my = ++sSeq;
  $("s-go").disabled = true; $("s-use").disabled = true; $("s-summary").textContent = "";
  const version = $("s-version").value;
  const owners = $("s-owners").value.split(/[\s,]+/).filter(Boolean);
  const thr = $("s-threshold").value.trim(), nonce = $("s-nonce").value.trim();
  store.set("s:owners", $("s-owners").value); store.set("s:threshold", thr); store.set("s:nonce", nonce);
  const fail = (m) => { safeTx = null; $("s-addr").textContent = "—"; $("s-state").innerHTML = `<span class="bad">${m}</span>`; };
  if (!owners.length) return fail("Enter the owners, one address per line.");
  if (!/^\d+$/.test(thr)) return fail("Enter the threshold (how many owners must sign).");
  if (!/^\d+$/.test(nonce)) return fail("saltNonce must be a whole number.");
  try {
    $("s-state").textContent = "checking chain…";
    if (!creationCode[version]) { await L.checkSafeDeployment(reader, version); creationCode[version] = await L.readProxyCreationCode(reader, version); }
    if (my !== sSeq) return;
    safeTx = L.buildCreateSafeTx({ version, owners, threshold: Number(thr), saltNonce: BigInt(nonce) }, creationCode[version]);
  } catch (e) { if (my === sSeq) fail(errText(e)); return; }
  $("s-addr").textContent = safeTx.expected;
  const a = safeTx.args;
  try {
    if (L.hasCode(await reader.call("eth_getCode", [safeTx.expected, "latest"]))) {
      const safe = await L.readSafe(reader, safeTx.expected);
      if (my !== sSeq) return;
      const same = safe.threshold === a.threshold && safe.owners.length === a.owners.length && a.owners.every((o) => safe.owners.includes(o));
      $("s-state").innerHTML = `<span class="ok">DEPLOYED — Safe ${safe.version}, ${safe.threshold} of ${safe.owners.length}:</span> ${safe.owners.join(", ")} ` +
        (same ? `<span class="ok">(matches)</span>` : `<span class="bad">(does NOT match the fields above)</span>`);
      store.set("s:last", safeTx.expected);
      $("s-use").disabled = !same;
      return;
    }
    if (!account) { $("s-state").textContent = "Not deployed yet. Connect MetaMask to send it."; return; }
    const est = await L.estimate(reader, account, safeTx);
    if (my !== sSeq) return;
    const pending = store.get(safeTx.key);
    const single = a.threshold === 1 ? ` <span class="warn">Threshold 1: any single owner key controls the admin.</span>` : "";
    $("s-state").innerHTML = (pending ? `<span class="warn">Not deployed yet; an earlier tx ${pending} is stored and will be awaited first.</span>` : "Not deployed yet.") + single;
    $("s-summary").textContent = `On click: 1 MetaMask prompt — call Safe proxy factory ${L.SAFE_DEPLOYMENTS[version].factory}, creates a Safe ${version} at ${safeTx.expected}, ${a.threshold} of ${a.owners.length} owners (${a.owners.join(", ")}), saltNonce ${a.saltNonce}, est ${est.toLocaleString("en-US")} gas, sent with gas ${L.gasWithHeadroom(est).toLocaleString("en-US")}, value 0.`;
    $("s-go").disabled = busy;
  } catch (e) {
    if (my === sSeq) $("s-state").innerHTML = `<span class="bad">${errText(e)} — not sendable as-is.</span>`;
  }
}
for (const id of ["s-version", "s-owners", "s-threshold", "s-nonce"]) $(id).addEventListener("input", updateSafe);

$("s-use").onclick = () => { if (safeTx) { $("v-admin").value = safeTx.expected; poolSections[1].update(); } };
$("s-go").onclick = async () => {
  if (!safeTx || busy) return;
  busy = true; disablePoolButtons(); updateDlgButtons();
  const t = safeTx;
  try {
    await L.runTx({
      reader, from: account, send: sendViaMetaMask, store, log,
      status: (k, st, x = {}) => {
        if (st === "signing") $("s-summary").textContent = "CONFIRM IN METAMASK: " + x.summary;
        if (st === "mining") $("s-summary").textContent = `Sent ${x.hash} — waiting for receipt…`;
        if (st === "waiting") $("s-summary").textContent = `Waiting for earlier tx ${x.hash}…`;
      },
    }, t);
    // Code at the predicted address is not enough: it must be a Safe with exactly these owners.
    const safe = await L.readSafe(reader, t.expected);
    if (safe.threshold !== t.args.threshold || safe.owners.length !== t.args.owners.length || !t.args.owners.every((o) => safe.owners.includes(o)))
      throw new Error(`Safe at ${t.expected} has other owners/threshold than requested`);
    log(`Safe ${safe.version} at ${t.expected}, ${safe.threshold} of ${safe.owners.length}`);
    $("v-admin").value = t.expected;
  } catch (e) {
    log(`Safe: ${errText(e)}`);
    $("s-summary").textContent = `Stopped: ${errText(e)}`;
  } finally { busy = false; updateDlgButtons(); updatePool(); }
};

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

const LIVE_POOL = "0x5ea32AdBDF2f3C68C2Fe5566ec3156bF88e41d0A"; // UPTIME_POOL_BRADBURY (v1), INTEGRATIONS.md
$("m-pool").value = LIVE_POOL; // a Safe-admin v2 pool cannot be changed from this section
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
    else if (account.toLowerCase() !== st.admin.toLowerCase()) err = `Connected account is not the pool admin ${st.admin}. If the admin is a Safe, these calls must be Safe transactions.`;
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
  if (!$("s-owners").value && eth) { const a0 = (await eth.request({ method: "eth_accounts" }).catch(() => []))[0]; if (a0) $("s-owners").value = L.checksum(a0); }
  await refreshWallet().catch((e) => log(errText(e)));
  await scan();
})();
