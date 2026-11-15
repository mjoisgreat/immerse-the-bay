// Records Bonnie's fixed lines (src/lines.js) as mp3 files in public/voice/bonnie/ and lists them in
// src/voiceLines.json, so the page plays them at once instead of asking the speech service each time.
//   npm run voice-lines          (needs OPENAI_API_KEY; only records lines that have no file yet)
//   npm run voice-lines -- --all (re-records every line, e.g. after changing her voice)
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import { ALL_LINES, BONNIE_VOICE } from "../src/lines.js";
import { speak } from "../server/services.js";

const dir = "public/voice/bonnie";
fs.mkdirSync(dir, { recursive: true });
const all = process.argv.includes("--all");
const manifest = {};
for (const line of ALL_LINES) {
  const file = `${crypto.createHash("sha1").update(line).digest("hex").slice(0, 10)}.mp3`;
  manifest[line] = file;
  if (!all && fs.existsSync(`${dir}/${file}`)) continue;
  console.log("recording:", line);
  fs.writeFileSync(`${dir}/${file}`, await speak(line, "Bonnie", BONNIE_VOICE));
}
// Files of lines that no longer exist.
const keep = new Set(Object.values(manifest));
for (const f of fs.readdirSync(dir)) if (!keep.has(f)) fs.rmSync(`${dir}/${f}`);
fs.writeFileSync("src/voiceLines.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${ALL_LINES.length} lines ready.`);
