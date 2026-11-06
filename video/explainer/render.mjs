// Render the film frame by frame: SVG (glyph outlines) -> resvg -> raw RGBA -> ffmpeg (H.264).
//   node render.mjs stills 1.5,9,15          -> ../out/stills/still_<t>.png
//   node render.mjs video [--square]         -> ../out/uptime-explainer[-square].mp4 (+ sound)
//   node render.mjs cues                      -> ../out/cues.json
import { Resvg } from "@resvg/resvg-js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameSVG, DURATION, collectCues } from "./film.mjs";
import { cues, FPS } from "./lib.mjs";
import { synth } from "./sfx.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../out");
fs.mkdirSync(OUT, { recursive: true });
const [mode = "video", ...rest] = process.argv.slice(2);
const square = rest.includes("--square");

const raster = (svg) => new Resvg(svg, { font: { loadSystemFonts: false } }).render();

if (mode === "stills") {
  const dir = path.join(OUT, "stills");
  fs.mkdirSync(dir, { recursive: true });
  for (const t of (rest.find((a) => !a.startsWith("--")) || "1").split(",").map(Number)) {
    const png = raster(frameSVG(t, { square })).asPng();
    const f = path.join(dir, `still_${t.toFixed(2)}${square ? "_sq" : ""}.png`);
    fs.writeFileSync(f, png);
    console.log(f);
  }
  process.exit(0);
}

collectCues(cues);
fs.writeFileSync(path.join(OUT, "cues.json"), JSON.stringify(cues, null, 1));
const wav = path.join(OUT, "sfx.wav");
synth(cues, DURATION, wav);
if (mode === "cues") { console.log(`${cues.length} cues, ${DURATION}s`); process.exit(0); }

const [w, h] = square ? [1080, 1080] : [1920, 1080];
const file = path.join(OUT, `uptime-explainer${square ? "-square" : ""}.mp4`);
const ff = spawn("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-r", String(FPS), "-i", "-",
  "-i", wav,
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high",
  "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", file,
], { stdio: ["pipe", "inherit", "inherit"] });

const N = Math.round(DURATION * FPS);
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  const px = raster(frameSVG(f / FPS, { square })).pixels;
  if (!ff.stdin.write(px)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % 150 === 0) console.log(`frame ${f}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
console.log(file);
