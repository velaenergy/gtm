import { DEFAULT_SETTINGS, resolveTheme } from "./lib/message.js";
import {
  GOOGLE_ACCOUNT_STORAGE_KEY,
  disconnectGmail,
  getGmailAuthToken,
  getGmailProfile,
  gmailOAuthConfigured,
} from "./lib/gmail.js";
import { pickGoogleAccount } from "./lib/google-account-picker.js";

const form = document.getElementById("settingsForm");
const endpointUrl = document.getElementById("endpointUrl");
const apiToken = document.getElementById("apiToken");
const writerEndpointUrl = document.getElementById("writerEndpointUrl");
const writerToken = document.getElementById("writerToken");
const autoEnrich = document.getElementById("autoEnrich");
const senderName = document.getElementById("senderName");
const calendarUrl = document.getElementById("calendarUrl");
const permissionState = document.getElementById("permissionState");
const writerPermissionState = document.getElementById("writerPermissionState");
const toggleToken = document.getElementById("toggleToken");
const toggleWriterToken = document.getElementById("toggleWriterToken");
const resetButton = document.getElementById("resetButton");
const connectGmailButton = document.getElementById("connectGmailButton");
const disconnectGmailButton = document.getElementById("disconnectGmailButton");
const gmailState = document.getElementById("gmailState");
const gmailAccountDetail = document.getElementById("gmailAccountDetail");
const googleAccountDialog = document.getElementById("googleAccountDialog");
const googleAccountList = document.getElementById("googleAccountList");
const extensionId = document.getElementById("extensionId");
const contactOutApiKey = document.getElementById("contactOutApiKey");
const testContactOutButton = document.getElementById("testContactOutButton");
const contactOutApiState = document.getElementById("contactOutApiState");
const openAIApiKey = document.getElementById("openAIApiKey");
const agentServerState = document.getElementById("agentServerState");
const includeContactOutPhone = document.getElementById("includeContactOutPhone");
const toast = document.getElementById("toast");
const themeInputs = [...document.querySelectorAll("input[name='theme']")];

const isExtension = Boolean(globalThis.chrome?.storage?.local);
const previewTheme = !isExtension ? new URLSearchParams(location.search).get("theme") : null;
let toastTimer;

extensionId.textContent = isExtension ? chrome.runtime.id : "available after loading the extension";

function selectedTheme() {
  return themeInputs.find((input) => input.checked)?.value || DEFAULT_SETTINGS.theme;
}

