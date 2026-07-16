import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const contentScript = await readFile(new URL("../content-script.js", import.meta.url), "utf8");
const dashboardHtml = await readFile(new URL("../dashboard.html", import.meta.url), "utf8");
const dashboardJs = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");

test("V24 configures the tab side panel before exposing its LinkedIn launcher", () => {
  const configureRequest = contentScript.indexOf('type: "VELA_GTM_CONFIGURE_SIDE_PANEL"');
  const appendLauncher = contentScript.indexOf("document.documentElement.append(host)");

  assert.notEqual(configureRequest, -1, "content script must request tab-specific panel setup");
  assert.notEqual(appendLauncher, -1, "content script must append the launcher");
  assert.ok(configureRequest < appendLauncher, "panel setup must finish before the launcher becomes clickable");
  assert.match(background, /sidePanel\.setOptions\(\{\s*tabId,\s*path:\s*"popup\.html",\s*enabled:\s*true\s*\}\)/);
  assert.match(background, /sidePanel\.open\(\{\s*tabId\s*\}\)/);
});

test("V31 performs service-worker startup work only inside Chrome lifecycle events", () => {
  const settingsBoundary = background.indexOf("async function settings");
  const topLevelStartup = background.slice(0, settingsBoundary);
  const installedListener = background.match(/chrome\.runtime\.onInstalled\.addListener\(\(\) => \{([\s\S]*?)\n\}\);/)?.[1] || "";
  const startupListener = background.match(/chrome\.runtime\.onStartup\.addListener\(\(\) => \{([\s\S]*?)\n\}\);/)?.[1] || "";

  assert.doesNotMatch(topLevelStartup, /\nenablePersistentSidePanel\(\)\.catch/, "top-level side-panel setup can outlive its service-worker context");
  assert.doesNotMatch(topLevelStartup, /\nmaintainWorkspaceBackup\(\)\.catch/, "top-level storage work can outlive its service-worker context");
  assert.match(installedListener, /enablePersistentSidePanel\(\)\.catch/, "installation must configure toolbar side-panel behavior");
  assert.doesNotMatch(startupListener, /enablePersistentSidePanel\(\)\.catch/, "persisted panel behavior must not be reset on every browser startup");
});

test("uses options.html as the single settings surface", () => {
  assert.doesNotMatch(dashboardHtml, /id="settingsPanel"|data-view="settings"/);
  assert.match(dashboardJs, /settingsButton\.addEventListener\("click", openAdvancedSettings\)/);
  assert.match(optionsHtml, /data-settings-target="teamWorkspaceHeading">Workspace/);
  assert.match(optionsHtml, /id="teamMembersBody"/);
  assert.match(optionsHtml, /id="connectGmailButton"[^>]*>Add Gmail account/);
});
