// Shared logic for the signing page (browser) and the fork/estimate checks (node).
// No dependencies. Nothing here holds or asks for a key: transactions are handed to a
// `send` function (MetaMask's eth_sendTransaction in the page, anvil's unlocked accounts
// in check.mjs) and every read goes to a plain JSON-RPC endpoint.

export const CHAIN_ID = 4221;
export const CHAIN_ID_HEX = "0x107d";
export const RPC_URLS = ["https://rpc.testnet-chain.genlayer.com", "https://rpc-bradbury.genlayer.com"];
export const FACTORY = "0x4e59b44847b379578588920ca78fbf26c0b4956c"; // Arachnid CREATE2 deployer

// ------------------------------------------------------------------ keccak256 (32-bit lanes)

const RC = [
  "0000000000000001", "0000000000008082", "800000000000808a", "8000000080008000",
  "000000000000808b", "0000000080000001", "8000000080008081", "8000000000008009",
  "000000000000008a", "0000000000000088", "0000000080008009", "000000008000000a",
  "000000008000808b", "800000000000008b", "8000000000008089", "8000000000008003",
  "8000000000008002", "8000000000000080", "000000000000800a", "800000008000000a",
  "8000000080008081", "8000000000008080", "0000000080000001", "8000000080008008",
].map((h) => [parseInt(h.slice(8), 16) | 0, parseInt(h.slice(0, 8), 16) | 0]); // [lo, hi]
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

function rotl(lo, hi, n) {
  if (n === 0) return [lo, hi];
  if (n === 32) return [hi, lo];
  if (n < 32) return [(lo << n) | (hi >>> (32 - n)), (hi << n) | (lo >>> (32 - n))];
  const m = n - 32;
  return [(hi << m) | (lo >>> (32 - m)), (lo << m) | (hi >>> (32 - m))];
}

function keccakF(s) {
  const C = new Int32Array(10), B = new Int32Array(50);
  for (let r = 0; r < 24; r++) {
    for (let x = 0; x < 5; x++) {
      C[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
      C[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
    }
    for (let x = 0; x < 5; x++) {
      const p = (x + 4) % 5, n = (x + 1) % 5;
      const [rl, rh] = rotl(C[2 * n], C[2 * n + 1], 1);
      const dl = C[2 * p] ^ rl, dh = C[2 * p + 1] ^ rh;
      for (let y = 0; y < 25; y += 5) { s[2 * (x + y)] ^= dl; s[2 * (x + y) + 1] ^= dh; }
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      const i = x + 5 * y, j = y + 5 * ((2 * x + 3 * y) % 5);
      const [l, h] = rotl(s[2 * i], s[2 * i + 1], ROT[i]);
      B[2 * j] = l; B[2 * j + 1] = h;
    }
    for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) {
      const i = x + y, a = (x + 1) % 5 + y, b = (x + 2) % 5 + y;
      s[2 * i] = B[2 * i] ^ (~B[2 * a] & B[2 * b]);
      s[2 * i + 1] = B[2 * i + 1] ^ (~B[2 * a + 1] & B[2 * b + 1]);
    }
    s[0] ^= RC[r][0]; s[1] ^= RC[r][1];
  }
}

export function keccak256(bytes) {
  const rate = 136, s = new Int32Array(50);
  const padded = new Uint8Array(Math.floor(bytes.length / rate) * rate + rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) {
      const k = off + 4 * i;
      s[i] ^= padded[k] | (padded[k + 1] << 8) | (padded[k + 2] << 16) | (padded[k + 3] << 24);
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) for (let b = 0; b < 4; b++) out[4 * i + b] = (s[i] >>> (8 * b)) & 0xff;
  return out;
}

// ------------------------------------------------------------------ hex / abi helpers

export const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
export function hexToBytes(h) {
  h = strip(h);
  if (h.length % 2) throw new Error("odd hex length");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(2 * i, 2), 16);
  return out;
}
export const bytesToHex = (b) => "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const keccakHex = (hex) => bytesToHex(keccak256(hexToBytes(hex)));

