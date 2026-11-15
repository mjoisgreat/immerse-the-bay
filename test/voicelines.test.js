import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ALL_LINES } from "../src/lines.js";

test("every fixed Bonnie line has a recorded audio file (run `npm run voice-lines` after changing src/lines.js)", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../src/voiceLines.json", import.meta.url), "utf8"));
  for (const line of ALL_LINES) {
    assert.ok(manifest[line], `no recording listed for: ${line}`);
    assert.ok(fs.existsSync(new URL(`../public/voice/bonnie/${manifest[line]}`, import.meta.url)), `file missing for: ${line}`);
  }
});
