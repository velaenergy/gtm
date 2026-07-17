import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const contentScript = await readFile(new URL("../content-script.js", import.meta.url), "utf8");
const dashboardHtml = await readFile(new URL("../dashboard.html", import.meta.url), "utf8");
const dashboardJs = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
const dashboardCss = await readFile(new URL("../dashboard.css", import.meta.url), "utf8");
const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");
const optionsJs = await readFile(new URL("../options.js", import.meta.url), "utf8");
const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const popupJs = await readFile(new URL("../popup.js", import.meta.url), "utf8");

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

test("[V55] the manual LinkedIn sidebar uses ContactOut-first enrichment", () => {
  assert.match(popupHtml, /id="findEmailButton"/);
  assert.match(popupJs, /configuredManualEnrichmentProviders\(state\.settings\)/);
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

test("[V21][V29] adding a Gmail sender preserves the active workspace identity", () => {
  const handler = optionsJs.match(/connectGmailButton\.addEventListener\("click", async \(\) => \{([\s\S]*?)\n\}\);/)?.[1] || "";

  assert.match(handler, /type: "VELA_GTM_TEAM_AUTH_STATUS"/, "sender connection must verify the existing workspace session");
  assert.match(handler, /type: "VELA_GTM_TEAM_GMAIL_SYNC"/, "sender connection must register the chosen mailbox");
  assert.doesNotMatch(handler, /type: "VELA_GTM_TEAM_SIGN_IN"/, "a Gmail sender must not replace the workspace login");
  assert.doesNotMatch(handler, /includeIdToken:\s*true/, "sender-only OAuth must not request a workspace identity token");
});

test("[V21][V30] removing a Gmail sender persists before deleting the browser copy", () => {
  const handler = optionsJs.match(/gmailAccountsList\.addEventListener\("click", async \(event\) => \{([\s\S]*?)\n\}\);/)?.[1] || "";
  const sharedRemoval = handler.indexOf('type: "VELA_GTM_TEAM_GMAIL_REMOVE"');
  const localRemoval = handler.indexOf("persistGoogleAccounts(connectedGoogleAccounts.filter");

  assert.notEqual(sharedRemoval, -1, "sender removal must update the shared backend");
  assert.notEqual(localRemoval, -1, "sender removal must update the browser account set");
  assert.ok(sharedRemoval < localRemoval, "shared removal must succeed before the local sender disappears");
  assert.match(background, /message\.type === "VELA_GTM_TEAM_GMAIL_REMOVE"/);
});

test("V49 keeps the canonical first-touch subject read-only through review and delivery", () => {
  assert.match(optionsHtml, /id="templateSubject"[^>]*value="Quick intro \+ seeking advice"[^>]*readonly/);
  assert.match(popupHtml, /id="subjectInput"[^>]*value="Quick intro \+ seeking advice"[^>]*readonly/);
  assert.match(dashboardHtml, /id="drawerSubject"[^>]*value="Quick intro \+ seeking advice"[^>]*readonly/);
  assert.match(dashboardJs, /delivery: \{[^}]*subject: OUTREACH_SUBJECT/);
});

test("draft review keeps the prospect profile focused and its controls legible", () => {
  assert.doesNotMatch(dashboardHtml, /Human approval required/);
  assert.match(dashboardHtml, /id="drawerFitSection"[\s\S]*Vela's fit check[\s\S]*What Vela thinks/);
  assert.match(dashboardHtml, /id="drawerProfileSection"[\s\S]*Work history/);
  assert.match(dashboardHtml, /id="previousReviewButton"[\s\S]*Previous prospect/);
  assert.match(dashboardHtml, /id="nextReviewButton"[\s\S]*Next prospect/);
  assert.match(dashboardCss, /\.drawer-section\.drawer-collapsible \{ padding:0; overflow:hidden; \}/);
  assert.match(dashboardCss, /\.drawer-content > \* \{ flex:none; \}/);
  assert.match(dashboardCss, /\.drawer-collapsible > summary \{[^}]*color:var\(--ink\)/);
  assert.match(dashboardCss, /\.drawer-secondary-details \{[\s\S]*overflow-y:auto/);
  assert.match(dashboardJs, /const displayName = prospectDisplayName\(prospect\);[\s\S]*drawerName\.textContent = displayName/);
  assert.match(dashboardJs, /drawerEmailSection\.hidden = true/);
  assert.match(dashboardJs, /function renderDrawerFit\(prospect\)[\s\S]*targetFit\.reason[\s\S]*targetFit\.evidence/);
  assert.doesNotMatch(dashboardHtml, /<kbd>J<\/kbd> Next|<kbd>K<\/kbd> Skip|id="skipReviewButton"/);
  assert.doesNotMatch(dashboardJs, /event\.key\.toLowerCase\(\) === "j"\) \{ event\.preventDefault\(\); openNextRunProspect/);
});

test("approvals can approve every ready draft before opening the existing run confirmation", () => {
  assert.match(dashboardJs, /async function launchDraftQualifiedResearch\(\)[\s\S]*setView\("research"\)/);
  assert.match(dashboardJs, /pending\?\.plan[\s\S]*executeResearchPlan\(pending\.plan, pending\.brief\)/);
  assert.match(dashboardJs, /elements\.processButton\.textContent = state\.view === "review" && readyToApprove\.length \? "Run and approve all" : "Draft qualified"/);
  assert.match(dashboardJs, /async function runAndApproveAll\(\)[\s\S]*approveProspects\(readyIds\)[\s\S]*openBulkSend\(approvals\.map/);
  assert.match(dashboardJs, /state\.view === "review" \? runAndApproveAll\(\) : launchDraftQualifiedResearch\(\)/);
});

test("successful approval sends are persisted through the shared prospect boundary", () => {
  assert.match(dashboardJs, /state\.queue = markProspectsSent\(state\.queue, sentIds\)/);
  assert.match(dashboardJs, /persistQueue\(\{ waitForTeam: true, prospects: queueProspectsById\(sentIds\) \}\)/);
  assert.match(dashboardJs, /state\.view !== "review" && state\.attentionOnly/);
});

test("[V59] shared prospect refreshes never write the merged queue back to Supabase", () => {
  const refresh = dashboardJs.match(/async function refreshTeamProspects\([\s\S]*?\n}\n\nasync function refreshTeamWorkspace/)?.[0] || "";
  assert.match(refresh, /VELA_GTM_TEAM_PROSPECTS_READ/);
  assert.match(refresh, /storage\.set\(\{ \[QUEUE_STORAGE_KEY\]: state\.queue \}\)/);
  assert.doesNotMatch(refresh, /persistQueue|VELA_GTM_TEAM_PROSPECTS_SYNC/);
});

test("[V59] clear and review deletion wait for a verified shared delete", () => {
  assert.match(dashboardJs, /async function deleteQueueProspects\(prospects = \[\]\)[\s\S]*VELA_GTM_TEAM_PROSPECTS_DELETE[\s\S]*if \(!response\?\.ok\) throw[\s\S]*state\.queue = state\.queue\.filter/);
  assert.match(dashboardJs, /clearProspectsButton\.addEventListener\("click", async \(\) => \{[\s\S]*await deleteQueueProspects\(approvals\)/);
  assert.match(dashboardJs, /async function deleteCurrentReviewProspect\(\)[\s\S]*await deleteQueueProspects\(\[prospect\]\)/);
});

test("[V51] approving one draft advances the open review drawer", () => {
  assert.match(dashboardJs, /function openNextApprovalDraft\(currentId\)/);
  assert.match(dashboardJs, /const approved = await approveProspects\(\[currentId\]\);[\s\S]*if \(!approved\) return;[\s\S]*openNextApprovalDraft\(currentId\)/);
  const approvalHandler = dashboardJs.match(/approveDraftButton\.addEventListener\("click", async \(\) => \{([\s\S]*?)\n  \}\);/)?.[1] || "";
  assert.doesNotMatch(approvalHandler, /closeReviewDrawer\(\)/);
});

test("[V53] review shortcuts update pending progress and delete into the next draft", () => {
  assert.match(dashboardHtml, /<kbd>⌘<\/kbd><kbd>⌫<\/kbd> Delete/);
  assert.match(dashboardJs, /function drawerProspects\(\)[\s\S]*reviewDrawerDrafts\(complete, state\.activeProspectId\)/);
  assert.match(dashboardJs, /function openNextApprovalDraft\(currentId\)[\s\S]*pendingReviewDrafts\(visibleProspects\(\)\)/);
  assert.doesNotMatch(dashboardJs, /drawerPosition\.textContent[^\n]*remaining/);
  assert.match(dashboardJs, /async function deleteCurrentReviewProspect\(\)[\s\S]*nextReviewProspectId/);
  assert.match(dashboardJs, /\(event\.metaKey \|\| event\.ctrlKey\) && event\.key === "Backspace" && state\.activeProspectId/);
});

test("[V61] dashboard approval sends confirm duplicates and surface a specific failure", () => {
  const sendApproved = dashboardJs.match(/async function sendApproved\(ids = \[\]\) \{([\s\S]*?)\n}\n\nasync function launchDraftQualifiedResearch/)?.[1] || "";
  assert.match(dashboardJs, /async function confirmDashboardDuplicateRecipients\(people = \[\]\)[\s\S]*VELA_GTM_EMAIL_DUPLICATE_CHECK[\s\S]*globalThis\.confirm/);
  assert.match(sendApproved, /confirmDashboardDuplicateRecipients\(eligible\)/);
  assert.match(sendApproved, /duplicateOverride: duplicateDecision\.override/);
  assert.match(sendApproved, /approvalSendSummary\(sent, failures\)/);
  assert.doesNotMatch(sendApproved, /failures\.length \? `\$\{sent} sent · \$\{failures\.length} need attention`/);
});

test("dashboard element bindings stay in sync with the rendered markup", () => {
  const elementBlock = dashboardJs.match(/const elements = Object\.fromEntries\(\[([\s\S]*?)\]\.map/)?.[1] || "";
  const boundIds = [...elementBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(boundIds.length > 0, "dashboard element bindings should be discoverable");
  for (const id of boundIds) {
    assert.match(dashboardHtml, new RegExp(`id=["']${id}["']`), `#${id} must exist before dashboard.js binds it`);
  }
});

test("analytics is a connected-mailbox observer backed by canonical Gmail signals", () => {
  const analyticsPanel = dashboardHtml.match(/<section id="analyticsPanel"[\s\S]*?<section id="overviewPanel"/)?.[0] || "";

  assert.match(dashboardJs, /analytics: \{ eyebrow: "Delivery", title: "Mailbox health"/);
  assert.match(analyticsPanel, /Connected mailboxes/);
  assert.match(analyticsPanel, /Reply &amp; delivery feed/);
  assert.match(analyticsPanel, /does not expose whether a recipient placed a message in spam/);
  assert.match(analyticsPanel, /id="analyticsInboxSyncButton"/);
  assert.doesNotMatch(analyticsPanel, /Who is sending what|Delivered|Team leaderboard|Sequence health|dailySendChart/);
  assert.match(dashboardJs, /mailboxHealthRows/);
  assert.match(dashboardJs, /message\.bounceReason === "policy_blocked"/);
  assert.match(dashboardJs, /syncInboxBounces\(\)/, "routine mailbox sync must reuse silent saved-account authorization");
});
