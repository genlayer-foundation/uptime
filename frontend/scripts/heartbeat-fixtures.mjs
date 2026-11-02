// Generates the two Bradbury Heartbeat fixtures that carry their answer
// ONLY as pixels, never as text:
//
//   public/heartbeat/card.png   a card printing "HB2 · 7319"   (probe r7-card)
//   public/heartbeat/shot.html  a page drawing the word CONDORCET as SVG
//                                  strokes, so the word is not in the DOM text (probe r8-shot)
//
// Deterministic: a fixed stroke font, our own rasterizer, PNG written by hand
// (zlib level 9, no timestamps, no metadata chunks). Same input, same bytes.
//
//   node scripts/heartbeat-fixtures.mjs           write both files
//   node scripts/heartbeat-fixtures.mjs --check   fail if the committed files differ
//
// The fixtures are FROZEN: contracts/heartbeat.py pins card.png's sha256
// (CARD_SHA256). Re-running this script must reproduce the committed bytes;
// if it does not, do NOT commit the new output — a changed card is a new
// question and needs a new contract deployment.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "heartbeat");

// ---- stroke font: glyphs on a 4 x 6 grid (y down), polylines ---------------
// A one-point polyline is a dot.
const GLYPHS = {
  A: [[[0, 6], [0, 2], [2, 0], [4, 2], [4, 6]], [[0, 4], [4, 4]]],
  B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[0, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
  C: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5]]],
  D: [[[0, 0], [0, 6], [2, 6], [4, 4], [4, 2], [2, 0], [0, 0]]],
  E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]],
  G: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3], [2, 3]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  L: [[[0, 0], [0, 6], [4, 6]]],
  N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
  O: [[[1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0]]],
  R: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]], [[2, 3], [4, 6]]],
  T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  U: [[[0, 0], [0, 5], [1, 6], [3, 6], [4, 5], [4, 0]]],
  Y: [[[0, 0], [2, 3], [4, 0]], [[2, 3], [2, 6]]],
  1: [[[1, 1], [2, 0], [2, 6]], [[1, 6], [3, 6]]],
  2: [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [0, 6], [4, 6]]],
  3: [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [4, 4], [4, 5], [3, 6], [1, 6], [0, 5]], [[1, 3], [3, 3]]],
  7: [[[0, 0], [4, 0], [1, 6]]],
  9: [[[4, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5]]],
  "·": [[[2, 3]]],
  " ": [],
};
const ADVANCE = { " ": 3, "·": 4 };

// Lay a string out as segments in pixel space. Returns { segs, width }.
function layout(text, x0, y0, unit) {
  const segs = [];
  let x = x0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`no glyph for ${JSON.stringify(ch)}`);
    for (const line of g) {
      const pts = line.map(([gx, gy]) => [x + gx * unit, y0 + gy * unit]);
      if (pts.length === 1) segs.push([pts[0], pts[0]]);
      for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
    }
    x += (ADVANCE[ch] ?? 6) * unit;
  }
  return { segs, width: x - x0 - 2 * unit };
}

function textWidth(text, unit) {
  return layout(text, 0, 0, unit).width;
}

// ---- rasterizer: round-capped anti-aliased strokes onto an RGB buffer -------
function canvas(w, h, rgb) {
  const px = new Float64Array(w * h * 3);
  for (let i = 0; i < w * h; i++) px.set(rgb, i * 3);
  return { w, h, px };
}

function rect(c, x0, y0, x1, y1, rgb) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) c.px.set(rgb, (y * c.w + x) * 3);
}

function stroke(c, segs, width, rgb) {
  const cover = new Float64Array(c.w * c.h);
  const r = width / 2;
  for (const [[ax, ay], [bx, by]] of segs) {
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
    const maxX = Math.min(c.w - 1, Math.ceil(Math.max(ax, bx) + r + 1));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
    const maxY = Math.min(c.h - 1, Math.ceil(Math.max(ay, by) + r + 1));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        const a = Math.max(0, Math.min(1, r - d + 0.5));
        const i = y * c.w + x;
        if (a > cover[i]) cover[i] = a;
      }
    }
  }
  for (let i = 0; i < cover.length; i++) {
    const a = cover[i];
    if (a === 0) continue;
    for (let k = 0; k < 3; k++) c.px[i * 3 + k] = c.px[i * 3 + k] * (1 - a) + rgb[k] * a;
  }
}

// ---- PNG (RGB, 8 bit, filter 0, no ancillary chunks) -----------------------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(c) {
  const raw = Buffer.alloc((c.w * 3 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 3 + 1)] = 0;
    for (let x = 0; x < c.w * 3; x++) raw[y * (c.w * 3 + 1) + 1 + x] = Math.round(c.px[y * c.w * 3 + x]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- the card --------------------------------------------------------------
const INK = [250, 250, 250]; // --code-fg-ish
const BG = [24, 24, 27]; // --code (#18181b)
const PURPLE = [155, 106, 246]; // --purple (#9b6af6)
const MUTED = [113, 113, 122]; // --muted

function card() {
  const W = 1200;
  const H = 630;
  const c = canvas(W, H, BG);
  rect(c, 0, 0, 24, H, PURPLE);
  rect(c, 24, H - 6, W, H, PURPLE);
  const small = 7;
  stroke(c, layout("GENLAYER HEARTBEAT", 96, 80, small).segs, 5, PURPLE);
  const big = 16;
  const text = "HB2 · 7319";
  const x = Math.round((W - textWidth(text, big)) / 2);
  stroke(c, layout(text, x, 252, big).segs, 15, INK);
  stroke(c, layout("BRADBURY", 96, H - 80 - 6 * small, small).segs, 5, MUTED);
  return png(c);
}

// ---- the screenshot page ---------------------------------------------------
// The word is drawn as stroked paths. The DOM text of this page never
// contains it, so only an LLM looking at the screenshot can read it. The
// fixture sentinel sits in a <meta>, checked by the contract on the raw HTML.
function shot() {
  const word = ["C", "O", "N", "D", "O", "R", "C", "E", "T"].join("");
  const unit = 10;
  const { segs, width } = layout(word, 10, 10, unit);
  const d = segs
    .map(([[ax, ay], [bx, by]]) => `M${ax} ${ay}L${bx} ${by}`)
    .join("");
  const vbW = width + 20;
  const vbH = 6 * unit + 20;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="hb2-fixture" content="HB2-shot">
<title>Bradbury Heartbeat fixture</title>
<style>
  html, body { margin: 0; height: 100%; background: #ffffff; }
  body { display: flex; align-items: center; justify-content: center; }
  svg { width: 86vw; max-width: 1400px; height: auto; }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" role="img" aria-label="Heartbeat fixture">
<path d="${d}" fill="none" stroke="#18181b" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
</body>
</html>
`;
}

// ---- main ------------------------------------------------------------------
const files = { "card.png": card(), "shot.html": Buffer.from(shot(), "utf8") };
const check = process.argv.includes("--check");
let bad = 0;
mkdirSync(OUT, { recursive: true });
for (const [name, buf] of Object.entries(files)) {
  const target = path.join(OUT, name);
  const sha = createHash("sha256").update(buf).digest("hex");
  if (check) {
    let cur;
    try {
      cur = readFileSync(target);
    } catch {
      cur = Buffer.alloc(0);
    }
    const same = cur.equals(buf);
    if (!same) bad++;
    console.log(`${same ? "ok  " : "DIFF"} ${name} sha256=${sha}`);
  } else {
    writeFileSync(target, buf);
    console.log(`wrote ${name} (${buf.length} bytes) sha256=${sha}`);
  }
}
if (bad) process.exit(1);
