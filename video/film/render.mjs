// Uptime — launch film: Uptime you can prove. Every frame is an SVG string built from glyph outlines
// (never <text>), rasterised by resvg and piped to ffmpeg.
// Follows video_launch_motion.md: no fades, expo.out entrances over D, match cuts
// (out up on expo.in ending on the cut, in from below), a linear push-in per shot.
//
//   node render.mjs                     1920x1080 -> ../out/uptime-film-16x9.mp4
//   node render.mjs --vertical          1080x1920 -> ../out/uptime-film-9x16.mp4
//   node render.mjs --stills 1,5.5,20   PNG stills -> ../out/stills/
//
// Sound: an effects track built from draw cues (one beep per word, a sound per kind of
// motion, a whoosh per cut), synthesised by ../explainer/sfx.mjs. No music: the design
// repo's video/README.md says music comes from an AI model on fal.ai, never synthesised.
//
// Fonts are NOT in the repo (licensed). Put them in ./fonts first:
//   fonts/Lineca-500.ttf  = F37Lineca-VF.ttf instanced at wght=500 slnt=0
//   fonts/SuisseMono.otf  = SuisseIntlMono-Regular.woff2 decompressed
// Both come from portal/portal/frontend/public/fonts (projects/design/LICENSE-FONTS.md):
//   fonttools varLib.instancer F37Lineca-VF.ttf wght=500 slnt=0 -o fonts/Lineca-500.ttf
//   python -c "from fontTools.ttLib import TTFont as T; f=T('SuisseIntlMono-Regular.woff2'); f.flavor=None; f.save('fonts/SuisseMono.otf')"
// Icons (globe, user, bell) are Lucide. Logo is projects/design/assets/GenLayer_Logo_White.svg.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";
import { synth } from "../explainer/sfx.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../out");
const args = process.argv.slice(2);
const VERT = args.includes("--vertical");
const stillsArg = args.includes("--stills") ? args[args.indexOf("--stills") + 1] : null;

const W = VERT ? 1080 : 1920, H = VERT ? 1920 : 1080, CX = W / 2, CY = H / 2;
const FPS = 30, F = 1 / FPS;
const D = 30 * F; // every entrance, exit and half cut

const C = {
  white: "#FFFFFF", ink: "#070707", card: "#F3F3F3", q1: "#E7E7E7", q2: "#CDCDCD",
  label: "#999999", blue: "#110FFF", red: "#FF3B30", night: "#0A0A0A", logo: "#F7F8F8",
};

// ---------- cues (sound events), registered as things are drawn ----------
const CUES = [], seen = new Set();
function cue(kind, at) {
  if (!(at >= 0)) return;
  const k = `${kind}@${at.toFixed(3)}`;
  if (seen.has(k)) return;
  seen.add(k); CUES.push({ kind, t: +at.toFixed(3) });
}

// ---------- easing + motion ----------
const expoOut = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));
const expoIn = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, 10 * (p - 1)));
const n3 = (v) => (Math.round(v * 1000) / 1000).toString();

// Whole and opaque from its first frame; only y/scale animate.
function enter(t, tIn, tOut = 1e9, fromY = 24, fromS = 1) {
  if (t < tIn || t >= tOut) return null;
  const p = expoOut((t - tIn) / D);
  return { y: fromY * (1 - p), s: fromS + (1 - fromS) * p };
}
// Exit layer: y 0 -> -300 on expo.in over D, ending (and removed) at tEnd.
function exitY(t, tEnd, dist = -300) {
  if (t >= tEnd) return null;
  return dist * expoIn((t - (tEnd - D)) / D);
}
const g = (dx, dy, inner) => (inner ? `<g transform="translate(${n3(dx)} ${n3(dy)})">${inner}</g>` : "");
const gs = (m, cx, cy, inner) =>
  m && inner ? `<g transform="translate(${n3(cx)} ${n3(cy + m.y)}) scale(${n3(m.s)}) translate(${n3(-cx)} ${n3(-cy)})">${inner}</g>` : "";
function layer(t, tEnd, inner, dist) {
  const y = exitY(t, tEnd, dist);
  return y === null ? "" : g(0, y, inner);
}

