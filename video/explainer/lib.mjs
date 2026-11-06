// Drawing primitives for the Uptime explainer.
// Follows the owner's video guidelines (video_illustration.md, video_text_motion.md,
// video_explainer_films.md): flat 2D, ink on white, one blue, one red,
// all text drawn as glyph outlines laid out once per line with the font's kerning.
import opentype from "opentype.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const W = 1920, H = 1080, FPS = 30, CX = 960, CY = 540;

export const C = {
  bg: "#FFFFFF",
  ink: "#070707",
  card: "#F3F3F3",
  quiet1: "#E7E7E7",
  quiet2: "#CDCDCD",
  label: "#999999",
  blue: "#110FFF",
  red: "#FF3B30",
  endBg: "#0A0A0A",
  endInk: "#F7F8F8",
};

// ---------- easing ----------
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2; X(m) < x ? (lo = m) : (hi = m); }
    return Y((lo + hi) / 2);
  };
}
// The one curve: cubic-bezier(.45, 0, .15, 1). No overshoot, no expo.
export const ease = bezier(0.45, 0, 0.15, 1);
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const prog = (t, t0, d) => ease(clamp((t - t0) / d));
export const lerp = (a, b, k) => a + (b - a) * k;

// Peak-speed point of the curve: the cut sits here (video_explainer_films.md, "Motion").
export const CUT_U = (() => {
  let best = 0, bu = 0.5;
  for (let u = 0.01; u < 0.99; u += 0.001) {
    const s = ease(u + 0.001) - ease(u);
    if (s > best) { best = s; bu = u; }
  }
  return bu;
})();

// ---------- cues (sound events) ----------
export const cues = [];
const cueSeen = new Set();
export function cue(kind, t) {
  const k = `${kind}@${t.toFixed(3)}`;
  if (cueSeen.has(k)) return;
  cueSeen.add(k);
  cues.push({ kind, t: +t.toFixed(3) });
}

// ---------- fonts ----------
export const fonts = {
  display: opentype.loadSync(path.join(HERE, "fonts/Lineca-Medium.ttf")),
  mono: opentype.loadSync(path.join(HERE, "fonts/SuisseIntlMono-Regular.ttf")),
};

const layoutCache = new Map();
// Lay out the whole line once with kerning; every glyph keeps this x forever.
export function layout(fontKey, str, fs, track) {
  const key = `${fontKey}|${fs}|${track}|${str}`;
  if (layoutCache.has(key)) return layoutCache.get(key);
  const font = fonts[fontKey];
  const sc = fs / font.unitsPerEm;
  const glyphs = [];
  let x = 0, prev = null;
  for (const ch of str) {
    const g = font.charToGlyph(ch);
    if (prev) x += font.getKerningValue(prev, g) * sc;
    glyphs.push({ ch, g, x });
    x += g.advanceWidth * sc + track * fs;
    prev = g;
  }
  const width = x - (glyphs.length ? track * fs : 0);
  const res = { glyphs, width, cap: (font.tables.os2.sCapHeight || 700) * sc };
  layoutCache.set(key, res);
  return res;
}

const glyphCache = new Map();
function glyphD(fontKey, g, fs) {
  const key = `${fontKey}|${fs}|${g.index}`;
  if (!glyphCache.has(key)) glyphCache.set(key, g.getPath(0, 0, fs).toPathData(2));
  return glyphCache.get(key);
}

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Draw a line of text as outlines.
 * opts: x, y (baseline), fs, font ('display'|'mono'), track, fill, anchor ('start'|'middle'|'end'),
 *   vcenter: if set, y is the optical centre (cap-height centred) instead of baseline
 *   inAt: reveal start (letters rise .42em over .6 s, 18 ms apart, short fade over first 40 %)
 *   outAt: leave start (the reverse, in reading order)
 *   type: { at, cps } typed mono text, one char at a time, with caret
 *   colors: optional per-char colour array
 *   t: current time
 */
