// The Uptime explainer: a list of shots, each a function of time returning SVG.
// Times are absolute seconds; `b` is the shot's start.
import {
  W, H, CX, CY, C, ease, prog, lerp, clamp, CUT_U, cue,
  text, textWidth, appear, rect, solidCube, wireCube, dots, coin, icon, pill, pillWidth, bez3, juryBox, JURY, outline,
} from "./lib.mjs";

const GAP = 64; // words either side of the object

// Side words, optically centred on the object.
function sides(t, objW, left, right, o = {}) {
  let out = "";
  const y = o.y ?? CY;
  if (left) out += text(left.s, { x: CX - objW / 2 - GAP, y, vcenter: true, anchor: "end", fs: 80, t,
    inAt: left.at, outAt: left.out, colors: left.colors });
  if (right) out += text(right.s, { x: CX + objW / 2 + GAP, y, vcenter: true, fs: 80, t,
    inAt: right.at, outAt: right.out, colors: right.colors });
  return out;
}
// Colour a trailing substring blue (the word that matters).
const accent = (s, word, col = C.blue) => {
  const i = s.indexOf(word);
  return [...s].map((_, k) => (k >= i && k < i + word.length ? col : null));
};

// The terminal card: the hero object. Grey card, mono lines.
function termCard(cx, cy, w, h) {
  return rect(cx - w / 2, cy - h / 2, w, h, { r: 28, fill: C.card, stroke: C.quiet1, sw: 2 });
}
const mono = (s, x, y, t, o = {}) => text(s, { x, y, fs: o.fs || 26, font: "mono", t, fill: o.fill || C.ink, ...o });

// ---------------------------------------------------------------- shots
const S = [];
const shot = (dur, draw, o = {}) => S.push({ dur, draw, ...o });

// S1 — Uptime [status card] you can prove
const T_SMALL = { w: 214, h: 104 };
shot(4.5, (t, b) => {
  let o = "";
  const card = termCard(CX, CY, T_SMALL.w, T_SMALL.h) +
    text("[UP]", { x: CX, y: CY, vcenter: true, anchor: "middle", fs: 34, font: "mono", t, inAt: b + 2.4, stagger: 0.03 });
  o += appear(card, CX, CY, t, b + 0.25);
  o += sides(t, T_SMALL.w,
    { s: "Uptime", at: b + 0.7 },
    { s: "you can prove", at: b + 1.4, colors: accent("you can prove", "prove") });
  return o;
}, { push: 0.006 });

// S2 — Schedule [the website's new-job card] a check
// A form card, not a shell: the job is set up on the website.
const T_JOB = { w: 660, h: 330 };
const JOB_LINES = [
  { k: "CHECK", s: "api.example.com/health" },
  { k: "EVERY", s: "1 h" },
  { k: "POOL", s: "10 GEN" },
];
function jobCard(t, b, { typed = true, w = T_JOB.w, h = T_JOB.h, sched = true } = {}) {
  let o = termCard(CX, CY, w, h);
  const x0 = CX - w / 2 + 44, y0 = CY - h / 2 + 58, vx = x0 + 150;
  o += text("NEW JOB", { x: x0, y: y0, fs: 18, font: "mono", fill: C.label, t: 1e9 });
  const at = [b + 1.5, b + 2.5, b + 3.1];
  JOB_LINES.forEach((L, i) => {
    const y = y0 + 64 + i * 52;
    o += text(L.k, { x: x0, y, fs: 20, font: "mono", fill: C.label, t: 1e9 });
    o += `<line x1="${vx}" y1="${y + 14}" x2="${CX + w / 2 - 44}" y2="${y + 14}" stroke="${C.quiet2}" stroke-width="1.5"/>`;
    o += mono(L.s, vx, y, typed ? t : 1e9, {
      type: typed ? { at: at[i], cps: 30 } : undefined, caretUntil: i < 2 ? at[i + 1] : b + 4.2, caretW: 0.08,
    });
  });
  if (sched) o += text("[SCHEDULED]", { x: x0, y: y0 + 64 + 3 * 52 + 22, fs: 26, font: "mono", t: typed ? t : 1e9, inAt: typed ? b + 4.4 : undefined });
  return o;
}
shot(6.5, (t, b) => {
  const k = prog(t, b + 0.15, 1.2);
  const w = lerp(T_SMALL.w, T_JOB.w, k), h = lerp(T_SMALL.h, T_JOB.h, k);
  let o = "";
  if (k < 1) {
    o += termCard(CX, CY, w, h);
    if (k < 0.02) o += text("[UP]", { x: CX, y: CY, vcenter: true, anchor: "middle", fs: 34, font: "mono", t: 1e9 });
  } else o += jobCard(t, b);
  o += sides(t, T_JOB.w, { s: "Schedule", at: b + 0.5 }, { s: "a check", at: b + 1.1 });
  return o;
});