// ---------- type: glyph outlines ----------
const FONTS = {
  d: opentype.loadSync(path.join(HERE, "fonts/Lineca-500.ttf")),
  m: opentype.loadSync(path.join(HERE, "fonts/SuisseMono.otf")),
};
const TRACK = { d: -0.03, m: 0 };
const CAP = { d: 0.64, m: 0.725 };
const gcache = new Map();
function gpath(fk, glyph, size) {
  const k = `${fk}|${glyph.index}|${size}`;
  if (!gcache.has(k)) gcache.set(k, glyph.getPath(0, 0, size).toPathData(2));
  return gcache.get(k);
}
function layoutLine(fk, chars, size, track) {
  const font = FONTS[fk], sc = size / font.unitsPerEm, out = [];
  let x = 0, prev = null;
  for (const ch of chars) {
    const gl = font.charToGlyph(ch);
    if (prev) x += font.getKerningValue(prev, gl) * sc;
    out.push({ ch, gl, x });
    x += gl.advanceWidth * sc + track * size;
    prev = gl;
  }
  return { glyphs: out, width: x - track * size };
}
function measure(str, size, fk = "d", track = TRACK[fk]) {
  return layoutLine(fk, [...str], size, track).width;
}
// o: { str | spans:[[text,color]], fill, font, size, track, x, y(baseline), align,
//      tIn, tOut, unit:'word'|'letter'|null, step, rise, opacity }
function text(t, o) {
  const fk = o.font || "d", size = o.size, track = o.track ?? TRACK[fk];
  const spans = o.spans || [[o.str, o.fill]];
  const chars = [], cols = [];
  for (const [s, c] of spans) for (const ch of s) { chars.push(ch); cols.push(c); }
  const L = layoutLine(fk, chars, size, track);
  let x0 = o.x;
  if (o.align === "right") x0 -= L.width;
  else if (o.align === "center") x0 -= L.width / 2;
  const unit = [];
  let k = 0;
  chars.forEach((ch) => {
    if (o.unit === "word") { unit.push(k); if (ch === " ") k++; }
    else if (o.unit === "letter") { unit.push(k); if (ch !== " ") k++; }
    else unit.push(0);
  });
  if (o.tIn >= 0) {
    if (fk === "m") cue("data", o.tIn);
    else { const n = Math.max(...unit) + 1; for (let u = 0; u < n; u++) cue("word", o.tIn + u * (o.step || 0)); }
  }
  let s = "";
  L.glyphs.forEach((gg, i) => {
    if (chars[i] === " ") return;
    if (o.hide && o.hide(i, chars[i])) return;
    const m = enter(t, o.tIn + unit[i] * (o.step || 0), o.tOut ?? 1e9, o.rise ?? 24);
    if (!m) return;
    s += `<path transform="translate(${n3(x0 + gg.x)} ${n3(o.y + m.y)})" d="${gpath(fk, gg.gl, size)}" fill="${cols[i]}"/>`;
  });
  if (!s) return "";
  return o.opacity != null ? `<g opacity="${o.opacity}">${s}</g>` : s;
}

// ---------- composition: words either side of the object ----------
const GAP = VERT ? 84 : 64;
const warned = new Set();
// Left words end GAP before the object, right words start GAP after it, both
// optically centred on it. Vertical cut: left words above, right words below.
function flank(t, o) {
  const size = o.size || (VERT ? 92 : 80), cap = CAP.d * size, out = [];
  const common = { size, unit: "word", step: 0.12, rise: 24 };
  const L = o.left, R = o.right;
  if (!VERT) {
    const yb = CY + cap / 2;
    if (L) out.push(text(t, { ...common, ...L, x: CX - o.objW / 2 - GAP, y: yb, align: "right" }));
    if (R) out.push(text(t, { ...common, ...R, x: CX + o.objW / 2 + GAP, y: yb, align: "left" }));
    for (const side of [L, R]) {
      if (!side) continue;
      const str = side.str ?? side.spans.map((s) => s[0]).join("");
      const room = (W - o.objW) / 2 - GAP - 96;
      if (measure(str, size) > room && !warned.has(str)) { warned.add(str); console.warn(`TOO WIDE: "${str}"`); }
    }
  } else {
    if (L) out.push(text(t, { ...common, ...L, x: CX, y: CY - o.objH / 2 - GAP, align: "center" }));
    if (R) out.push(text(t, { ...common, ...R, x: CX, y: CY + o.objH / 2 + GAP + cap, align: "center" }));
  }
  return out.join("");
}