export function text(str, o) {
  const fontKey = o.font || "display";
  const fs = o.fs || 80;
  const track = o.track ?? (fontKey === "display" ? -0.03 : 0);
  const L = layout(fontKey, str, fs, track);
  let x0 = o.x;
  if (o.anchor === "middle") x0 -= L.width / 2;
  else if (o.anchor === "end") x0 -= L.width;
  const yb = o.vcenter ? o.y + L.cap / 2 : o.y;
  const t = o.t;
  const fill = o.fill || C.ink;
  const n = L.glyphs.length;
  let out = "";
  const stag = o.stagger ?? 0.018, dur = 0.6, rise = 0.42 * fs;
  let visibleTyped = n;
  if (o.type) {
    const { at, cps = 32 } = o.type;
    visibleTyped = Math.floor((t - at) * cps);
    let k = 0;
    for (let i = 0; i < n; i++) if (L.glyphs[i].ch !== " ") cue(k++ % 3 === 0 ? "type" : "type2", at + i / cps);
  }
  if (o.inAt !== undefined) {
    let w = 0;
    for (let i = 0; i < n; i++) {
      if (L.glyphs[i].ch === " " || i === 0) cue(`word${w++ % 4}`, o.inAt + i * stag);
    }
  }
  for (let i = 0; i < n; i++) {
    const G = L.glyphs[i];
    if (G.ch === " ") continue;
    if (i >= visibleTyped) break;
    let dy = 0, op = 1;
    if (o.inAt !== undefined) {
      const p = clamp((t - (o.inAt + i * stag)) / dur);
      if (p <= 0) continue;
      dy = rise * (1 - ease(p));
      op = clamp(p / 0.4);
    }
    if (o.outAt !== undefined && t >= o.outAt + i * stag) {
      const p = clamp((t - (o.outAt + i * stag)) / dur);
      if (p >= 1) continue;
      dy += rise * ease(p);
      op *= clamp((1 - p) / 0.4);
    }
    const col = (o.colors && o.colors[i]) || fill;
    const d = glyphD(fontKey, G.g, fs);
    out += `<path transform="translate(${r2(x0 + G.x)},${r2(yb + dy)})" d="${d}" fill="${col}"${op < 1 ? ` fill-opacity="${r2(op)}"` : ""}${o.opacity ? ` opacity="${o.opacity}"` : ""}/>`;
  }
  if (o.type && o.caret !== false) {
    const on = t < o.type.at + n / (o.type.cps || 32) + 0.1 || Math.floor(t * 2) % 2 === 0;
    if (t >= o.type.at - 0.4 && on && (o.caretUntil === undefined || t < o.caretUntil)) {
      const cx = visibleTyped >= n ? L.width + fs * 0.12 : (L.glyphs[Math.max(0, visibleTyped)] || { x: L.width }).x;
      out += `<rect x="${r2(x0 + Math.max(0, cx))}" y="${r2(yb - L.cap - fs * 0.06)}" width="${r2(fs * 0.55)}" height="${r2(L.cap + fs * 0.12)}" fill="${o.caretFill || fill}"/>`;
    }
  }
  return out;
}
export const textWidth = (str, fs = 80, fontKey = "display", track) =>
  layout(fontKey, str, fs, track ?? (fontKey === "display" ? -0.03 : 0)).width;

// ---------- shapes ----------
// Appear in place: whole and opaque on its first frame, a small scale settle around its centre.
export function appear(svg, cx, cy, t, at, { from = 0.92, d = 0.6, kind = "pop" } = {}) {
  cue(kind, at);
  if (t < at) return "";
  const s = lerp(from, 1, prog(t, at, d));
  if (s === 1) return svg;
  return `<g transform="translate(${r2(cx)},${r2(cy)}) scale(${s.toFixed(4)}) translate(${r2(-cx)},${r2(-cy)})">${svg}</g>`;
}