function applyTheme(preference = DEFAULT_SETTINGS.theme) {
  const prefersDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

const storage = {
  async get(key) {
    if (isExtension) return chrome.storage.local.get(key);
    return { [key]: JSON.parse(localStorage.getItem(key) || "null") };
  },
  async set(values) {
    if (isExtension) return chrome.storage.local.set(values);
    Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
  },
  async remove(key) {
    if (isExtension) return chrome.storage.local.remove(key);
    localStorage.removeItem(key);
  },
};

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function originPatternFor(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("The endpoint must use http:// or https://.");
  return `${url.protocol}//${url.host}/*`;
}

async function updatePermissionState(value, stateElement) {
  if (!value) {
    stateElement.textContent = "Not configured";
    stateElement.classList.remove("has-access");
    return;
  }
  if (!isExtension || !chrome.permissions) {
    stateElement.textContent = "Preview mode";
    stateElement.classList.add("has-access");
    return;
  }
  try {
    const hasAccess = await chrome.permissions.contains({ origins: [originPatternFor(value)] });
    stateElement.textContent = hasAccess ? "Origin allowed" : "Needs permission";
    stateElement.classList.toggle("has-access", hasAccess);
  } catch {
    stateElement.textContent = "Invalid URL";
    stateElement.classList.remove("has-access");
  }
}

function fillForm(settings) {
  endpointUrl.value = settings.endpointUrl || "";
  apiToken.value = settings.apiToken || "";
  writerEndpointUrl.value = settings.writerEndpointUrl || "";
  writerToken.value = settings.writerToken || "";
  contactOutApiKey.value = settings.contactOutApiKey || "";
  openAIApiKey.value = settings.openAIApiKey || "";
  includeContactOutPhone.checked = Boolean(settings.includeContactOutPhone);
  autoEnrich.checked = Boolean(settings.autoEnrich);
  senderName.value = settings.senderName || DEFAULT_SETTINGS.senderName;
  calendarUrl.value = settings.calendarUrl || DEFAULT_SETTINGS.calendarUrl;
  const savedTheme = ["light", "dark", "system"].includes(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme;
  const theme = ["light", "dark"].includes(previewTheme) ? previewTheme : savedTheme;
  const themeInput = themeInputs.find((input) => input.value === theme);
  if (themeInput) themeInput.checked = true;
  applyTheme(theme);
  updatePermissionState(endpointUrl.value.trim(), permissionState);
  updatePermissionState(writerEndpointUrl.value.trim(), writerPermissionState);
  updateAgentKeyState();
}

async function loadSettings() {
  const result = await storage.get("velaGtmSettings");
  fillForm({ ...DEFAULT_SETTINGS, ...(result.velaGtmSettings || {}) });
}

async function requestOriginAccess(value) {
  if (!value || !isExtension || !chrome.permissions) return true;
  const origin = originPatternFor(value);
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

function updateAgentKeyState() {
  const configured = [contactOutApiKey.value.trim() && "ContactOut", openAIApiKey.value.trim() && "OpenAI"].filter(Boolean);
  agentServerState.textContent = configured.length ? configured.join(" + ") : "Keys needed";
  agentServerState.classList.toggle("has-access", configured.length === 2);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const endpoint = endpointUrl.value.trim();
  const writerEndpoint = writerEndpointUrl.value.trim();

  try {
    if (endpoint) new URL(endpoint);
    if (writerEndpoint) new URL(writerEndpoint);
    const enrichmentAllowed = await requestOriginAccess(endpoint);
    const writerAllowed = await requestOriginAccess(writerEndpoint);
    if (!enrichmentAllowed || !writerAllowed) {
      showToast("Settings were not saved because endpoint access was declined.");
      return;
    }

    await storage.set({
      velaGtmSettings: {
        endpointUrl: endpoint,
        apiToken: apiToken.value.trim(),
        writerEndpointUrl: writerEndpoint,
        writerToken: writerToken.value.trim(),
        contactOutApiKey: contactOutApiKey.value.trim(),
        openAIApiKey: openAIApiKey.value.trim(),
        openAIModel: "gpt-5.4-mini",
        includeContactOutPhone: includeContactOutPhone.checked,
        autoEnrich: autoEnrich.checked,
        theme: selectedTheme(),
        senderName: senderName.value.trim() || DEFAULT_SETTINGS.senderName,
        calendarUrl: calendarUrl.value.trim() || DEFAULT_SETTINGS.calendarUrl,
      },
    });
    await updatePermissionState(endpoint, permissionState);
    await updatePermissionState(writerEndpoint, writerPermissionState);
    showToast("Vela GTM settings saved.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not save settings.");
  }
});

endpointUrl.addEventListener("input", () => updatePermissionState(endpointUrl.value.trim(), permissionState));
writerEndpointUrl.addEventListener("input", () =>
  updatePermissionState(writerEndpointUrl.value.trim(), writerPermissionState),
);
themeInputs.forEach((input) => input.addEventListener("change", () => applyTheme(selectedTheme())));

toggleToken.addEventListener("click", () => {
  const reveal = apiToken.type === "password";
  apiToken.type = reveal ? "text" : "password";
  toggleToken.textContent = reveal ? "Hide" : "Show";
});

toggleWriterToken.addEventListener("click", () => {
  const reveal = writerToken.type === "password";
  writerToken.type = reveal ? "text" : "password";
  toggleWriterToken.textContent = reveal ? "Hide" : "Show";
});

resetButton.addEventListener("click", () => {
  fillForm(DEFAULT_SETTINGS);
  showToast("Defaults restored. Save to apply them.");
});

contactOutApiKey.addEventListener("input", updateAgentKeyState);
openAIApiKey.addEventListener("input", updateAgentKeyState);

function contactOutUsageSummary(usage = {}) {
  const count = Number(usage.count);
  const quota = Number(usage.quota);
  const remaining = Number(usage.remaining);
  if (Number.isFinite(remaining)) return `${remaining} email credits remaining`;
  if (Number.isFinite(count) && Number.isFinite(quota)) return `${Math.max(0, quota - count)} of ${quota} email credits remaining`;
  return "API token accepted";
}

testContactOutButton.addEventListener("click", async () => {
  if (!isExtension) { showToast("Load the extension in Chrome to test ContactOut."); return; }
  const saved = (await storage.get("velaGtmSettings")).velaGtmSettings || {};
  const enteredToken = contactOutApiKey.value.trim();
  if (!enteredToken) { showToast("Add a ContactOut API token first."); return; }
  if (enteredToken !== saved.contactOutApiKey) { showToast("Save settings before testing the ContactOut token."); return; }
  try {
    testContactOutButton.disabled = true;
    contactOutApiState.textContent = "Testing";
    contactOutApiState.classList.remove("has-access");
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_CONTACTOUT_STATUS" });
    if (!response?.ok) throw new Error(response?.error || "ContactOut API test failed.");
    const summary = contactOutUsageSummary(response.data?.usage || {});
    contactOutApiState.textContent = "Connected";
    contactOutApiState.title = summary;
    contactOutApiState.classList.add("has-access");
    showToast(`ContactOut connected · ${summary}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ContactOut API test failed.";
    contactOutApiState.textContent = "API error";
    contactOutApiState.title = message;
    contactOutApiState.classList.remove("has-access");
    showToast(message);
  } finally {
    testContactOutButton.disabled = false;
  }
});

function renderGmailConnection({ connected = false, configured = true, checking = false, detail = "", email = "" } = {}) {
  gmailState.textContent = checking ? "Checking" : !configured ? "OAuth setup needed" : connected ? "Connected" : "Not connected";
  gmailState.classList.toggle("has-access", connected);
  gmailState.title = detail;
  connectGmailButton.textContent = connected ? "Choose another account" : "Connect Gmail";
  disconnectGmailButton.hidden = !connected;
  gmailAccountDetail.textContent = email ? `Selected account: ${email}` : detail || "No Google account selected.";
}

async function probeGmailConnection() {
  if (!isExtension) return;
  const manifest = chrome.runtime.getManifest();
  if (!gmailOAuthConfigured(manifest)) {
    renderGmailConnection({ configured: false });
    return;
  }
  renderGmailConnection({ checking: true });
  try {
    const saved = (await storage.get(GOOGLE_ACCOUNT_STORAGE_KEY))[GOOGLE_ACCOUNT_STORAGE_KEY];
    if (!saved?.id) { renderGmailConnection(); return; }
    const token = await getGmailAuthToken({ identity: chrome.identity, manifest, interactive: false, accountId: saved.id });
    const profile = saved.email ? saved : { id: saved.id, ...(await getGmailProfile(token)) };
    await storage.set({ [GOOGLE_ACCOUNT_STORAGE_KEY]: profile });
    renderGmailConnection({ connected: true, email: profile.email });
  } catch (error) {
    renderGmailConnection({ detail: error instanceof Error ? error.message : "Gmail is not connected." });
  }
}

connectGmailButton.addEventListener("click", async () => {
  if (!isExtension) {
    showToast("Load the extension in Chrome to connect Gmail.");
    return;
  }
  const manifest = chrome.runtime.getManifest();
  if (!gmailOAuthConfigured(manifest)) {
    renderGmailConnection({ configured: false });
    showToast("Add your Google OAuth client ID to manifest.json first.");
    return;
  }
  try {
    connectGmailButton.disabled = true;
    const saved = (await storage.get(GOOGLE_ACCOUNT_STORAGE_KEY))[GOOGLE_ACCOUNT_STORAGE_KEY];
    const knownAccounts = saved?.id && saved?.email ? { [saved.id]: saved.email } : {};
    const account = await pickGoogleAccount(chrome.identity, { dialog: googleAccountDialog, list: googleAccountList, knownAccounts });
    if (!account) return;
    const token = await getGmailAuthToken({ identity: chrome.identity, manifest, interactive: true, accountId: account.id });
    const profile = await getGmailProfile(token);
    const selected = { id: account.id, email: profile.email || account.label };
    await storage.set({ [GOOGLE_ACCOUNT_STORAGE_KEY]: selected });
    renderGmailConnection({ connected: true, email: selected.email });
    showToast(`${selected.email} connected for Gmail drafts and Sheets exports.`);
  } catch (error) {
    renderGmailConnection({ detail: error instanceof Error ? error.message : "Could not connect Gmail." });
    showToast(error instanceof Error ? error.message : "Could not connect Gmail.");
  } finally {
    connectGmailButton.disabled = false;
  }
});

disconnectGmailButton.addEventListener("click", async () => {
  if (!isExtension) return;
  try {
    connectGmailButton.disabled = true;
    disconnectGmailButton.disabled = true;
    await disconnectGmail(chrome.identity);
    await storage.remove(GOOGLE_ACCOUNT_STORAGE_KEY);
    renderGmailConnection();
    showToast("Gmail disconnected from Vela GTM.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not disconnect Gmail.");
  } finally {
    connectGmailButton.disabled = false;
    disconnectGmailButton.disabled = false;
  }
});

loadSettings();
probeGmailConnection();
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (selectedTheme() === "system") applyTheme("system");
});
