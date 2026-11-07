// Round 1 storyboard thumbnails for video/concepts/index.html.
// SVG per frame (1920x1080 space) -> resvg PNG. Text is drawn as glyph outlines with kerning.
// Fonts are the licensed, gitignored copies in ../film/fonts (never committed).
// Run: node src/frames.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILM = path.join(HERE, "../../film");
const require = createRequire(path.join(FILM, "package.json"));
const opentype = require("opentype.js");
const { Resvg } = require("@resvg/resvg-js");
const OUT = path.join(HERE, "../frames");
fs.mkdirSync(OUT, { recursive: true });

const C = { bg: "#FFFFFF", ink: "#070707", card: "#F3F3F3", q1: "#E7E7E7", q2: "#CDCDCD", label: "#999999", blue: "#110FFF", red: "#FF3B30", end: "#0A0A0A", endInk: "#F7F8F8", night: "#1A1A1A" };
const F = {
  d: opentype.loadSync(path.join(FILM, "fonts/Lineca-500.ttf")),
  m: opentype.loadSync(path.join(FILM, "fonts/SuisseMono.otf")),
};
const LOGO = fs.readFileSync(path.join(HERE, "../../../../design/assets/GenLayer_Logo_White.svg"), "utf8");

// ---- text as outlines ----
function measure(font, s, fs_, track) {
  const sc = fs_ / font.unitsPerEm; let x = 0, prev = null; const gl = [];
  for (const ch of s) { const g = font.charToGlyph(ch); if (prev) x += font.getKerningValue(prev, g) * sc; gl.push({ g, x }); x += g.advanceWidth * sc + track * fs_; prev = g; }
  return { gl, w: x - (gl.length ? track * fs_ : 0), cap: (font.tables.os2.sCapHeight || 700) * sc };
}
// T(str, x, y = optical centre, size, opts)
function T(s, x, y, size, o = {}) {
  const font = o.mono ? F.m : F.d;
  const track = o.track ?? (o.mono ? 0.02 : -0.03);
  const L = measure(font, s, size, track);
  let x0 = x; const a = o.anchor || "middle";
  if (a === "middle") x0 -= L.w / 2; else if (a === "end") x0 -= L.w;
  const yb = y + L.cap / 2;
  const d = L.gl.map(({ g, x: gx }) => g.getPath(x0 + gx, yb, size).toPathData(2)).join("");
  const tr = o.rot ? ` transform="rotate(${o.rot} ${x} ${y})"` : "";
  return `<path d="${d}" fill="${o.fill || C.ink}"${tr}/>`;
}
const W = (s, x, y, size, o) => T(s, x, y, size, o);                       // Lineca words
// a centred line in several colours: parts = [[text, fill], ...]
function Wrun(parts, cx, y, size) {
  const full = parts.map((p) => p[0]).join(""); const L = measure(F.d, full, size, -0.03);
  let x = cx - L.w / 2, out = "", i = 0;
  for (const [t, fill] of parts) { const start = L.gl[i].x; i += [...t].length; out += T(t, x + start, y, size, { anchor: "start", fill }); }
  return out;
}
const M = (s, x, y, size = 26, o = {}) => T(s.toUpperCase(), x, y, size, { mono: true, fill: C.label, ...o });
const rect = (x, y, w, h, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r ?? 18}" fill="${o.fill || C.card}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 3}"` : ""}/>`;
const circ = (cx, cy, r, o = {}) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill || "none"}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 3}"` : ""}/>`;
const line = (x1, y1, x2, y2, o = {}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke || C.q2}" stroke-width="${o.sw || 3}" stroke-linecap="round"/>`;
const pathS = (d, o = {}) => `<path d="${d}" fill="${o.fill || "none"}" stroke="${o.stroke || C.q2}" stroke-width="${o.sw || 3}" stroke-linecap="round"/>`;
function pill(cx, cy, label, o = {}) {
  const size = o.size || 28; const L = measure(F.m, label.toUpperCase(), size, 0.02);
  const w = L.w + size * 2.2, h = size * 2.1;
  return rect(cx - w / 2, cy - h / 2, w, h, { r: h / 2, fill: o.fill || "none", stroke: o.stroke ?? C.ink, sw: o.sw || 3 }) + M(label, cx, cy, size, { fill: o.color || C.ink });
}
function cube(cx, cy, s, fill = C.ink, gap = 14, bg = C.bg) {
  const k = 0.866, P = { t: [cx, cy - s], ur: [cx + k * s, cy - s / 2], lr: [cx + k * s, cy + s / 2], b: [cx, cy + s], ll: [cx - k * s, cy + s / 2], ul: [cx - k * s, cy - s / 2], c: [cx, cy] };
  const poly = (...ps) => `<polygon points="${ps.map((p) => P[p].join(",")).join(" ")}" fill="${fill}" stroke="${bg}" stroke-width="${gap}" stroke-linejoin="round"/>`;
  return poly("t", "ur", "c", "ul") + poly("ul", "c", "b", "ll") + poly("c", "ur", "lr", "b");
}
function wire(cx, cy, s, stroke = C.ink, sw = 3) {
  const k = 0.866;
  return `<polygon points="${cx},${cy - s} ${cx + k * s},${cy - s / 2} ${cx + k * s},${cy + s / 2} ${cx},${cy + s} ${cx - k * s},${cy + s / 2} ${cx - k * s},${cy - s / 2}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="miter"/>` +
    line(cx, cy, cx, cy + s, { stroke, sw }) + line(cx, cy, cx - k * s, cy - s / 2, { stroke, sw }) + line(cx, cy, cx + k * s, cy - s / 2, { stroke, sw });
}
// the abstract jury: dots on a ring, optional blue agreement outline
function ring(cx, cy, R, colors, o = {}) {
  const n = colors.length; let s = "";
  colors.forEach((c, i) => { const a = -Math.PI / 2 + (i / n) * 2 * Math.PI; s += circ(cx + R * Math.cos(a), cy + R * Math.sin(a), o.r || 16, { fill: c }); });
  if (o.agree) s = circ(cx, cy, R + (o.r || 16) + 22, { stroke: C.blue, sw: 5 }) + s;
  return s;
}
const pointer = (x, y, s = 1, fill = C.ink) => `<path d="M${x},${y} l0,${52 * s} l${13 * s},${-12 * s} l${10 * s},${22 * s} l${9 * s},${-4 * s} l${-10 * s},${-21 * s} l${18 * s},0 z" fill="${fill}" stroke="${C.bg}" stroke-width="3" stroke-linejoin="round"/>`;
const caret = (x, y, h, fill = C.blue) => `<rect x="${x}" y="${y - h / 2}" width="6" height="${h}" fill="${fill}"/>`;
const logo = (cx, cy, w) => { const h = w * 91.93 / 385.32; return `<image x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" href="data:image/svg+xml;base64,${Buffer.from(LOGO).toString("base64")}"/>`; };
const endcard = () => logo(960, 500, 620) + M("uptime.genlayer.foundation", 960, 640, 30, { fill: C.endInk }) + M("testnet · not audited", 960, 700, 20, { fill: "#777" });