export function isAddress(a) { return /^0x[0-9a-fA-F]{40}$/.test(a || ""); }
export function checksum(addr) {
  const a = strip(addr).toLowerCase();
  const h = strip(bytesToHex(keccak256(new TextEncoder().encode(a))));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
  return out;
}
const word = (hexNoPrefix) => hexNoPrefix.toLowerCase().padStart(64, "0");
export const encAddress = (a) => word(strip(a));
export const encUint = (n) => word(BigInt(n).toString(16));
export const selector = (sig) => strip(bytesToHex(keccak256(new TextEncoder().encode(sig)))).slice(0, 8);

export function create2Address(salt, initcodeHex, factory = FACTORY) {
  const h = keccakHex(initcodeHex);
  const pre = "ff" + strip(factory) + strip(salt) + strip(h);
  return checksum("0x" + strip(keccakHex(pre)).slice(24));
}

// ------------------------------------------------------------------ transaction builders

/** UptimePool through the CREATE2 factory, exactly as script/DeployUptimePool.s.sol does it:
 *  calldata = salt ++ creationCode ++ abi.encode(admin, rotationDelay, scheduler, mailer). */
export function buildPoolTx(data, { admin, rotationDelay = 0, scheduler, mailer, salt }) {
  const args = encAddress(admin) + encUint(rotationDelay) + encAddress(scheduler) + encAddress(mailer);
  const initcode = "0x" + strip(data.pool.creationCode) + args;
  const expected = create2Address(salt, initcode);
  return {
    key: `pool:${expected.toLowerCase()}`, name: "UptimePool", to: FACTORY,
    data: "0x" + strip(salt) + strip(initcode), expected,
    args: { admin, rotationDelay, scheduler, mailer, salt },
  };
}

/** The 44 canonical txs, exactly as delegation/script/DeployCanonical.s.sol builds them:
 *  calldata = salt ++ initcode, and the CREATE2 address must equal the manifest's. */
export function buildDelegationTxs(data) {
  return data.delegation.contracts.map((c, i) => {
    const expected = create2Address(c.salt, c.initcode);
    if (expected.toLowerCase() !== c.address.toLowerCase()) throw new Error(`manifest mismatch: ${c.name}`);
    return { key: `dlg:${i}:${c.address.toLowerCase()}`, index: i, name: c.name, to: FACTORY,
      data: "0x" + strip(c.salt) + strip(c.initcode), expected: checksum(c.address) };
  });
}

// ------------------------------------------------------------------ JSON-RPC (reads only)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read-only JSON-RPC client with retry (the public RPC rate-limits bursts). */
export function makeReader(url) {
  async function post(body) {
    let lastErr;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) { lastErr = e; await sleep(500 * 2 ** attempt); }
    }
    throw lastErr;
  }
  const limited = (err) => err && /rate limit|too many/i.test(err.message || "");
  async function call(method, params = []) {
    for (let attempt = 0; ; attempt++) {
      const r = await post({ jsonrpc: "2.0", id: 1, method, params });
      if (r.error && limited(r.error) && attempt < 10) { await sleep(1000 * Math.min(2 ** attempt, 16)); continue; }
      if (r.error) { const e = new Error(r.error.message || JSON.stringify(r.error)); e.data = r.error.data; throw e; }
      return r.result;
    }
  }
  /** Batch of [method, params]; rate-limited entries are retried, so results are final. */
  async function batch(calls) {
    const out = new Array(calls.length);
    let todo = calls.map((_, i) => i);
    for (let attempt = 0; todo.length; attempt++) {
      const r = await post(todo.map((i) => ({ jsonrpc: "2.0", id: i, method: calls[i][0], params: calls[i][1] })));
      const byId = new Map((Array.isArray(r) ? r : []).map((x) => [x.id, x]));
      const next = [];
      for (const i of todo) {
        const x = byId.get(i);
        if ((!x || limited(x.error)) && attempt < 10) next.push(i); else out[i] = x;
      }
      todo = next;
      if (todo.length) await sleep(1000 * Math.min(2 ** attempt, 16));
    }
    return out;
  }
  return { call, batch, url };
}

export const hasCode = (code) => typeof code === "string" && code !== "0x" && code !== "0x0" && code.length > 2;

export async function codeMap(reader, txs) {
  const out = {};
  for (let i = 0; i < txs.length; i += 15) {
    const part = txs.slice(i, i + 15);
    const res = await reader.batch(part.map((t) => ["eth_getCode", [t.expected, "latest"]]));
    res.forEach((r, j) => {
      if (!r || r.error) throw new Error(`eth_getCode ${part[j].expected}: ${r?.error?.message || "no response"}`);
      out[part[j].key] = hasCode(r.result);
    });
  }
  return out;
}