// S3 — any check or on-chain action: pills around the card (side facts)
const KINDS = [
  { s: "CHECK A URL", i: "globe", st: "web", side: -1 },
  { s: "CHECK AN API", i: "server", st: "web", side: -1 },
  { s: "ASK AN LLM", i: "cube", st: "web", side: -1 },
  { s: "CALL AN INTELLIGENT CONTRACT", i: "code", st: "ic", side: 1 },
  { s: "DEPLOY AN INTELLIGENT CONTRACT", i: "rocket", st: "ic", side: 1 },
];
const KFS = 19;
const KW = Math.max(...KINDS.map((k) => pillWidth(k.s, { fs: KFS, iconName: k.i })));
shot(5.0, (t, b) => {
  let o = jobCard(t, b, { typed: false });
  const colX = (side) => CX + side * (T_JOB.w / 2 + 36 + KW / 2);
  const left = KINDS.filter((k) => k.side < 0), right = KINDS.filter((k) => k.side > 0);
  const place = (arr, side) => arr.map((k, i) => ({ ...k, x: colX(side), y: CY + (i - (arr.length - 1) / 2) * 92 }));
  const all = [...place(left, -1), ...place(right, 1)];
  all.forEach((k, i) => {
    o += appear(pill(k.s, k.x, k.y, { w: KW, style: k.st, iconName: k.i, fs: KFS }), k.x, k.y, t, b + 0.4 + i * 0.6, { from: 0.9, d: 0.45 });
  });
  return o;
});

// S4 — Lock GEN [pool card + coins] pay per run
const POOL = { w: 400, h: 210, cy: CY - 20 };
const CURVES = [-1, -0.5, 0, 0.5, 1].map((s) => {
  const p0 = [CX + s * 60, POOL.cy + 40];
  return [p0, [CX + s * 60, POOL.cy + 260], [CX + s * 300, POOL.cy + 300], [CX + s * 420, H + 80]];
});
function poolCard(t, label = "[LOCKED]") {
  const x = CX - POOL.w / 2, y = POOL.cy - POOL.h / 2;
  return rect(x, y, POOL.w, POOL.h, { r: 28, fill: C.card, stroke: C.quiet1 }) +
    text("POOL", { x: CX, y: y + 52, fs: 20, font: "mono", anchor: "middle", fill: C.label, t: 1e9 }) +
    text("10 GEN", { x: CX, y: POOL.cy + 18, fs: 56, font: "mono", anchor: "middle", t: 1e9 }) +
    text(label, { x: CX, y: y + POOL.h - 36, fs: 20, font: "mono", anchor: "middle", fill: C.label, t: 1e9 });
}
shot(6.5, (t, b) => {
  let o = "";
  const start = b + 1.4, period = 1.0, travel = 2.6;
  // curves + coins behind the card: the stream keeps going to the cut
  CURVES.forEach((c, j) => {
    const lineAt = start - 0.2 + j * 0.08;
    if (t >= lineAt) {
      const k = prog(t, lineAt, 0.8), N = 40;
      const pts = [];
      for (let i = 0; i <= N * k; i++) pts.push(bez3(...c, i / N));
      o += `<polyline points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${C.label}" stroke-width="2"/>`;
    }
    for (let n = 0; n < 12; n++) {
      const t0 = start + n * period + j * 0.21;
      if (n % 3 === 0) cue("fill", t0);
      const u = (t - t0) / travel;
      if (u < 0 || u > 1) continue;
      const [x, y] = bez3(...c, u * u * 0.4 + u * 0.6);
      o += coin(x, y, 22);
    }
  });
  o += appear(poolCard(t), CX, POOL.cy, t, b + 0.02);
  // notification badge on the card's corner
  const pw = pillWidth("WITHDRAW ANYTIME", { fs: 20, iconName: "unlock" });
  const px = CX + POOL.w / 2 - 30, py = POOL.cy - POOL.h / 2 - 8;
  o += appear(pill("WITHDRAW ANYTIME", px, py, { fs: 20, iconName: "unlock", h: 56 }), px, py, t, b + 3.6, { from: 0.9, d: 0.45 });
  o += sides(t, POOL.w, { s: "Lock GEN", at: b + 0.6 }, { s: "pay per run", at: b + 1.3 }, { y: POOL.cy });
  return o;
});