function render(name, bg, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="${bg}"/>${body}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 960 }, background: bg }).render().asPng();
  fs.writeFileSync(path.join(OUT, `${name}.png`), png);
}

// ================= A · The Status Update =================
render("a1", C.ink, W("3:04", 760, 540, 420, { fill: C.endInk }) + pill(1460, 420, "checkout is down", { stroke: C.red, color: C.red, size: 30 }) + pill(1440, 560, "checkout is down", { stroke: C.red, color: C.red, size: 30 }) + M("pager", 1450, 680, 22));
render("a2", C.ink,
  rect(560, 170, 620, 150, { fill: C.night }) + W("is it down?", 600, 245, 64, { fill: C.endInk, anchor: "start" }) + M("@ana · 3:04", 600, 196, 18, { anchor: "start" }) +
  rect(760, 360, 420, 150, { fill: C.night }) + W("???", 800, 435, 64, { fill: C.endInk, anchor: "start" }) +
  rect(640, 550, 640, 150, { fill: C.night }) + W("CEO is asking", 680, 625, 64, { fill: C.endInk, anchor: "start" }) + M("@ana · 3:05", 680, 576, 18, { anchor: "start" }) +
  rect(820, 740, 260, 150, { fill: C.night }) + W("…", 860, 800, 64, { fill: C.endInk, anchor: "start" }));