// ---------- vocabulary ----------
// Solid cube of three rounded faces (GenVM / block). e = edge length.
function solidCube(cx, cy, e, fill) {
  const a = e * Math.sin(Math.PI / 3);
  const P = { T: [0, -e], UL: [-a, -e / 2], UR: [a, -e / 2], C: [0, 0], LL: [-a, e / 2], LR: [a, e / 2], B: [0, e] };
  const faces = [["T", "UR", "C", "UL"], ["UL", "C", "B", "LL"], ["C", "UR", "LR", "B"]];
  const r = e * 0.16, gap = e * 0.07, inr = (e * Math.sin(Math.PI / 3)) / 2;
  const k = 1 - (gap / 2 + r / 2) / inr;
  return faces.map((f) => {
    const pts = f.map((n) => P[n]);
    const mx = pts.reduce((s, p) => s + p[0], 0) / 4, my = pts.reduce((s, p) => s + p[1], 0) / 4;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${n3(cx + mx + (p[0] - mx) * k)} ${n3(cy + my + (p[1] - my) * k)}`).join("") + "Z";
    return `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="${n3(r)}" stroke-linejoin="round"/>`;
  }).join("");
}
// Sharp wireframe cube (model / validator).
function wireCube(cx, cy, e, stroke, sw) {
  const a = e * Math.sin(Math.PI / 3);
  const p = (x, y) => `${n3(cx + x)} ${n3(cy + y)}`;
  return `<g fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round">` +
    `<path d="M${p(0, -e)}L${p(a, -e / 2)}L${p(a, e / 2)}L${p(0, e)}L${p(-a, e / 2)}L${p(-a, -e / 2)}Z"/>` +
    `<path d="M${p(-a, -e / 2)}L${p(0, 0)}L${p(a, -e / 2)}M${p(0, 0)}L${p(0, e)}"/></g>`;
}
// GenLayer's jury — a new concept, so its own shape: a jury box, a row of abstract
// heads behind one grey front panel. No labels, no per-seat results; it decides as one.
const JURY = { w: 400, h: 190 };
function juryBox(cx, cy, ink = C.ink) {
  const { w, h } = JURY, top = cy - h / 2, pt = cy + 6, n = 6;
  const step = (w - 96) / (n - 1), x0 = cx - (w - 96) / 2;
  let o = "";
  for (let i = 0; i < n; i++) {
    const x = x0 + i * step;
    o += `<path d="M${n3(x - 26)} ${n3(pt + 10)}v-12a26 26 0 0 1 52 0v12" fill="${C.white}" stroke="${ink}" stroke-width="3"/>`;
    o += `<circle cx="${n3(x)}" cy="${n3(top + 36)}" r="18" fill="${C.white}" stroke="${ink}" stroke-width="3"/>`;
  }
  return o + `<rect x="${n3(cx - w / 2)}" y="${n3(pt)}" width="${w}" height="${n3(top + h - pt)}" rx="24" fill="${C.card}" stroke="${C.q1}" stroke-width="2"/>`;
}
// One blue outline round the group, drawn on over D (expo.out).
function juryOutline(t, cx, cy, at) {
  if (at < 0) return "";
  cue("agree", at);
  if (t < at) return "";
  const pad = 24, x = cx - JURY.w / 2 - pad, y = cy - JURY.h / 2 - pad, w = JURY.w + 2 * pad, h = JURY.h + 2 * pad, per = 2 * (w + h);
  const k = expoOut((t - at) / D);
  return `<rect x="${n3(x)}" y="${n3(y)}" width="${n3(w)}" height="${n3(h)}" rx="38" fill="none" stroke="${C.blue}" stroke-width="3" stroke-dasharray="${n3(per * k)} ${n3(per)}"/>`;
}

// Lucide icons (24-unit box), flagged as Lucide in README.
const ICON = {
  globe: `<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`,
  user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  bell: `<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>`,
};
function icon(name, cx, cy, size, stroke) {
  const s = size / 24;
  return `<g transform="translate(${n3(cx - size / 2)} ${n3(cy - size / 2)}) scale(${n3(s)})" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</g>`;
}
// Pill that hugs its content: [icon] MONO LABEL
const MONO = 30;
function pillGeom(label, withIcon = true) {
  const tw = measure(label, MONO, "m"), iw = withIcon ? 34 + 18 : 0;
  return { w: tw + iw + 2 * 38, h: 84, tw, iw };
}
function pill(t, cx, cy, label, o) {
  const G = pillGeom(label, !!o.icon);
  const x = cx - G.w / 2;
  let s = `<rect x="${n3(x)}" y="${n3(cy - G.h / 2)}" width="${n3(G.w)}" height="${G.h}" rx="${G.h / 2}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="3"/>`;
  if (o.icon) s += icon(o.icon, x + 38 + 17, cy, 34, o.stroke);
  s += text(t, { str: label, font: "m", size: MONO, fill: o.color, x: x + 38 + G.iw, y: cy + (CAP.m * MONO) / 2, tIn: -1 });
  return s;
}
function coin(cx, cy, color) {
  const size = 30, w = measure("$", size);
  return `<circle cx="${n3(cx)}" cy="${n3(cy)}" r="26" fill="${color}"/>` +
    text(0, { str: "$", size, fill: C.white, x: cx - w / 2, y: cy + (CAP.d * size) / 2 + 2, tIn: -1 });
}
const bez = (p, u) => {
  const v = 1 - u;
  return [0, 1].map((k) => v * v * v * p[0][k] + 3 * v * v * u * p[1][k] + 3 * v * u * u * p[2][k] + u * u * u * p[3][k]);
};
const ease = (u) => { // cubic-bezier(.45,0,.15,1) approximated by solving x(s)=u
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2, x = 3 * (1 - s) * (1 - s) * s * 0.45 + 3 * (1 - s) * s * s * 0.15 + s * s * s;
    if (x < u) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) * s * s + s * s * s;
};

const LOGO = (() => {
  const svg = fs.readFileSync(path.resolve(HERE, "../../../design/assets/GenLayer_Logo_White.svg"), "utf8");
  const ds = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1])
    .concat([...svg.matchAll(/points="([^"]+)"/g)].map((m) => {
      const n = m[1].trim().split(/[\s,]+/).map(Number), pts = [];
      for (let i = 0; i < n.length; i += 2) pts.push(`${n[i]} ${n[i + 1]}`);
      return `M${pts.join("L")}Z`;
    }));
  return { ds, w: 385.32, h: 91.93 };
})();