// S5 — GenLayer's jury [jury box] decides
// One abstract beat: the jury re-runs the check and reaches one decision. No seat
// counts, no per-seat results, no unanimity: one blue outline, one result.
const JY = CY - 30;
shot(6.5, (t, b) => {
  let o = appear(juryBox(CX, JY), CX, JY, t, b + 0.05);
  // the job feeds the jury
  const jp = "API.EXAMPLE.COM/HEALTH";
  const jy = JY - JURY.h / 2 - 84;
  o += appear(pill(jp, CX, jy, { fs: 18, iconName: "globe", h: 52, style: "note" }), CX, jy, t, b + 0.5, { d: 0.45, from: 0.9 });
  const oa = b + 2.6;
  cue("agree", oa);
  if (t >= oa) o += outline(CX, JY, JURY.w, JURY.h, prog(t, oa, 0.9));
  o += text("[UP]", { x: CX, y: JY + JURY.h / 2 + 92, anchor: "middle", fs: 30, font: "mono", t, inAt: oa + 0.6, stagger: 0.03 });
  cue("data", oa + 0.6);
  o += sides(t, JURY.w, { s: "GenLayer’s jury", at: b + 0.7 },
    { s: "decides", at: b + 1.5, colors: accent("decides", "decides") }, { y: JY });
  return o;
}, { name: "jury" });

// S6 — Recorded [Intelligent Contract card] on-chain
const IC = { w: 580, h: 300 };
shot(6.0, (t, b) => {
  const x0 = CX - IC.w / 2 + 44, top = CY - IC.h / 2;
  let card = rect(CX - IC.w / 2, top, IC.w, IC.h, { r: 28, fill: "#FFFFFF", stroke: C.blue, sw: 3 }) +
    text("INTELLIGENT CONTRACT", { x: x0, y: top + 56, fs: 18, font: "mono", fill: C.label, t: 1e9 });
  let o = appear(card, CX, CY, t, b + 0.02);
  if (t >= b + 0.02) {
    o += mono("api.example.com/health", x0, top + 114, t, { type: { at: b + 1.0, cps: 34 }, caretUntil: b + 1.9 });
    o += text("[UP]  DECIDED BY THE JURY", { x: x0, y: top + 162, fs: 22, font: "mono", t, inAt: b + 1.9, stagger: 0.012 });
    // status: accepted, then final once the appeal window closes
    const sy = top + 236, stX = x0;
    o += text("[ACCEPTED]", { x: stX, y: sy, fs: 26, font: "mono", fill: C.ink, t, inAt: b + 2.6, outAt: b + 4.6, stagger: 0.02 });
    o += text("[FINAL]", { x: stX, y: sy, fs: 26, font: "mono", fill: C.blue, t, inAt: b + 5.35, stagger: 0.02 });
    const lx = stX + 210;
    if (t >= b + 3.2 && t < b + 4.9) {
      o += dots(lx + 14, sy - 9, t, C.ink, 10, 2.8);
      o += text("APPEAL WINDOW", { x: lx + 40, y: sy - 1, fs: 18, font: "mono", fill: C.label, t, inAt: b + 3.2, outAt: b + 4.5, stagger: 0.012 });
    }
    cue("lock", b + 5.35);
  }
  o += sides(t, IC.w, { s: "Recorded", at: b + 0.6 }, { s: "on-chain", at: b + 1.2 });
  return o;
});

// S7 — When it breaks [red result + email pill] you get an email
const AL = { w: 480, h: 220 };
shot(5.5, (t, b) => {
  const x0 = CX - AL.w / 2 + 44, top = CY - AL.h / 2;
  let o = appear(termCard(CX, CY, AL.w, AL.h) +
    text("API.EXAMPLE.COM/HEALTH", { x: x0, y: top + 56, fs: 18, font: "mono", fill: C.label, t: 1e9 }), CX, CY, t, b + 0.02);
  if (t >= b + 0.02) {
    o += text("[DOWN]", { x: x0, y: top + 128, fs: 40, font: "mono", fill: C.red, t, inAt: b + 1.2, stagger: 0.03 });
    cue("fail", b + 1.2);
    o += text("DECIDED BY THE JURY", { x: x0, y: top + 178, fs: 20, font: "mono", fill: C.ink, t, inAt: b + 1.7, stagger: 0.012 });
  }
  const px = CX + AL.w / 2 - 40, py = top - 6;
  o += appear(pill("ALERT EMAILED", px, py, { fs: 20, iconName: "mail", h: 56 }), px, py, t, b + 2.5, { from: 0.9, d: 0.45, kind: "alert" });
  o += sides(t, AL.w, { s: "When it breaks", at: b + 0.5 }, { s: "you get an email", at: b + 2.9 });
  return o;
});