render("a3", C.bg,
  rect(330, 300, 1260, 420) + M("status page · edit", 400, 360, 24, { anchor: "start" }) +
  W("All systems operational", 400, 490, 96, { anchor: "start" }) + caret(1468, 490, 100) +
  rect(1260, 590, 260, 84, { r: 42, fill: C.blue }) + M("publish", 1390, 632, 28, { fill: "#fff" }) + pointer(1440, 650, 1.6));
render("a4", C.bg,
  rect(610, 430, 700, 220) + W("All systems operational", 960, 540, 52) +
  ring(960, 540, 400, Array(11).fill(C.ink), { r: 18 }) + pathS("M 180 120 Q 400 200 560 260", { stroke: C.q1 }) + pathS("M 1760 980 Q 1500 880 1360 820", { stroke: C.q1 }));
render("a5", C.bg,
  rect(610, 430, 700, 220) +
  ring(960, 540, 400, [C.blue, C.blue, C.blue, C.blue, C.red, C.blue, C.blue, C.blue, C.blue, C.blue, C.blue], { r: 18, agree: true }) +
  M("[down]", 960, 540, 150, { fill: C.red, rot: -7 }) + M("decided by the jury", 960, 720, 24));
render("a6", C.bg,
  rect(500, 400, 920, 260, { fill: C.card }) + M("@cto · 3:07", 560, 455, 22, { anchor: "start" }) +
  W("ok. it's down", 560, 560, 110, { anchor: "start" }) + caret(1270, 560, 110));
render("a7", C.bg, Wrun([["Uptime you can ", C.ink], ["prove", C.blue]], 960, 540, 140));
render("end", C.end, endcard());

// ================= B · UP UP UP =================
render("b1", C.bg, W("UP", 960, 600, 900) + M("02:00:00", 120, 90, 24, { anchor: "start" }));
render("b2", C.blue, W("UP", 960, 600, 900, { fill: "#fff" }) + M("03:00:00", 120, 90, 24, { anchor: "start", fill: "#fff" }));
render("b3", C.ink, W("UP", 760, 600, 900, { fill: C.endInk }) + M("04:00:00", 120, 90, 24, { anchor: "start", fill: "#777" }));
render("b4", C.bg, W("DOWN", 960, 560, 640, { fill: C.red }) + M("04:13:07", 120, 90, 24, { anchor: "start" }));
render("b5", C.bg, W("DOWN", 960, 540, 130, { fill: C.red }) + ring(960, 540, 330, Array(12).fill(C.ink), { r: 20 }) + W("Says who", 960, 130, 90));
render("b6", C.ink, ring(960, 470, 300, [C.blue, C.blue, C.blue, C.blue, C.blue, C.endInk, C.blue, C.blue, C.blue, C.blue, C.blue, C.blue], { r: 20, agree: true }) + W("The jury", 960, 470, 150, { fill: C.endInk }) + M("[down] · accepted", 960, 920, 28, { fill: "#777" }));
render("b7", C.bg, W("Uptime", 960, 430, 330) + Wrun([["you can ", C.ink], ["prove", C.blue]], 960, 720, 150));

