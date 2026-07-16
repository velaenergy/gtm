import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const contentScript = await readFile(new URL("../content-script.js", import.meta.url), "utf8");
const dashboardHtml = await readFile(new URL("../dashboard.html", import.meta.url), "utf8");
const dashboardJs = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
const dashboardCss = await readFile(new URL("../dashboard.css", import.meta.url), "utf8");
const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");
const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");

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

test("dashboard always identifies the active workspace user separately from the Gmail sender", () => {
  assert.match(dashboardHtml, /id="currentUserBadge"[\s\S]*Signed in as[\s\S]*id="currentUserEmail"/);
  assert.match(dashboardCss, /\.current-user-badge \{[\s\S]*position:fixed; right:18px; bottom:16px/);
  assert.match(dashboardJs, /const membership = response\?\.data\?\.membership \|\| null;[\s\S]*state\.currentTeamUser = signedIn/);
  assert.match(dashboardJs, /function renderCurrentUser\(\)/);
  assert.match(dashboardJs, /currentUserBadge\.addEventListener\("click", openAdvancedSettings\)/);
  assert.doesNotMatch(dashboardJs, /state\.currentTeamUser = !isExtension[\s\S]*: null/);
  assert.match(dashboardJs, /const reportableEvents = mailboxSentEvents\(\{ deliveryLog \}\)/);
});

test("V49 keeps the canonical first-touch subject read-only through review and delivery", () => {
  assert.match(optionsHtml, /id="templateSubject"[^>]*value="Quick intro \+ would love to pick your brain"[^>]*readonly/);
  assert.match(popupHtml, /id="subjectInput"[^>]*value="Quick intro \+ would love to pick your brain"[^>]*readonly/);
  assert.match(dashboardHtml, /id="drawerSubject"[^>]*value="Quick intro \+ would love to pick your brain"[^>]*readonly/);
  assert.match(dashboardJs, /delivery: \{[^}]*subject: OUTREACH_SUBJECT/);
});

test("draft review keeps the prospect profile focused and its controls legible", () => {
  assert.doesNotMatch(dashboardHtml, /Human approval required/);
  assert.match(dashboardHtml, /id="drawerProfileSection"[\s\S]*Work history/);
  assert.match(dashboardHtml, /id="previousReviewButton"[\s\S]*Previous prospect/);
  assert.match(dashboardHtml, /id="nextReviewButton"[\s\S]*Next prospect/);
  assert.match(dashboardCss, /\.drawer-section\.drawer-collapsible \{ padding:0; overflow:hidden; \}/);
  assert.match(dashboardCss, /\.drawer-content > \* \{ flex:none; \}/);
  assert.match(dashboardCss, /\.drawer-collapsible > summary \{[^}]*color:var\(--ink\)/);
  assert.match(dashboardJs, /drawerEmailSection\.hidden = true/);
});

test("[V51] approving one draft advances the open review drawer", () => {
  assert.match(dashboardJs, /function openNextApprovalDraft\(currentId\)/);
  assert.match(dashboardJs, /const approved = await approveProspects\(\[currentId\]\);[\s\S]*if \(!approved\) return;[\s\S]*openNextApprovalDraft\(currentId\)/);
  const approvalHandler = dashboardJs.match(/approveDraftButton\.addEventListener\("click", async \(\) => \{([\s\S]*?)\n  \}\);/)?.[1] || "";
  assert.doesNotMatch(approvalHandler, /closeReviewDrawer\(\)/);
});

test("dashboard element bindings stay in sync with the rendered markup", () => {
  const elementBlock = dashboardJs.match(/const elements = Object\.fromEntries\(\[([\s\S]*?)\]\.map/)?.[1] || "";
  const boundIds = [...elementBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(boundIds.length > 0, "dashboard element bindings should be discoverable");
  for (const id of boundIds) {
    assert.match(dashboardHtml, new RegExp(`id=["']${id}["']`), `#${id} must exist before dashboard.js binds it`);
  }
});

test("analytics is a focused delivery control room backed by Gmail health signals", () => {
  const analyticsPanel = dashboardHtml.match(/<section id="analyticsPanel"[\s\S]*?<section id="overviewPanel"/)?.[0] || "";

  assert.match(dashboardJs, /analytics: \{ eyebrow: "Analytics", title: "Delivery health"/);
  assert.doesNotMatch(analyticsPanel, /Delivery health/, "the page header owns the title; the panel must not repeat it");
  assert.match(analyticsPanel, /Spam \/ policy blocks/);
  assert.match(analyticsPanel, /Who is sending what/);
  assert.match(analyticsPanel, /id="analyticsInboxSyncButton"/);
  assert.doesNotMatch(analyticsPanel, /Team leaderboard|Sequence health|dailySendChart/);
  assert.match(dashboardJs, /record\.bounceReason === "policy_blocked"/);
  assert.match(dashboardJs, /record\.bounceType === "hard"/);
  assert.match(dashboardJs, /record\.bounceType === "soft"/);
});
