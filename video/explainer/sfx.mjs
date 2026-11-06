// Turn drawing cues into a synthesized effects track (no samples, nothing licensed).
// One sound per kind of motion; words rotate through a set of four beeps.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const SR = 48000;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

const tone = (buf, at, f, dur, amp, { attack = 0.003, decay = dur / 4, f2 } = {}) => {
  const i0 = Math.floor(at * SR), n = Math.floor(dur * SR);
  let ph = 0;
  for (let i = 0; i < n && i0 + i < buf.length; i++) {
    const t = i / SR;
    const fr = f2 ? f + (f2 - f) * (t / dur) : f;
    ph += (2 * Math.PI * fr) / SR;
    const env = Math.min(1, t / attack) * Math.exp(-t / decay) * (1 - t / dur);
    if (i0 + i >= 0) buf[i0 + i] += Math.sin(ph) * amp * env;
  }
};
const noise = (buf, at, dur, amp, { attack = 0.001, decay = 0.002, lp = 0.5, seed = 1, shape } = {}) => {
  const i0 = Math.floor(at * SR), n = Math.floor(dur * SR), r = rng(seed);
  let y = 0;
  for (let i = 0; i < n && i0 + i < buf.length; i++) {
    const t = i / SR;
    y += lp * (r() - y);
    const env = shape ? shape(t / dur) : Math.min(1, t / attack) * Math.exp(-t / decay);
    if (i0 + i >= 0) buf[i0 + i] += y * amp * env;
  }
};

const WORD = [1320, 1480, 1660, 1760];
const SOUNDS = {
  word0: (b, t) => tone(b, t, WORD[0], 0.06, 0.05, { decay: 0.015 }),
  word1: (b, t) => tone(b, t, WORD[1], 0.06, 0.05, { decay: 0.015 }),
  word2: (b, t) => tone(b, t, WORD[2], 0.06, 0.05, { decay: 0.015 }),
  word3: (b, t) => tone(b, t, WORD[3], 0.06, 0.05, { decay: 0.015 }),
  type: (b, t, k) => noise(b, t, 0.02, 0.22, { decay: 0.0025, lp: 0.6, seed: k }),
  type2: (b, t, k) => noise(b, t, 0.018, 0.16, { decay: 0.002, lp: 0.45, seed: k }),
  pop: (b, t) => tone(b, t, 520, 0.09, 0.16, { f2: 860, decay: 0.03 }),
  data: (b, t) => { tone(b, t, 2100, 0.03, 0.05, { decay: 0.008 }); tone(b, t + 0.045, 2500, 0.03, 0.04, { decay: 0.008 }); },
  fill: (b, t) => tone(b, t, 980, 0.05, 0.04, { decay: 0.012 }),
  lock: (b, t) => { tone(b, t, 180, 0.16, 0.25, { decay: 0.04 }); noise(b, t, 0.03, 0.12, { decay: 0.004, lp: 0.3, seed: 9 }); },
  agree: (b, t) => [523.25, 659.25, 783.99].forEach((f, i) => tone(b, t + i * 0.04, f, 0.9, 0.06, { attack: 0.02, decay: 0.35 })),
  fail: (b, t) => { tone(b, t, 392, 0.18, 0.09, { decay: 0.08 }); tone(b, t + 0.16, 311, 0.26, 0.09, { decay: 0.1 }); },
  alert: (b, t) => { tone(b, t, 880, 0.22, 0.08, { decay: 0.09 }); tone(b, t + 0.15, 1174.66, 0.35, 0.08, { decay: 0.14 }); },
  whoosh: (b, t) => noise(b, t - 0.22, 0.45, 0.14, { lp: 0.08, seed: 5, shape: (u) => Math.sin(Math.PI * u) ** 2 }),
  logo: (b, t) => [261.63, 392, 523.25, 783.99].forEach((f, i) => tone(b, t + i * 0.06, f, 2.4, 0.06, { attack: 0.05, decay: 0.9 })),
};

export function synth(cues, duration, out) {
  const buf = new Float32Array(Math.ceil((duration + 0.5) * SR));
  let w = 0; // every word gets one beep, the set of four in rotation
  cues.forEach((c, k) => {
    const kind = c.kind.startsWith("word") ? `word${w++ % 4}` : c.kind;
    if (SOUNDS[kind]) SOUNDS[kind](buf, c.t, k + 1);
  });
  const pcm = Buffer.alloc(44 + buf.length * 2);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + buf.length * 2, 4); pcm.write("WAVE", 8);
  pcm.write("fmt ", 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36); pcm.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(Math.tanh(buf[i]) * 32767))), 44 + i * 2);
  const raw = out.replace(/\.wav$/, ".raw.wav");
  fs.writeFileSync(raw, pcm);
  // No voice or music, so the effects carry the mix: normalise to a quiet -20 LUFS, -1 dBTP.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-af", "loudnorm=I=-20:TP=-1:LRA=11", "-ar", "48000", "-ac", "2", out]);
  fs.unlinkSync(raw);
}