// ================= C · The Receipt =================
const printer = (cx, y, w = 760) => rect(cx - w / 2, y, w, 150, { fill: C.ink, r: 28 }) + rect(cx - w / 2 + 90, y + 120, w - 180, 14, { fill: "#333", r: 7 });
function strip(cx, y0, rows, w = 560, rh = 70) {
  let s = rect(cx - w / 2, y0, w, rows.length * rh + 40, { r: 0, fill: C.card });
  rows.forEach(([t, st, ms], i) => {
    const y = y0 + 55 + i * rh, red = st === "down";
    s += M(t, cx - w / 2 + 40, y, 26, { anchor: "start", fill: red ? C.red : C.ink }) + M(`[${st}]`, cx + 30, y, 26, { fill: red ? C.red : C.ink }) + M(ms, cx + w / 2 - 40, y, 26, { anchor: "end", fill: red ? C.red : C.label });
  });
  return s;
}
render("c1", C.bg, strip(960, 380, [["14:00", "up", "212ms"]]) + printer(960, 260) + M("run 001", 960, 620, 22));
render("c2", C.bg, strip(960, 230, [["14:00", "up", "212ms"], ["15:00", "up", "198ms"], ["16:00", "up", "240ms"], ["17:00", "up", "205ms"], ["18:00", "up", "221ms"], ["19:00", "up", "201ms"], ["20:00", "up", "230ms"], ["21:00", "up", "199ms"], ["22:00", "up", "214ms"], ["23:00", "up", "209ms"], ["00:00", "up", "203ms"]]) + printer(960, 110));
{ // long ribbon curling to the floor
  let s = printer(560, 80, 420) + `<path d="M 430 230 L 430 700 Q 430 960 760 960 L 1880 960 L 1880 1040 L 760 1040 Q 350 1040 350 700 L 350 230 Z" fill="${C.card}"/>`;
  for (let i = 0; i < 9; i++) s += line(372, 280 + i * 48, 410, 280 + i * 48, { stroke: C.q2, sw: 4 });
  for (let i = 0; i < 19; i++) s += line(800 + i * 56, 984, 800 + i * 56, 1016, { stroke: C.q2, sw: 4 });
  s += W("Every hour", 1250, 460, 140);
  render("c3", C.bg, s);
}
render("c4", C.bg, strip(960, 170, [["02:00", "up", "207ms"], ["03:00", "up", "211ms"], ["03:04", "down", "timeout"], ["04:00", "up", "219ms"]], 900, 150) + M("accepted by the jury", 1180, 600, 20, { fill: C.red }));
render("c5", C.bg, strip(960, 300, [["03:00", "up", "211ms"], ["03:04", "down", "timeout"], ["04:00", "up", "219ms"]], 900, 150) +
  rect(1080, 480, 330, 120, { r: 10, fill: "#fff", stroke: C.q2, sw: 3 }) + pointer(1330, 540, 1.6) + W("Try tearing it off", 960, 170, 90));
render("c6", C.bg, rect(580, 140, 760, 800, { r: 0, fill: C.card }) + M("uptime.co · 30 days", 960, 230, 28, { fill: C.ink }) + line(640, 290, 1280, 290, { stroke: C.q2, sw: 3 }) +
  M("checks", 650, 360, 28, { anchor: "start", fill: C.ink }) + M("720", 1270, 360, 28, { anchor: "end", fill: C.ink }) +
  M("down", 650, 430, 28, { anchor: "start", fill: C.red }) + M("1", 1270, 430, 28, { anchor: "end", fill: C.red }) +
  M("uptime", 650, 500, 28, { anchor: "start", fill: C.ink }) + M("99.86%", 1270, 500, 28, { anchor: "end", fill: C.ink }) +
  ring(960, 720, 120, Array(10).fill(C.blue), { r: 12, agree: true }) + M("signed · genlayer jury", 960, 890, 22));
render("c7", C.bg, rect(250, 260, 300, 560, { r: 0, fill: C.card }) + strip(400, 300, [["01:00", "up", ""], ["02:00", "up", ""], ["03:04", "down", ""], ["04:00", "up", ""], ["05:00", "up", ""]], 300, 90) + W("Uptime with", 1180, 470, 140) + W("a receipt", 1180, 630, 140, { fill: C.blue }));