// ---------- the film ----------
const S = [];
const shot = (t0, t1, bg, draw) => S.push({ t0, t1, bg, draw });
const nightInk = C.logo;

// 1 · 3:04 AM — the hour nobody is watching
shot(0, 3.2, C.night, (t) => {
  const size = VERT ? 200 : 220, str = "3:04 AM";
  const colonOn = t < 1.6 || Math.floor((t - 1.6) / 0.5) % 2 === 1;
  return layer(t, 3.2, text(t, {
    str, size, fill: nightInk, x: CX, y: CY + (CAP.d * size) / 2, align: "center",
    unit: "letter", step: 3 * F, tIn: 0.3, rise: 0.42 * size, hide: (i, ch) => ch === ":" && !colonOn,
  }));
});

// 2 · Your site went down
shot(3.2, 7.0, C.night, (t) => {
  const label = "YOURSITE.COM", G = pillGeom(label), down = t >= 4.7;
  const col = down ? C.red : nightInk;
  const pillS = gs(enter(t, 3.2, 1e9, 160, 0.92), CX, CY, pill(t, CX, CY, label, { icon: "globe", fill: C.night, stroke: col, color: col }));
  const tag = text(t, { str: "[DOWN]", font: "m", size: MONO, fill: C.red, x: CX, y: CY + 90 + 22, align: "center", tIn: 4.7 });
  return layer(t, 7.0 - 6 * F, tag) +
    layer(t, 7.0 - 3 * F, flank(t, { objW: G.w, objH: G.h + 120, left: { str: "Your site", fill: nightInk, tIn: 3.6 } })) +
    layer(t, 7.0, pillS + flank(t, { objW: G.w, objH: G.h + 120, right: { str: "went down", fill: nightInk, tIn: 4.25 } }));
});