export function rect(x, y, w, h, { r = 24, fill = C.card, stroke = "none", sw = 2 } = {}) {
  return `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

// Isometric points of a cube of "radius" s centred on (cx, cy).
function cubePts(cx, cy, s) {
  const w = s * 0.866;
  return {
    T: [cx, cy - s], UR: [cx + w, cy - s / 2], LR: [cx + w, cy + s / 2],
    B: [cx, cy + s], LL: [cx - w, cy + s / 2], UL: [cx - w, cy - s / 2], C: [cx, cy],
  };
}
const poly = (pts) => pts.map((p) => `${r2(p[0])},${r2(p[1])}`).join(" ");

// L.CUBE: the solid cube of three rounded faces (GenVM). Blue when it reaches the world.
export function solidCube(cx, cy, s, fill = C.blue) {
  const P = cubePts(cx, cy, s);
  const faces = [[P.T, P.UR, P.C, P.UL], [P.UL, P.C, P.B, P.LL], [P.C, P.UR, P.LR, P.B]];
  const gap = s * 0.07, round = s * 0.16;
  let out = "";
  for (const f of faces) {
    const mx = f.reduce((a, p) => a + p[0], 0) / 4, my = f.reduce((a, p) => a + p[1], 0) / 4;
    const k = gap + round / 2;
    const shr = f.map(([x, y]) => {
      const dx = x - mx, dy = y - my, l = Math.hypot(dx, dy);
      return [x - (dx / l) * k * 1.6, y - (dy / l) * k * 1.6];
    });
    out += `<polygon points="${poly(shr)}" fill="${fill}" stroke="${fill}" stroke-width="${r2(round)}" stroke-linejoin="round"/>`;
  }
  return out;
}

// OB.AICUBE: the sharp wireframe cube (a model, or a validator's model).
export function wireCube(cx, cy, s, stroke = C.ink, sw = 2) {
  const P = cubePts(cx, cy, s);
  return `<g fill="#FFFFFF" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="miter">` +
    `<polygon points="${poly([P.T, P.UR, P.LR, P.B, P.LL, P.UL])}"/>` +
    `<polyline fill="none" points="${poly([P.UL, P.C, P.UR])}"/><line x1="${r2(P.C[0])}" y1="${r2(P.C[1])}" x2="${r2(P.B[0])}" y2="${r2(P.B[1])}"/></g>`;
}

// A.DOTS: work in progress, 3x3 dot loader.
export function dots(cx, cy, t, color = C.ink, gap = 12, r = 3.2) {
  let out = "";
  const order = [0, 1, 2, 5, 8, 7, 6, 3];
  const k = Math.floor(t * 10) % 8;
  for (let i = 0; i < 9; i++) {
    const x = cx + ((i % 3) - 1) * gap, y = cy + (Math.floor(i / 3) - 1) * gap;
    const lit = i === 4 || order[k] === i || order[(k + 7) % 8] === i;
    out += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="${lit ? color : C.quiet2}"/>`;
  }
  return out;
}

// $ coin (OB.COIN). Money moving.
export function coin(cx, cy, r = 22, fill = C.blue) {
  const L = layout("display", "$", r * 1.25, 0);
  return `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r}" fill="${fill}"/>` +
    `<path transform="translate(${r2(cx - L.width / 2)},${r2(cy + L.cap / 2)})" d="${glyphD("display", L.glyphs[0].g, r * 1.25)}" fill="#FFFFFF"/>`;
}

// Lucide-style icons in a 24-unit box, ink stroke.
const ICONS = {
  globe: `<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`,
  server: `<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>`,
  mail: `<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>`,
  clock: `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
  code: `<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>`,
  rocket: `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>`,
  unlock: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`,
};
export function icon(name, x, y, size = 28, stroke = C.ink, sw = 2) {
  if (name === "cube") return wireCube(x + size / 2, y + size / 2, size * 0.5, stroke, sw * 0.9);
  const s = size / 24;
  return `<g transform="translate(${r2(x)},${r2(y)}) scale(${s.toFixed(4)})" fill="none" stroke="${stroke}" stroke-width="${r2(sw / s)}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;
}

/**
 * A pill: hugs content (or a shared width), mono upper-case label, optional icon.
 * style: 'note' (grey notification), 'web' (white + ink stroke: outside the contract),
 *        'ic' (white + blue stroke: Intelligent Contract), 'red'
 */
export function pill(label, cx, cy, { w, h = 64, style = "note", iconName, fs = 22 } = {}) {
  const st = {
    note: { fill: C.card, stroke: C.quiet1, ink: C.ink },
    web: { fill: "#FFFFFF", stroke: C.ink, ink: C.ink },
    ic: { fill: "#FFFFFF", stroke: C.blue, ink: C.ink },
    red: { fill: "#FFFFFF", stroke: C.red, ink: C.red },
  }[style];
  const tw = textWidth(label, fs, "mono");
  const iw = iconName ? fs * 1.3 + 14 : 0;
  const width = w || tw + iw + 56;
  const x = cx - width / 2, y = cy - h / 2;
  let out = rect(x, y, width, h, { r: h / 2, fill: st.fill, stroke: st.stroke, sw: 2.5 });
  const cw = tw + iw;
  const sx = cx - cw / 2;
  if (iconName) out += icon(iconName, sx, cy - (fs * 1.3) / 2, fs * 1.3, iconName === "cube" ? st.ink : st.ink, 2.2);
  out += text(label, { x: sx + iw, y: cy, vcenter: true, fs, font: "mono", fill: st.ink, t: 1e9 });
  return out;
}
export const pillWidth = (label, { fs = 22, iconName } = {}) =>
  textWidth(label, fs, "mono") + (iconName ? fs * 1.3 + 14 : 0) + 56;

// Point on a cubic bezier.
export function bez3(p0, p1, p2, p3, u) {
  const v = 1 - u;
  return [
    v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
    v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1],
  ];
}
