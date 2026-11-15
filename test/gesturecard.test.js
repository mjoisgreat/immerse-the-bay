import { test } from "node:test";
import assert from "node:assert/strict";
import { gestureRows, buttonRows } from "../src/gesturecard.js";

test("the card teaches a gesture for every hand action", () => {
  const rows = gestureRows("Bonnie");
  const actions = rows.map((r) => r[1]).join(" | ");
  for (const a of ["Talk", "Open a window", "Move a window", "Resize a window", "Pick up", "Step inside", "Step back out", "Close a window", "Call Bonnie", "menu"]) {
    assert.ok(actions.includes(a), `missing: ${a}`);
  }
  for (const [icon, action, how] of rows) assert.ok(icon && action && how.length > 8);
});
test("the companion's name is used", () => {
  assert.ok(gestureRows("Pip").some((r) => r[1] === "Call Pip"));
});
test("the cheat sheet covers the controller buttons and the desktop keys", () => {
  const rows = buttonRows();
  const actions = rows.map((r) => r[1]).join(" | ");
  for (const a of ["Trigger", "A / X", "B / Y", "Grip", "Thumbstick", "Desktop"]) assert.ok(actions.includes(a), `missing: ${a}`);
  for (const [icon, action, how] of rows) assert.ok(icon && action && how.length > 8);
});