// 3 · The dashboard said fine
shot(7.0, 10.6, C.night, (t) => {
  const cw = 440, ch = 290, x = CX - cw / 2, y = CY - ch / 2;
  const rows = [["YOURSITE.COM", 7.55], ["API", 7.75], ["CHECKOUT", 7.95]];
  let card = `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="24" fill="${C.night}" stroke="#3A3A3A" stroke-width="2"/>`;
  card += text(t, { str: "STATUS", font: "m", size: 22, fill: C.label, x: x + 40, y: y + 62, tIn: -1 });
  let inner = "";
  rows.forEach(([name, ti], i) => {
    const ry = y + 128 + i * 56;
    inner += text(t, { str: name, font: "m", size: 28, fill: nightInk, x: x + 40, y: ry, tIn: ti });
    inner += text(t, { str: "[UP]", font: "m", size: 28, fill: nightInk, x: x + cw - 40, y: ry, align: "right", tIn: ti });
  });
  const cardS = gs(enter(t, 7.0, 1e9, 160, 0.92), CX, CY, card + inner);
  return layer(t, 10.6 - 3 * F, flank(t, { objW: cw, objH: ch, left: { str: "The dashboard", fill: nightInk, tIn: 7.35 } })) +
    layer(t, 10.6, cardS + flank(t, { objW: cw, objH: ch, right: { str: "said fine", fill: nightInk, tIn: 8.5 } }));
});

// 4 · The monitor is theirs / Paid when it says up
shot(10.6, 16.0, C.night, (t) => {
  const r = 104, objW = 540, ocx = CX + (VERT ? 120 : 150), ocy = CY;
  let o = `<circle cx="${ocx}" cy="${ocy}" r="${r}" fill="${C.night}" stroke="${nightInk}" stroke-width="3"/>` + icon("user", ocx, ocy, 76, nightInk);
  // coins: paid into the monitor, on branching curves; the stream never stops
  let money = "";
  if (t >= 13.0) {
    // branching curves from the left edge of the group into the circle, each
    // landing on its own point of the rim so coins never pile up
    const ends = [-190, -65, 65, 190].map((dy) => [-320, dy]);
    const rim = [-38, -13, 13, 38].map((deg) => [ocx - r * Math.cos((deg * Math.PI) / 180), ocy + r * Math.sin((deg * Math.PI) / 180)]);
    const curves = ends.map(([dx, dy], i) => [[ocx + dx, ocy + dy], [ocx - 200, ocy + dy], [ocx - 210, rim[i][1]], rim[i]]);
    const p = Math.min(1, expoOut((t - 13.0) / D));
    curves.forEach((cv) => {
      // lines draw in from the left
      const pts = [];
      for (let i = 0; i <= 40; i++) { const u = (i / 40) * p; pts.push(bez(cv, u)); }
      money += `<path d="M${pts.map((q) => q.map(n3).join(" ")).join("L")}" fill="none" stroke="${C.label}" stroke-width="2"/>`;
    });
    const T = 1.4, every = 1.1;
    curves.forEach((cv, i) => {
      for (let k = 0; k < 8; k++) {
        const born = 13.15 + [0, 0.55, 0.25, 0.8][i] + k * every, u = (t - born) / T;
        if (u < 0 || u >= 1) continue;
        const [qx, qy] = bez(cv, ease(u));
        money += coin(qx, qy, C.blue);
      }
    });
  }
  const objS = gs(enter(t, 10.6, 1e9, 160, 0.92), ocx, ocy, money + o);
  const A = flank(t, { objW, objH: VERT ? 470 : 2 * r + 40, left: { str: "The monitor", fill: nightInk, tIn: 10.9, tOut: 12.85 }, right: { str: "is theirs", fill: nightInk, tIn: 11.5, tOut: 12.85 } });
  const B1 = flank(t, { objW, objH: VERT ? 470 : 2 * r + 40, left: { str: "Paid when", fill: nightInk, tIn: 13.0 } });
  const B2 = flank(t, { objW, objH: VERT ? 470 : 2 * r + 40, right: { str: "it says up", fill: nightInk, tIn: 13.6 } });
  return A + layer(t, 16.0 - 3 * F, B1) + layer(t, 16.0, objS + B2);
});

