import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const contentScript = await readFile(new URL("../content-script.js", import.meta.url), "utf8");

test("V24 configures the tab side panel before exposing its LinkedIn launcher", () => {
  const configureRequest = contentScript.indexOf('type: "VELA_GTM_CONFIGURE_SIDE_PANEL"');
  const appendLauncher = contentScript.indexOf("document.documentElement.append(host)");

  assert.notEqual(configureRequest, -1, "content script must request tab-specific panel setup");
  assert.notEqual(appendLauncher, -1, "content script must append the launcher");
  assert.ok(configureRequest < appendLauncher, "panel setup must finish before the launcher becomes clickable");
  assert.match(background, /sidePanel\.setOptions\(\{\s*tabId,\s*path:\s*"popup\.html",\s*enabled:\s*true\s*\}\)/);
  assert.match(background, /sidePanel\.open\(\{\s*tabId\s*\}\)/);
});
