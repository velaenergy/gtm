import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3, "The extension must use Manifest V3.");
assert.equal(manifest.action.default_popup, "popup.html", "The toolbar action must open popup.html.");
assert.ok(manifest.permissions.includes("storage"), "Storage permission is required for settings and drafts.");
assert.ok(manifest.permissions.includes("activeTab"), "activeTab is required for the current LinkedIn profile.");
assert.ok(manifest.permissions.includes("identity"), "identity is required for Gmail OAuth.");
assert.ok(manifest.permissions.includes("identity.email"), "identity.email is required to label the primary Google account.");
assert.ok(manifest.permissions.includes("tabs"), "tabs is required for sequential queue research.");
assert.ok(manifest.host_permissions.includes("https://gmail.googleapis.com/*"), "Gmail API origin is required.");
assert.ok(manifest.host_permissions.includes("https://sheets.googleapis.com/*"), "Google Sheets API origin is required.");
assert.ok(manifest.host_permissions.includes("https://api.contactout.com/*"), "ContactOut API origin is required.");
assert.equal(manifest.background.service_worker, "background.js");
assert.deepEqual(manifest.oauth2.scopes, [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/spreadsheets",
]);
assert.match(manifest.oauth2.client_id, /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/, "Gmail OAuth client ID must use Google's Chrome extension client format.");
assert.ok(manifest.content_scripts.some((script) => script.matches.includes("https://www.linkedin.com/in/*")));
const linkedinScript = manifest.content_scripts.find((script) => script.matches.includes("https://www.linkedin.com/in/*"));
assert.deepEqual(
  linkedinScript.js.slice(0, 2),
  ["lib/linkedin-parser.js", "content-script.js"],
  "The pure LinkedIn parser must load before the content script.",
);

const referencedFiles = [
  manifest.action.default_popup,
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

const popupHtml = await readFile(resolve(root, manifest.action.default_popup), "utf8");
assert.match(popupHtml, /<script\s+type="module"\s+src="popup\.js"><\/script>/, "popup.html must load popup.js.");
assert.match(popupHtml, /<link\s+rel="stylesheet"\s+href="popup\.css"\s*\/?>/, "popup.html must load popup.css.");
await Promise.all(["popup.js", "popup.css"].map((file) => access(resolve(root, file))));
const dashboardHtml = await readFile(resolve(root, "dashboard.html"), "utf8");
assert.match(dashboardHtml, /src="dashboard\.js"/);
assert.match(dashboardHtml, /href="dashboard\.css"/);
await Promise.all(["dashboard.js", "dashboard.css", "lib/queue.js", "lib/gmail.js", "lib/google-account-picker.js", "lib/google-sheets.js"].map((file) => access(resolve(root, file))));
console.log(`Manifest valid: ${referencedFiles.length} referenced files found.`);