// 5 · The turn: Now GenLayer's [jury] jury decides — the ground cuts to white
const JY = CY - 20;
function juryScene(t, t0, o = {}) {
  cue("pop", t0);
  const box = gs(enter(t, t0, 1e9, 160, 0.92), CX, JY, juryBox(CX, JY));
  const res = o.resAt === undefined ? "" : text(t, { str: "[DOWN]", font: "m", size: MONO, fill: C.ink, x: CX, y: JY + JURY.h / 2 + 96, align: "center", tIn: o.resAt });
  return box + juryOutline(t, CX, JY, o.outAt ?? -1) + res;
}
const JH = JURY.h + 200;
shot(16.0, 20.0, C.white, (t) => {
  const obj = juryScene(t, 16.0, { outAt: 18.0, resAt: 18.35 });
  return layer(t, 20.0 - 3 * F, flank(t, { objW: JURY.w + 48, objH: JH, left: { str: "Now GenLayer’s", fill: C.ink, tIn: 16.35 } })) +
    layer(t, 20.0, obj + flank(t, { objW: JURY.w + 48, objH: JH, right: { spans: [["jury ", C.ink], ["decides", C.blue]], tIn: 16.95 } }));
});

// 6 · A false report [one red mark, struck and thrown out] won't stand
shot(20.0, 23.6, C.white, (t) => {
  let obj = juryScene(t, 20.0, { outAt: 20.0, resAt: 20.0 });
  const my = JY - JURY.h / 2 - 82, mw = measure("[UP]", MONO, "m");
  let mark = text(t, { str: "[UP]", font: "m", size: MONO, fill: C.red, x: CX, y: my, align: "center", tIn: 20.55 });
  cue("fail", 21.5);
  if (t >= 21.5) { const k = expoOut((t - 21.5) / (12 * F)); mark += `<path d="M${n3(CX - mw / 2 - 10)} ${n3(my - 11)}h${n3((mw + 20) * k)}" stroke="${C.red}" stroke-width="3"/>`; }
  obj += layer(t, 22.6, mark);
  return layer(t, 23.6 - 3 * F, flank(t, { objW: JURY.w + 48, objH: JH, left: { str: "A false report", fill: C.ink, tIn: 20.35 } })) +
    layer(t, 23.6, obj + flank(t, { objW: JURY.w + 48, objH: JH, right: { str: "won’t stand", fill: C.ink, tIn: 21.7 } }));
});

// 7 · The truth lands on-chain — sealed block (timed as written, played 3 s earlier)
const at = (dt, draw) => (t) => draw(t + dt);
shot(23.6, 27.4, C.white, at(3.0, (t) => {
  const e = 110, objW = 2 * e * Math.sin(Math.PI / 3);
  const cube = gs(enter(t, 26.6, 1e9, 160, 0.88), CX, CY, solidCube(CX, CY, e, C.ink));
  const tag = text(t, { str: "[DOWN · 03:04 AM]", font: "m", size: MONO, fill: C.ink, x: CX, y: CY + e + 70, align: "center", tIn: 27.95 });
  return layer(t, 30.4 - 6 * F, tag) +
    layer(t, 30.4 - 3 * F, flank(t, { objW, objH: 2 * e + 120, left: { str: "The truth", fill: C.ink, tIn: 26.95 } })) +
    layer(t, 30.4, cube + flank(t, { objW, objH: 2 * e + 120, right: { str: "lands on-chain", fill: C.ink, tIn: 27.5 } }));
}));
cue("lock", 23.6);

// 8 · You get the alert / Before your users do
shot(27.4, 32.0, C.white, at(3.0, (t) => {
  const label = "YOURSITE.COM IS DOWN", G = pillGeom(label);
  const p = gs(enter(t, 30.4, 1e9, 160, 0.92), CX, CY, pill(t, CX, CY, label, { icon: "bell", fill: C.white, stroke: C.red, color: C.red }));
  const lab = text(t, { str: "UPTIME ALERT", font: "m", size: 22, fill: C.label, x: CX, y: CY - 70, align: "center", tIn: 31.7 });
  const objH = G.h + 80;
  const A = flank(t, { objW: G.w, objH, left: { str: "You get", fill: C.ink, tIn: 30.75, tOut: 32.6 }, right: { str: "the alert", fill: C.ink, tIn: 31.3, tOut: 32.6 } });
  const B1 = flank(t, { objW: G.w, objH, left: { str: "Before", fill: C.ink, tIn: 32.8 } });
  const B2 = flank(t, { objW: G.w, objH, right: { str: "your users do", fill: C.ink, tIn: 33.15 } });
  return layer(t, 35.0 - 6 * F, lab) + A + layer(t, 35.0 - 3 * F, B1) + layer(t, 35.0, p + B2);
}));
cue("alert", 27.4);