/** Gas to send: estimate + 30% + 100k. No upper cap (Bradbury estimates include L1 cost). */
export const gasWithHeadroom = (est) => (BigInt(est) * 13n) / 10n + 100000n;

export async function estimate(reader, from, tx) {
  const est = await reader.call("eth_estimateGas", [{ from, to: tx.to, data: tx.data, value: "0x0" }]);
  return BigInt(est);
}

export async function waitReceipt(reader, hash, { timeoutMs = 15 * 60 * 1000, pollMs = 2000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await reader.call("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) return r;
    await sleep(pollMs);
  }
  throw new Error(`no receipt for ${hash} after ${timeoutMs / 1000}s`);
}

/** Read back the pool's constructor state. */
export async function readPool(reader, addr) {
  const q = (sig, arg = "") => ["eth_call", [{ to: addr, data: "0x" + selector(sig) + arg }, "latest"]];
  const res = await reader.batch([q("admin()"), q("rotationDelay()"), q("spenderOf(uint8)", encUint(1)), q("spenderOf(uint8)", encUint(2))]);
  const [admin, delay, s1, s2] = res.map((r) => { if (r.error) throw new Error(r.error.message); return r.result; });
  const addrOf = (w) => checksum("0x" + strip(w).slice(24));
  return { admin: addrOf(admin), rotationDelay: Number(BigInt(delay)), scheduler: addrOf(s1), mailer: addrOf(s2) };
}

/**
 * Send one CREATE2 tx and prove it landed. Shared by the page and check.mjs.
 * env = { reader, from, send(txObj) -> hash, store: {get(k), set(k,v)}, log(msg), status(key, state, extra),
 *         beforeSend(summary) (optional; the page shows the one-line summary there) }
 * Returns { state: "present"|"deployed", hash?, gasUsed? }.
 */
export async function runTx(env, tx) {
  const { reader, from, send, store, log, status } = env;
  if (hasCode(await reader.call("eth_getCode", [tx.expected, "latest"]))) {
    status(tx.key, "present"); return { state: "present" };
  }
  // Resume: a hash sent before a reload is awaited, never re-sent blindly.
  const pending = store.get(tx.key);
  if (pending) {
    status(tx.key, "waiting", { hash: pending });
    log(`${tx.name}: waiting for earlier tx ${pending}`);
    const r = await waitReceipt(reader, pending, { timeoutMs: 120000 }).catch(() => null);
    if (r && hasCode(await reader.call("eth_getCode", [tx.expected, "latest"]))) {
      status(tx.key, "deployed", { hash: pending }); return { state: "deployed", hash: pending };
    }
    store.set(tx.key, null);
  }
  status(tx.key, "estimating");
  const est = await estimate(reader, from, tx);
  const gas = gasWithHeadroom(est);
  const summary = `${tx.name} -> CREATE2 factory ${FACTORY.slice(0, 6)}…${FACTORY.slice(-4)}, expected at ${tx.expected}, estimate ${est.toLocaleString("en-US")} gas, sending with gas ${gas.toLocaleString("en-US")}, value 0`;
  status(tx.key, "signing", { est, gas, summary });
  if (env.beforeSend) await env.beforeSend(summary, tx);
  log(`SIGN: ${summary}`);
  const hash = await send({ from, to: tx.to, data: tx.data, value: "0x0", gas: "0x" + gas.toString(16) });
  store.set(tx.key, hash);
  status(tx.key, "mining", { hash, est, gas });
  log(`${tx.name}: sent ${hash}`);
  const r = await waitReceipt(reader, hash);
  if (r.status !== "0x1") throw new Error(`${tx.name}: tx ${hash} reverted (status ${r.status})`);
  const code = await reader.call("eth_getCode", [tx.expected, "latest"]);
  if (!hasCode(code)) throw new Error(`${tx.name}: tx ${hash} mined but no code at ${tx.expected}`);
  status(tx.key, "deployed", { hash, gasUsed: BigInt(r.gasUsed), est, gas });
  log(`${tx.name}: deployed at ${tx.expected} (gasUsed ${BigInt(r.gasUsed)})`);
  return { state: "deployed", hash, gasUsed: BigInt(r.gasUsed) };
}
