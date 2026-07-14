import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const updatesXml = await readFile(resolve(root, "updates.xml"), "utf8");

assert.equal(manifest.manifest_version, 3, "The extension must use Manifest V3.");
assert.ok(Number(manifest.minimum_chrome_version) >= 116, "Chrome 116+ is required for sidePanel.open().");
const extensionIdAlphabet = "abcdefghijklmnop";
const extensionId = [...createHash("sha256").update(Buffer.from(manifest.key || "", "base64")).digest().subarray(0, 16)]
  .map((byte) => extensionIdAlphabet[byte >> 4] + extensionIdAlphabet[byte & 15])
  .join("");
assert.equal(extensionId, "mecnpdbecgmgjolcdldhkeplheojjpki", "The manifest key must preserve the signed release extension ID.");
assert.match(updatesXml, new RegExp(`<app appid="${extensionId}">`), "The managed update feed must target the signed extension ID.");
assert.match(updatesXml, new RegExp(`version="${manifest.version.replaceAll(".", "\\.")}"`), "The managed update feed version must match manifest.json.");
assert.match(updatesXml, new RegExp(`/v${manifest.version.replaceAll(".", "\\.")}/vela-gtm-${manifest.version.replaceAll(".", "\\.")}\\.crx`), "The managed update feed must point to the matching GitHub release asset.");
assert.equal(manifest.action.default_popup, undefined, "The toolbar action must open the persistent side panel, not a popup.");
assert.equal(manifest.side_panel.default_path, "popup.html", "The Vela profile workspace must load in the Chrome side panel.");
assert.ok(manifest.permissions.includes("sidePanel"), "The sidePanel permission is required for the persistent workspace.");
assert.ok(manifest.permissions.includes("storage"), "Storage permission is required for settings and drafts.");
assert.ok(manifest.permissions.includes("activeTab"), "activeTab is required for the current LinkedIn profile.");
assert.ok(manifest.permissions.includes("identity"), "identity is required for Google delivery OAuth.");
assert.ok(!manifest.permissions.includes("identity.email"), "Web OAuth identifies the selected sender without Chrome-profile email access.");
assert.ok(manifest.permissions.includes("alarms"), "alarms is required for durable scheduled sends.");
assert.ok(manifest.permissions.includes("tabs"), "tabs is required for sequential queue research.");
assert.ok(manifest.host_permissions.includes("https://gmail.googleapis.com/*"), "Gmail send API origin is required.");
assert.ok(manifest.host_permissions.includes("https://www.googleapis.com/*"), "Google user-info origin is required to verify the explicitly selected sender.");
assert.ok(!manifest.permissions.includes("cookies"), "The ContactOut browser bridge must not request broad cookie access.");
assert.ok(!manifest.host_permissions.includes("https://sheets.googleapis.com/*"), "Google Sheets API access is not part of this extension.");
assert.ok(manifest.host_permissions.includes("https://contactout.com/*"), "ContactOut browser-session origin is required.");
assert.ok(manifest.host_permissions.includes("https://api.contactout.com/*"), "ContactOut API origin is required.");
assert.equal(manifest.background.service_worker, "background.js");
assert.equal(manifest.oauth2, undefined, "Gmail delivery must use the built-in Web OAuth account chooser, not Chrome-profile OAuth.");
assert.ok(manifest.content_scripts.some((script) => script.matches.includes("https://www.linkedin.com/in/*")));
const linkedinScript = manifest.content_scripts.find((script) => script.matches.includes("https://www.linkedin.com/in/*"));
assert.deepEqual(
  linkedinScript.js.slice(0, 3),
  ["lib/linkedin-parser.js", "lib/linkedin-launcher.js", "content-script.js"],
  "The pure LinkedIn helpers must load before the content script.",
);

const referencedFiles = [
  manifest.side_panel.default_path,
  manifest.options_page,
  "dashboard.html",
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((script) => script.js),
  ...Object.values(manifest.icons),
  "assets/vela-logo-light.png",
  "assets/vela-logo-dark.png",
  "assets/fonts/aeonik-pro-medium.ttf",
];

await Promise.all(referencedFiles.map((file) => access(resolve(root, file))));

const popupHtml = await readFile(resolve(root, manifest.side_panel.default_path), "utf8");
assert.match(popupHtml, /<script\s+type="module"\s+src="popup\.js"><\/script>/, "popup.html must load popup.js.");
assert.match(popupHtml, /<link\s+rel="stylesheet"\s+href="popup\.css"\s*\/?>/, "popup.html must load popup.css.");
await Promise.all(["popup.js", "popup.css"].map((file) => access(resolve(root, file))));
const dashboardHtml = await readFile(resolve(root, "dashboard.html"), "utf8");
assert.match(dashboardHtml, /src="dashboard\.js"/);
assert.match(dashboardHtml, /href="dashboard\.css"/);
await Promise.all(["dashboard.js", "dashboard.css", "lib/queue.js", "lib/delivery-ledger.js", "lib/google-auth.js", "lib/gmail-send.js", "lib/schedule.js", "lib/mail-merge.js", "vendor/xlsx.full.min.js"].map((file) => access(resolve(root, file))));
console.log(`Manifest valid: ${referencedFiles.length} referenced files found.`);