// 9 · Uptime / you can prove
shot(32.0, 35.6, C.white, (t) => {
  const big = VERT ? 200 : 180, sm = VERT ? 92 : 80, gapB = VERT ? 130 : 120;
  const yTop = CY - (CAP.d * big + gapB) / 2 + CAP.d * big;
  const s = text(t, { str: "Uptime", size: big, fill: C.ink, x: CX, y: yTop, align: "center", unit: "letter", step: 2 * F, tIn: 32.0, rise: 0.42 * big });
  const tag = text(t, { spans: [["you can ", C.ink], ["prove", C.blue]], size: sm, x: CX, y: yTop + gapB, align: "center", unit: "word", step: 0.12, tIn: 32.75, rise: 24 });
  return layer(t, 35.6 - 3 * F, tag) + layer(t, 35.6, s);
});

// 10 · End card — Built on GenLayer
shot(35.6, 39.8, C.night, (t) => {
  const lw = VERT ? 700 : 806, lh = (lw * LOGO.h) / LOGO.w, sc = lw / LOGO.w;
  const top = CY - 190;
  cue("logo", 35.6);
  const label = text(t, { str: "BUILT ON", font: "m", size: 32, track: 0.08, fill: C.logo, opacity: 0.5, x: CX, y: top, align: "center", tIn: 36.1 });
  const ly = top + 40;
  const logo = gs(enter(t, 35.6, 1e9, 24, 0.88), CX, ly + lh / 2,
    `<g transform="translate(${n3(CX - lw / 2)} ${n3(ly)}) scale(${n3(sc)})">${LOGO.ds.map((d) => `<path d="${d}" fill="${C.logo}"/>`).join("")}</g>`);
  const url = text(t, { str: "uptime.genlayer.foundation", font: "m", size: VERT ? 40 : 40, fill: C.logo, x: CX, y: ly + lh + 110, align: "center", tIn: 36.7 });
  const note = text(t, { str: "NOT AUDITED · TESTNET ONLY", font: "m", size: 22, track: 0.08, fill: C.logo, opacity: 0.5, x: CX, y: ly + lh + 170, align: "center", tIn: 37.3 });
  return label + logo + url + note;
});

const DUR = S[S.length - 1].t1;

function frameSVG(t) {
  const sc = S.find((s) => t >= s.t0 && t < s.t1) || S[S.length - 1];
  const push = 1 + 0.04 * Math.min(1, (t - sc.t0) / (sc.t1 - sc.t0)); // linear, restarts every cut
  const body = sc.draw(t);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${sc.bg}"/>` +
    `<g transform="translate(${CX} ${CY}) scale(${n3(push)}) translate(${-CX} ${-CY})">${body}</g></svg>`;
}
const raster = (svg) => new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render();

fs.mkdirSync(OUT, { recursive: true });
const tag = VERT ? "9x16" : "16x9";

if (stillsArg) {
  const dir = path.join(OUT, "stills");
  fs.mkdirSync(dir, { recursive: true });
  for (const ts of stillsArg.split(",")) {
    const t = Number(ts), f = path.join(dir, `${tag}-${Number(ts).toFixed(1).padStart(4, "0")}s.png`);
    fs.writeFileSync(f, raster(frameSVG(Math.round(t * FPS) / FPS)).asPng());
    console.log(f);
  }
} else {
  // collect cues by drawing every shot at a fine step, then a whoosh on each cut
  for (const sc of S) for (let t = sc.t0; t < sc.t1; t += 0.02) sc.draw(t);
  S.slice(1).forEach((sc) => cue("whoosh", sc.t0));
  const kept = CUES.filter((c) => c.t < DUR).sort((a, b) => a.t - b.t);
  const wav = path.join(OUT, `film-sfx-${tag}.wav`);
  fs.writeFileSync(path.join(OUT, `film-cues-${tag}.json`), JSON.stringify(kept, null, 1));
  synth(kept, DUR, wav);
  const file = path.join(OUT, `uptime-film-${tag}.mp4`);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", `${FPS}`, "-i", "-", "-i", wav,
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", `${FPS}`, "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const N = Math.round(DUR * FPS);
  for (let i = 0; i < N; i++) {
    const img = raster(frameSVG(i / FPS));
    if (!ff.stdin.write(Buffer.from(img.pixels))) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 150 === 0) console.log(`${tag} frame ${i}/${N}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`${file}  ${N} frames, ${DUR}s`);
}
