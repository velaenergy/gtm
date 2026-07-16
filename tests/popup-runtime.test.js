import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popup = await readFile(new URL("../popup.js", import.meta.url), "utf8");

test("V38 gates extension-only popup work through the preview runtime state", () => {
  assert.doesNotMatch(popup, /\bisExtension\b/, "popup runtime must not reference an undeclared extension flag");
  assert.match(
    popup,
    /async function confirmDuplicateRecipients\(delivery = \{\}\) \{\s*if \(state\.isPreview\) return \{ proceed: true, override: false \};/,
  );
});

test("[V50] sender quota hydrates the same shared Gmail and team records as Dashboard", () => {
  assert.match(popup, /type: "VELA_GTM_TEAM_ACTIVITY_READ"/);
  assert.match(popup, /gmailMessagesAsDeliveryRecords\(/);
  assert.match(popup, /mergeDeliveryRecords\(/);
});
