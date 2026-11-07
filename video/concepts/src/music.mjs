// Round 1 music sketches for the concept board. One ElevenLabs Music call per concept on fal.
// Run: FAL_KEY="$(cat ~/.config/fal/key)" node src/music.mjs [id ...]
// $0.60 per output minute, rounded up: every sketch here is <= 30 s, so $0.60 each.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "music");
const NEG = ["vocals", "singing", "choir", "ambient pad wash", "cinematic trailer", "corporate", "lo-fi", "slow", "fade out"];
const sec = (name, ms, pos, neg = []) => ({ section_name: name, duration_ms: ms, positive_local_styles: pos, negative_local_styles: neg, lines: [] });
export const PLANS = {
  "a-status-update": {
    styles: ["instrumental", "tight live funk band", "112 BPM", "E minor", "playful, comedic, high energy", "crisp dry drums, clavinet, punchy bass, horn section"],
    sections: [
      sec("Pager", 3000, ["solo closed hi-hat and rimshot in a nervous 16th pattern", "dry and close"], ["bass", "horns"]),
      sec("Panic groove", 8000, ["full funk groove kicks in on the downbeat", "busy syncopated bass", "choppy clavinet", "frantic but funny"]),
      sec("Freeze", 3000, ["band stops dead", "one single snare hit then silence"], ["groove"]),
      sec("Verdict", 9000, ["huge horn stab on the downbeat", "groove returns bigger and confident", "brass riff", "triumphant"]),
      sec("Tag", 7000, ["horn riff call and response", "drum fill", "ends on one tight band hit, button ending"], ["long tail"]),
    ],
  },
  "b-up-up-up": {
    styles: ["instrumental", "French touch filter house", "128 BPM", "A minor", "relentless energy, punchy", "four on the floor kick, side-chained synth chords, chopped stabs"],
    sections: [
      sec("Up up up", 3750, ["kick on every beat with a sharp synth stab on each beat", "dry, punchy, nothing else"], ["pads"]),
      sec("Down", 3750, ["sudden low-pass filter, kick drops out", "dark bass note", "snare roll building tension"]),
      sec("Drop", 7500, ["full drop on the downbeat", "big filtered disco chords pumping", "driving bassline", "euphoric"]),
      sec("Stab", 5000, ["two bars of the groove then one final stab and hard stop"], ["long tail"]),
    ],
  },
  "c-receipt": {
    styles: ["instrumental", "playful minimal electro", "120 BPM", "C major", "bright, mechanical, witty", "dot-matrix printer clicks as percussion", "analog synth bass and bright arpeggio"],
    sections: [
      sec("Printer", 6000, ["mechanical clicking and paper-feed rhythm forming a beat", "tiny blips"], ["bass"]),
      sec("Groove", 8000, ["bouncy synth bassline joins", "bright sequenced arpeggio", "kick and clap"]),
      sec("Red row", 4000, ["break: everything drops except one sharp alarm-like synth stab and the printer clicks"]),
      sec("Full", 8000, ["full groove returns brighter", "extra arpeggio layer", "confident and fun"]),
      sec("End", 4000, ["one final printer tear sound-like stab, clean button ending"], ["long tail"]),
    ],
  },
  "d-every-hour": {
    styles: ["instrumental", "driving organic electronica", "124 BPM", "D major", "propulsive, euphoric, documentary energy", "live breakbeat drums, warm synth chords, pulsing bass"],
    sections: [
      sec("Clock", 4000, ["ticking clock-like synth pulse on 8th notes", "tight and dry"], ["drums"]),
      sec("Build", 8000, ["kick enters, motorik bassline", "rising chord stabs", "momentum building"]),
      sec("Run", 12000, ["full breakbeat drums and big warm chords", "driving, euphoric, fast hi-hats"]),
      sec("Stop", 6000, ["groove continues two bars then hard stop on one chord"], ["long tail"]),
    ],
  },
  "e-the-ring": {
    styles: ["instrumental", "afro house", "122 BPM", "F minor", "hypnotic, joyful, lively", "congas, shakers, deep warm bass, marimba hook"],
    sections: [
      sec("Pulse", 4000, ["congas and shaker groove only", "a heartbeat-like kick"], ["bass", "chords"]),
      sec("Gather", 6000, ["deep bass enters", "marimba hook circling", "building"]),
      sec("Ring", 7000, ["full groove on the downbeat", "bright plucked chords", "joyful and lively"]),
      sec("Seal", 3000, ["one big percussive hit and stop"], ["long tail"]),
    ],
  },
};
async function gen(id) {
  const p = PLANS[id];
  const input = { respect_sections_durations: true, composition_plan: { positive_global_styles: p.styles, negative_global_styles: NEG, sections: p.sections } };
  const res = await fetch("https://fal.run/fal-ai/elevenlabs/music", {
    method: "POST", headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${id}: ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  const url = body.audio?.url || body.audio_file?.url;
  const mp3 = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(path.join(OUT, `${id}.mp3`), mp3);
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ model: "fal-ai/elevenlabs/music", input, generated: new Date().toISOString() }, null, 2));
  console.log(id, "ok", mp3.length);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY not set");
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PLANS);
  const r = await Promise.allSettled(ids.map(gen));
  r.forEach((x) => x.status === "rejected" && console.error(String(x.reason)));
}