// ================= D · Every Hour (documentary) =================
render("d1", C.ink, M("13:59:58", 960, 520, 220, { fill: C.endInk }) + circ(700, 760, 12, { fill: C.blue }) + M("bradbury · live", 730, 760, 26, { anchor: "start", fill: "#777" }));
{
  const acts = ["deploy a contract", "write", "fetch a page", "ask a model", "appeal"]; let s = M("heartbeat · run 14:00", 960, 170, 26, { fill: C.ink });
  acts.forEach((a, i) => { const y = 300 + i * 140; s += rect(460, y - 52, 1000, 104, { r: 52, fill: C.card }) + M(a, 520, y, 32, { anchor: "start", fill: C.ink }) + M(i === 4 ? "[upheld]" : "[accepted]", 1400, y, 32, { anchor: "end", fill: C.blue }); });
  render("d2", C.bg, s);
}
{
  let s = rect(220, 130, 1480, 820, { r: 24, fill: "#fff", stroke: C.q1, sw: 4 }) + rect(220, 130, 1480, 80, { r: 24, fill: C.card }) + rect(220, 180, 1480, 30, { r: 0, fill: C.card });
  [270, 305, 340].forEach((x) => (s += circ(x, 170, 10, { fill: C.q2 })));
  s += rect(420, 148, 900, 44, { r: 22, fill: "#fff" }) + M("uptime.genlayer.foundation/examples/bradbury-heartbeat", 870, 170, 18, { fill: C.label });
  s += W("Bradbury Heartbeat", 300, 300, 72, { anchor: "start" });
  for (let i = 0; i < 6; i++) { const y = 420 + i * 80; s += line(300, y + 40, 1620, y + 40, { stroke: C.q1 }) + rect(300, y - 12, 380 - (i % 3) * 60, 24, { r: 12, fill: C.q1 }) + M("[correct]", 1600, y, 24, { anchor: "end", fill: C.blue }); }
  s += M("screen capture · live site", 1690, 1010, 22, { anchor: "end" });
  render("d3", C.bg, s);
}
{
  let s = W("Every hour, in public", 960, 150, 96);
  const red = new Set([33, 34, 101, 140]);
  for (let r = 0; r < 7; r++) for (let c = 0; c < 24; c++) { const i = r * 24 + c; s += rect(300 + c * 55, 300 + r * 82, 44, 64, { r: 8, fill: red.has(i) ? C.red : (r === 6 && c === 23 ? C.blue : C.ink) }); }
  s += M("7 days · 168 runs · illustrative until captured", 960, 960, 22);
  render("d4", C.bg, s);
}
render("d5", C.bg, M("heartbeat contract · bradbury", 960, 380, 26) + M("0x66a4bF89E8812Ced84C405c6f0Cb0E35153EBb3F", 960, 500, 50, { fill: C.ink }) + W("Check it yourself", 960, 700, 110));
render("d6", C.bg, W("We test ourselves first", 960, 540, 130));
render("d7", C.bg, W("Now test yours", 960, 460, 150) + pill(960, 680, "uptime.genlayer.foundation", { size: 34, stroke: C.blue, color: C.blue }));

// ================= E · The Ring (abstract) =================
render("e1", C.bg, circ(960, 540, 70, { fill: C.ink }) + circ(960, 540, 140, { stroke: C.q1, sw: 3 }));
{
  let s = circ(960, 540, 70, { fill: C.ink });
  for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + (i / 12) * 2 * Math.PI; const ex = 960 + 1300 * Math.cos(a), ey = 540 + 1300 * Math.sin(a); const px = 960 + 520 * Math.cos(a + 0.35), py = 540 + 520 * Math.sin(a + 0.35);
    s += pathS(`M ${ex} ${ey} Q ${960 + 800 * Math.cos(a + 0.6)} ${540 + 800 * Math.sin(a + 0.6)} ${px} ${py}`, { stroke: C.q1 }) + circ(px, py, 20, { fill: C.ink }); }
  render("e2", C.bg, s);
}
render("e3", C.bg, circ(960, 540, 70, { fill: C.ink }) + ring(960, 540, 300, [C.blue, C.blue, C.red, C.blue, C.blue, C.blue, C.blue, C.ink, C.blue, C.blue, C.blue, C.blue], { r: 22 }));
render("e4", C.bg, circ(960, 540, 70, { fill: C.ink }) + ring(960, 540, 300, [C.blue, C.blue, C.red, C.blue, C.blue, C.blue, C.blue, C.blue, C.blue, C.blue, C.blue, C.blue], { r: 22, agree: true }) + M("[up]", 960, 960, 34, { fill: C.blue }));
render("e5", C.bg, cube(960, 520, 190) + M("[up] · 14:00", 960, 820, 30, { fill: C.ink }));
{
  let s = line(80, 600, 1840, 600, { stroke: C.q1, sw: 4 }); const st = ["up", "up", "up", "down", "up", "up", "up"];
  st.forEach((v, i) => { const x = 220 + i * 247; s += cube(x, 600, 70) + M(`[${v}]`, x, 740, 26, { fill: v === "down" ? C.red : C.ink }); });
  render("e6", C.bg, s);
}
render("e7", C.bg, ring(960, 540, 440, Array(14).fill(C.blue), { r: 14, agree: true }) + Wrun([["Uptime you can ", C.ink], ["prove", C.blue]], 960, 540, 84));
console.log("frames:", fs.readdirSync(OUT).length);
