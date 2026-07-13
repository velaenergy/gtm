import { DEFAULT_SETTINGS, resolveTheme } from "./lib/message.js";

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
const gmailState = document.getElementById("gmailState");
const extensionId = document.getElementById("extensionId");
const contactOutApiKey = document.getElementById("contactOutApiKey");
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

connectGmailButton.addEventListener("click", async () => {
  if (!isExtension) {
    showToast("Load the extension in Chrome to connect Gmail.");
    return;
  }
  const clientId = chrome.runtime.getManifest().oauth2?.client_id || "";
  if (clientId.startsWith("REPLACE_WITH_")) {
    showToast("Add your Google OAuth client ID to manifest.json first.");
    return;
  }
  try {
    connectGmailButton.disabled = true;
    const result = await chrome.identity.getAuthToken({ interactive: true });
    const token = typeof result === "string" ? result : result?.token;
    if (!token) throw new Error("Google did not return an access token.");
    gmailState.textContent = "Connected";
    gmailState.classList.add("has-access");
    showToast("Gmail connected for draft creation.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not connect Gmail.");
  } finally {
    connectGmailButton.disabled = false;
  }
});

loadSettings();
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (selectedTheme() === "system") applyTheme("system");
});