// S8 — A real job on Bradbury → the Heartbeat's tick 2, decided by the jury
const HB_S = { w: 460, h: 170 }, HB_L = { w: 860, h: 470, cy: CY - 30 };
const HB_ROWS = [
  ["DEPLOY A CANARY CONTRACT", "", "[CORRECT]"],
  ["WRITE TO HEARTBEAT CONTRACT", "", "[CORRECT]"],
  ["FETCH A PAGE", "", "[CORRECT]"],
  ["ASK: HITCHHIKER’S ANSWER?", "42", "[CORRECT]"],
  ["ASK: ASIMOV’S LAWS?", "3", "[CORRECT]"],
];
shot(9.5, (t, b) => {
  let o = "";
  const g0 = b + 3.0, k = prog(t, g0, 1.2);
  const w = lerp(HB_S.w, HB_L.w, k), h = lerp(HB_S.h, HB_L.h, k), cy = lerp(CY, HB_L.cy, k);
  o += appear(termCard(CX, cy, w, h), CX, CY, t, b + 0.02);
  if (t >= b + 0.02 && t < g0) {
    const x0 = CX - HB_S.w / 2 + 44, top = CY - HB_S.h / 2;
    o += text("LIVE JOB", { x: x0, y: top + 50, fs: 18, font: "mono", fill: C.label, t, inAt: b + 0.5, outAt: b + 2.5, stagger: 0.012 });
    o += text("BRADBURY HEARTBEAT", { x: x0, y: top + 100, fs: 30, font: "mono", t, inAt: b + 0.7, outAt: b + 2.6, stagger: 0.012 });
    o += icon("clock", x0, top + 120, 22, C.label, 2);
    o += text("EVERY HOUR", { x: x0 + 32, y: top + 139, fs: 18, font: "mono", fill: C.label, t, inAt: b + 0.9, outAt: b + 2.7, stagger: 0.012 });
  }
  o += sides(t, HB_S.w, { s: "A real job", at: b + 0.6, out: b + 2.3 }, { s: "on Bradbury", at: b + 1.2, out: b + 2.4 });
  if (k >= 1) {
    const L = CX - HB_L.w / 2, top = HB_L.cy - HB_L.h / 2, x0 = L + 48;
    const cols = [x0, L + 520, L + 640];
    o += text("BRADBURY HEARTBEAT · TICK 2", { x: x0, y: top + 56, fs: 18, font: "mono", fill: C.label, t, inAt: g0 + 1.3, stagger: 0.01 });
    ["STEP", "ANSWER", "GRADED"].forEach((s, i) =>
      (o += text(s, { x: cols[i], y: top + 112, fs: 16, font: "mono", fill: C.label, t, inAt: g0 + 1.5 + i * 0.08, stagger: 0.01 })));
    o += `<line x1="${x0}" y1="${top + 132}" x2="${L + HB_L.w - 48}" y2="${top + 132}" stroke="${C.quiet2}" stroke-width="1.5"/>`;
    HB_ROWS.forEach((r, i) => {
      const y = top + 186 + i * 58, at = g0 + 1.9 + i * 0.5;
      r.forEach((c, j) => {
        if (!c) return;
        o += text(c, { x: cols[j], y, fs: 22, font: "mono", fill: C.ink, t, inAt: at + j * 0.12, stagger: 0.01 });
      });
      cue("data", at);
    });
    // the jury's verdict on the whole tick: one blue outline round the graded column
    const oa = g0 + 4.6;
    cue("agree", oa);
    if (t >= oa) {
      const ww = 196, hh = 4 * 58 + 56, x = cols[2] - 24, y = top + 150;
      const per = 2 * (ww + hh), kk = prog(t, oa, 0.9);
      o += `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="22" fill="none" stroke="${C.blue}" stroke-width="3" stroke-dasharray="${(per * kk).toFixed(1)} ${per}"/>`;
    }
    const pj = "DECIDED BY THE JURY";
    const pw = pillWidth(pj, { fs: 20, iconName: "check" });
    const px = L + HB_L.w + 32 + pw / 2, py = top + 186 + 2 * 58 - 8;
    o += appear(pill(pj, px, py, { fs: 20, h: 56, iconName: "check" }), px, py, t, oa + 0.4, { from: 0.9, d: 0.45 });
    const cy2 = top + HB_L.h + 56;
    o += appear(pill("NET COST ≈ 0.0004 GEN PER RUN", CX, cy2, { fs: 20, h: 56 }), CX, cy2, t, g0 + 5.5, { from: 0.9, d: 0.45 });
  }
  return o;
});

