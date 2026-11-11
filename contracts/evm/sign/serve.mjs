// No-cache static server for the signing page. Local only (binds 127.0.0.1).
//   node contracts/evm/sign/serve.mjs            http://127.0.0.1:8799/
//   PORT=8800 node contracts/evm/sign/serve.mjs
// Every response carries Cache-Control: no-store, so the browser can never reuse an old data.js,
// lib.js or app.js (python's http.server lets it: a cached data.js once blocked a deploy).
// Serves only the files of this folder, by exact name. Ctrl-C to stop.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8799);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };

createServer(async (req, res) => {
  const send = (code, body, type = "text/plain; charset=utf-8") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store, max-age=0", pragma: "no-cache", expires: "0" });
    res.end(body);
  };
  try {
    const name = decodeURIComponent(new URL(req.url, "http://x").pathname).slice(1) || "index.html";
    // Exact file names of this folder only: no sub-paths, no dotfiles, nothing outside it.
    const allowed = (await readdir(here)).filter((f) => TYPES[extname(f)] && !f.startsWith("."));
    if (req.method !== "GET" || !allowed.includes(name)) return send(404, "not found");
    send(200, await readFile(join(here, name)), TYPES[extname(name)]);
  } catch (e) { send(500, String(e?.message || e)); }
}).listen(port, "127.0.0.1", () => console.log(`signing page: http://127.0.0.1:${port}/  (no-store on every response; Ctrl-C to stop)`));