// S9 — Built on [GenVM cube] GenLayer
shot(3.5, (t, b) => {
  return appear(solidCube(CX, CY, 104), CX, CY, t, b + 0.02, { kind: "logo" }) +
    sides(t, 190, { s: "Built on", at: b + 0.7 }, { s: "GenLayer", at: b + 1.2 });
});

// S10 — end card
const SCR = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function decode(str, x, y, t, at, o) {
  // each letter scrambles briefly, then settles, in reading order
  const chars = [...str];
  let s = "";
  const settle = chars.map((_, i) => at + 0.25 + i * 0.028);
  chars.forEach((ch, i) => {
    if (t < at + i * 0.028) { s += " "; return; }
    if (ch === " " || t >= settle[i]) s += ch;
    else s += SCR[(i * 7 + Math.floor(t * 30) * 13) % SCR.length];
  });
  cue("data", at);
  return text(s, { x, y, fs: o.fs, font: "mono", track: o.track ?? 0.08, anchor: "middle", fill: o.fill, t: 1e9, opacity: o.opacity });
}
// Keep the scrambled line centred on the final line's layout: same char count, mono, so widths match.
shot(5.5, (t, b) => {
  let o = `<rect x="-200" y="-200" width="${W + 400}" height="${H + 400}" fill="${C.endBg}"/>`;
  const rise = 40 * (1 - prog(t, b, 2.6));
  cue("logo", b);
  if (t >= b) o += text("Uptime", { x: CX, y: 500 + rise, fs: 230, anchor: "middle", fill: C.endInk, t: 1e9 });
  o += decode("UPTIME YOU CAN PROVE", CX, 620, t, b + 1.0, { fs: 32, fill: C.endInk, opacity: 0.5 });
  o += decode("UPTIME.GENLAYER.FOUNDATION", CX, 668, t, b + 1.6, { fs: 32, fill: C.endInk, opacity: 0.5 });
  o += decode("NOT AUDITED — TESTNET ONLY · GENLAYER TESTNET BRADBURY", CX, 940, t, b + 2.4, { fs: 20, track: 0.04, fill: C.endInk, opacity: 0.5 });
  return o;
}, { dark: true });

// ---------------------------------------------------------------- timeline
let acc = 0;
for (const s of S) { s.t0 = acc; acc += s.dur; s.t1 = acc; }
export const DURATION = acc;
export const SHOTS = S;

const HALF = 0.4;      // each side of the speed ramp (s)
const MOVE = 56;       // total match-cut travel (px); ~25-30 px each side
export function frameSVG(t, { square = false } = {}) {
  const i = Math.min(S.length - 1, S.findIndex((s) => t < s.t1) === -1 ? S.length - 1 : S.findIndex((s) => t < s.t1));
  const s = S[i];
  const lt = t - s.t0;
  // match cut: one ease-in-out ramp spans the cut, peak speed on the cut
  let dx = 0;
  const span = 2 * HALF;
  if (i < S.length - 1 && t > s.t1 - HALF * 2 * CUT_U) {
    const u = (t - (s.t1 - span * CUT_U)) / span;
    dx = -MOVE * ease(u);
  }
  if (i > 0 && t < s.t0 + span * (1 - CUT_U)) {
    const u = (t - (s.t0 - span * CUT_U)) / span;
    dx = MOVE * (1 - ease(u));
  }
  const sc = 1 + (s.push ?? 0.01) * lt; // the slow push, restarted on every cut
  const body = s.draw(t, s.t0);
  const cam = `translate(${dx.toFixed(2)},0) translate(${CX},${CY}) scale(${sc.toFixed(5)}) translate(${-CX},${-CY})`;
  const bg = s.dark ? C.endBg : C.bg;
  if (square) {
    const k = 1080 / W, oy = (1080 / k - H) / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="${bg}"/><g transform="scale(${k}) translate(0,${oy})"><g transform="${cam}">${body}</g></g></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/><g transform="${cam}">${body}</g></svg>`;
}
export function collectCues(cues) {
  for (const s of S) {
    const n0 = cues.length;
    for (let t = s.t0; t < s.t1; t += 0.25) s.draw(t, s.t0);
    s.draw(s.t1 - 0.001, s.t0);
    // drop events that belong to time before this shot (persisting elements)
    const mine = cues.splice(n0).filter((c) => c.t >= s.t0 - 0.01 && c.t < s.t1);
    cues.push(...mine);
  }
  for (let i = 1; i < S.length; i++) cue("whoosh", S[i].t0);
  cues.sort((a, b) => a.t - b.t);
  return cues;
}
