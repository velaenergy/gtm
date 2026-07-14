import { DEFAULT_SETTINGS, contactOutConnectionState, emailTemplates, normalizeEmailTemplates, resolveTheme } from "./lib/message.js";
import {
  GOOGLE_ACCOUNT_AUTH_MODE,
  GOOGLE_ACCOUNTS_STORAGE_KEY,
  GOOGLE_ACCOUNT_STORAGE_KEY,
  GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY,
  chooseGoogleAccount,
  disconnectGoogle,
  getGoogleWebAuthToken,
  googleAuthStrategyForAccount,
  googleOAuthStrategy,
  googleWebRedirectUri,
  normalizeGoogleAccounts,
  selectedGoogleAccount,
  upsertGoogleAccount,
} from "./lib/google-auth.js";
import { GMAIL_SEND_SCOPE } from "./lib/gmail-send.js";
import { clearDiagnostics, formatDiagnostic, readDiagnostics } from "./lib/diagnostics.js";
import { parseCredentialImport } from "./lib/settings-import.js";

const form = document.getElementById("settingsForm");
const autoEnrich = document.getElementById("autoEnrich");
const resetButton = document.getElementById("resetButton");
const saveButton = document.getElementById("saveButton");
const connectGmailButton = document.getElementById("connectGmailButton");
const gmailState = document.getElementById("gmailState");
const gmailAccountDetail = document.getElementById("gmailAccountDetail");
const gmailAccountsList = document.getElementById("gmailAccountsList");
const extensionId = document.getElementById("extensionId");
const googleWebClientId = document.getElementById("googleWebClientId");
const googleChooserState = document.getElementById("googleChooserState");
const googleRedirectUri = document.getElementById("googleRedirectUri");
const copyGoogleRedirectButton = document.getElementById("copyGoogleRedirectButton");
const googleConnectionDetails = document.getElementById("googleConnectionDetails");
const gmailChooserHint = document.getElementById("gmailChooserHint");
const configureGoogleChooserButton = document.getElementById("configureGoogleChooserButton");
const contactOutSessionEnabled = document.getElementById("contactOutSessionEnabled");
const contactOutSessionCard = document.getElementById("contactOutSessionCard");
const contactOutSessionState = document.getElementById("contactOutSessionState");
const contactOutSessionTitle = document.getElementById("contactOutSessionTitle");
const contactOutSessionDetail = document.getElementById("contactOutSessionDetail");
const contactOutSessionAccount = document.getElementById("contactOutSessionAccount");
const contactOutSessionAccountEmail = document.getElementById("contactOutSessionAccountEmail");
const contactOutSessionCredits = document.getElementById("contactOutSessionCredits");
const contactOutSessionHint = document.getElementById("contactOutSessionHint");
const connectContactOutSessionButton = document.getElementById("connectContactOutSessionButton");
const checkContactOutSessionButton = document.getElementById("checkContactOutSessionButton");
const contactOutApiKey = document.getElementById("contactOutApiKey");
const apolloApiKey = document.getElementById("apolloApiKey");
const testContactOutButton = document.getElementById("testContactOutButton");
const contactOutApiState = document.getElementById("contactOutApiState");
const contactOutApiDetail = document.getElementById("contactOutApiDetail");
const testApolloButton = document.getElementById("testApolloButton");
const apolloApiState = document.getElementById("apolloApiState");
const openAIApiKey = document.getElementById("openAIApiKey");
const agentServerState = document.getElementById("agentServerState");
const includeContactOutPhone = document.getElementById("includeContactOutPhone");
const allowMultipleRecipients = document.getElementById("allowMultipleRecipients");
const gmailConnectionSetup = document.getElementById("gmailConnectionSetup");
const templateName = document.getElementById("templateName");
const templateSubject = document.getElementById("templateSubject");
const templateBody = document.getElementById("templateBody");
const templateSenderName = document.getElementById("templateSenderName");
const templateCalendarUrl = document.getElementById("templateCalendarUrl");
const templateList = document.getElementById("templateList");
const templateCount = document.getElementById("templateCount");
const templateEditorHeading = document.getElementById("templateEditorHeading");
const addTemplateButton = document.getElementById("addTemplateButton");
const deleteTemplateButton = document.getElementById("deleteTemplateButton");
const toast = document.getElementById("toast");
const themeInputs = [...document.querySelectorAll("input[name='theme']")];
const generationInputs = [...document.querySelectorAll("input[name='aiGenerationMode']")];
const deliveryMethodInputs = [...document.querySelectorAll("input[name='deliveryMethod']")];
const diagnosticState = document.getElementById("diagnosticState");
const diagnosticLog = document.getElementById("diagnosticLog");
const refreshDiagnosticsButton = document.getElementById("refreshDiagnosticsButton");
const copyDiagnosticsButton = document.getElementById("copyDiagnosticsButton");
const clearDiagnosticsButton = document.getElementById("clearDiagnosticsButton");
const openCredentialImportButton = document.getElementById("openCredentialImportButton");
const credentialImportDialog = document.getElementById("credentialImportDialog");
const credentialImportForm = document.getElementById("credentialImportForm");
const credentialImportFile = document.getElementById("credentialImportFile");
const chooseCredentialFileButton = document.getElementById("chooseCredentialFileButton");
const pasteCredentialButton = document.getElementById("pasteCredentialButton");
const credentialImportText = document.getElementById("credentialImportText");
const credentialImportStatus = document.getElementById("credentialImportStatus");
const applyCredentialImportButton = document.getElementById("applyCredentialImportButton");
const closeCredentialImportButton = document.getElementById("closeCredentialImportButton");
const cancelCredentialImportButton = document.getElementById("cancelCredentialImportButton");
const unsavedBar = document.getElementById("unsavedBar");
const stickySaveButton = document.getElementById("stickySaveButton");
const discardChangesButton = document.getElementById("discardChangesButton");

const isExtension = Boolean(globalThis.chrome?.storage?.local);
const previewTheme = !isExtension ? new URLSearchParams(location.search).get("theme") : null;
let toastTimer;
let contactOutSessionConnected = false;
let contactOutSessionMode = "checking";
let editableTemplates = [];
let activeTemplateId = "";
let connectedGoogleAccounts = [];
let selectedGoogleAccountId = "";
let lastSavedSettings = { ...DEFAULT_SETTINGS };
let hasUnsavedChanges = false;

extensionId.textContent = isExtension ? chrome.runtime.id : "available after loading the extension";
googleRedirectUri.textContent = isExtension ? googleWebRedirectUri(chrome.identity) : "Available after loading the extension";
copyGoogleRedirectButton.disabled = !isExtension;

function selectedTheme() {
  return themeInputs.find((input) => input.checked)?.value || DEFAULT_SETTINGS.theme;
}

function applyTheme(preference = DEFAULT_SETTINGS.theme) {
  const prefersDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

function cloneSettings(settings = {}) {
  return JSON.parse(JSON.stringify(settings));
}

function setUnsavedChanges(dirty) {
  hasUnsavedChanges = Boolean(dirty);
  unsavedBar.hidden = !hasUnsavedChanges;
  saveButton.classList.toggle("has-unsaved", hasUnsavedChanges);
}

function markUnsaved() {
  setUnsavedChanges(true);
}

function activeEditableTemplate() {
  return editableTemplates.find((template) => template.id === activeTemplateId) || editableTemplates[0];
}

function commitTemplateFields() {
  const active = activeEditableTemplate();
  if (!active) return;
  active.name = templateName.value.trim() || "Untitled template";
  active.subject = templateSubject.value;
  active.body = templateBody.value;
  active.senderName = templateSenderName.value.trim();
  active.calendarUrl = templateCalendarUrl.value.trim();
}

function renderTemplateList() {
  const fragment = document.createDocumentFragment();
  for (const template of editableTemplates) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.className = template.id === activeTemplateId ? "is-active" : "";
    button.setAttribute("aria-selected", String(template.id === activeTemplateId));
    const name = document.createElement("span");
    const action = document.createElement("small");
    name.textContent = template.name || "Untitled template";
    action.textContent = template.id === activeTemplateId ? "Editing" : "Edit";
    button.append(name, action);
    button.addEventListener("click", () => {
      commitTemplateFields();
      activeTemplateId = template.id;
      renderTemplateEditor();
    });
    fragment.append(button);
  }
  templateList.replaceChildren(fragment);
  templateCount.textContent = `${editableTemplates.length} template${editableTemplates.length === 1 ? "" : "s"}`;
}

function renderTemplateEditor() {
  const active = activeEditableTemplate();
  if (!active) return;
  templateName.value = active.name;
  templateSubject.value = active.subject;
  templateBody.value = active.body;
  templateSenderName.value = active.senderName || DEFAULT_SETTINGS.senderName;
  templateCalendarUrl.value = active.calendarUrl || DEFAULT_SETTINGS.calendarUrl;
  templateEditorHeading.textContent = active.name || "Untitled template";
  deleteTemplateButton.disabled = editableTemplates.length <= 1;
  renderTemplateList();
}

function fillTemplates(settings) {
  editableTemplates = emailTemplates(settings).map((template) => ({ ...template }));
  activeTemplateId = editableTemplates[0]?.id || "";
  renderTemplateEditor();
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

function resetCredentialImportDialog() {
  credentialImportForm.reset();
  credentialImportStatus.textContent = "Supported: ContactOut, Apollo, and OpenAI.";
  credentialImportStatus.dataset.state = "idle";
}

function applyCredentialImport(text, sourceLabel = "configuration") {
  const imported = parseCredentialImport(text);
  if (imported.values.contactOutApiKey) contactOutApiKey.value = imported.values.contactOutApiKey;
  if (imported.values.apolloApiKey) apolloApiKey.value = imported.values.apolloApiKey;
  if (imported.values.openAIApiKey) openAIApiKey.value = imported.values.openAIApiKey;
  renderContactOutApiStatus({ state: contactOutApiKey.value.trim() ? "needs-save" : "unconfigured" });
  renderGoogleChooserSetup({ saved: false });
  connectGmailButton.disabled = true;
  updateAgentKeyState();
  markUnsaved();
  credentialImportStatus.textContent = `Found ${imported.labels.join(", ")} in ${sourceLabel}.`;
  credentialImportStatus.dataset.state = "success";
  showToast(`Imported ${imported.labels.length} credential${imported.labels.length === 1 ? "" : "s"}. Review and save changes.`);
  credentialImportDialog.close();
  credentialImportText.value = "";
  credentialImportFile.value = "";
}

function showCredentialImportError(error) {
  const message = error instanceof Error ? error.message : "Could not import those credentials.";
  credentialImportStatus.textContent = message;
  credentialImportStatus.dataset.state = "error";
}

openCredentialImportButton.addEventListener("click", () => {
  resetCredentialImportDialog();
  credentialImportDialog.showModal();
  credentialImportText.focus();
});
closeCredentialImportButton.addEventListener("click", () => credentialImportDialog.close());
cancelCredentialImportButton.addEventListener("click", () => credentialImportDialog.close());
credentialImportDialog.addEventListener("close", () => {
  credentialImportText.value = "";
  credentialImportFile.value = "";
});
chooseCredentialFileButton.addEventListener("click", () => credentialImportFile.click());
credentialImportFile.addEventListener("change", async () => {
  const file = credentialImportFile.files?.[0];
  if (!file) return;
  try {
    applyCredentialImport(await file.text(), file.name);
  } catch (error) {
    showCredentialImportError(error);
  }
});
pasteCredentialButton.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    credentialImportText.value = text;
    applyCredentialImport(text, "the clipboard");
  } catch (error) {
    showCredentialImportError(error instanceof Error && error.message
      ? error
      : new Error("Chrome could not read the clipboard. Paste the configuration into the box instead."));
  }
});
applyCredentialImportButton.addEventListener("click", () => {
  try {
    applyCredentialImport(credentialImportText.value, "the pasted configuration");
  } catch (error) {
    showCredentialImportError(error);
  }
});

async function refreshDiagnostics() {
  if (!isExtension) return;
  const records = await readDiagnostics();
  const latest = records.slice(-60).reverse();
  diagnosticState.textContent = latest.length ? `${latest.length} recent event${latest.length === 1 ? "" : "s"}` : "No events";
  diagnosticState.classList.toggle("has-access", latest.length > 0);
  diagnosticLog.textContent = latest.length ? latest.map(formatDiagnostic).join("\n") : "No diagnostic events yet.";
}

refreshDiagnosticsButton.addEventListener("click", () => refreshDiagnostics());
copyDiagnosticsButton.addEventListener("click", async () => {
  if (!diagnosticLog.textContent || diagnosticLog.textContent === "No diagnostic events yet.") { showToast("There is no diagnostic log to copy yet."); return; }
  try {
    await navigator.clipboard.writeText(diagnosticLog.textContent);
    showToast("Safe diagnostic log copied.");
  } catch {
    showToast("Chrome could not copy the log. Select the text manually.");
  }
});
clearDiagnosticsButton.addEventListener("click", async () => {
  await clearDiagnostics();
  await refreshDiagnostics();
  showToast("Diagnostic log cleared.");
});

function fillForm(settings) {
  googleWebClientId.value = DEFAULT_SETTINGS.googleWebClientId;
  renderGoogleChooserSetup({ saved: true });
  renderGmailConnection({ oauthConfigured: Boolean(googleOAuthStrategy({
    webClientId: DEFAULT_SETTINGS.googleWebClientId,
  })) });
  contactOutSessionEnabled.checked = settings.contactOutSessionEnabled !== false;
  contactOutApiKey.value = settings.contactOutApiKey || "";
  apolloApiKey.value = settings.apolloApiKey || "";
  openAIApiKey.value = settings.openAIApiKey || "";
  includeContactOutPhone.checked = Boolean(settings.includeContactOutPhone);
  allowMultipleRecipients.checked = Boolean(settings.allowMultipleRecipients);
  const deliveryMethod = settings.deliveryMethod === "mailto" ? "mailto" : "gmail";
  const deliveryMethodInput = deliveryMethodInputs.find((input) => input.value === deliveryMethod);
  if (deliveryMethodInput) deliveryMethodInput.checked = true;
  renderDeliveryMethod();
  renderContactOutApiStatus({ state: contactOutApiKey.value.trim() ? "ready" : "unconfigured" });
  fillTemplates(settings);
  const generationInput = generationInputs.find((input) => input.value === "full");
  if (generationInput) generationInput.checked = true;
  autoEnrich.checked = Boolean(settings.autoEnrich);
  const savedTheme = ["light", "dark", "system"].includes(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme;
  const theme = ["light", "dark"].includes(previewTheme) ? previewTheme : savedTheme;
  const themeInput = themeInputs.find((input) => input.value === theme);
  if (themeInput) themeInput.checked = true;
  applyTheme(theme);
  updateAgentKeyState();
}

async function loadSettings() {
  const result = await storage.get("velaGtmSettings");
  lastSavedSettings = { ...DEFAULT_SETTINGS, ...(result.velaGtmSettings || {}) };
  lastSavedSettings.googleWebClientId = DEFAULT_SETTINGS.googleWebClientId;
  fillForm(lastSavedSettings);
  setUnsavedChanges(false);
}

function updateAgentKeyState() {
  agentServerState.classList.remove("has-access", "has-warning", "has-error");
  const fallbackConfigured = Boolean(contactOutApiKey.value.trim()) || Boolean(apolloApiKey.value.trim());
  if (contactOutSessionEnabled.checked && !contactOutSessionConnected && !fallbackConfigured) {
    if (contactOutSessionMode === "checking") agentServerState.textContent = "Checking ContactOut";
    else if (contactOutSessionMode === "error") {
      agentServerState.textContent = "ContactOut needs attention";
      agentServerState.classList.add("has-error");
    } else {
      agentServerState.textContent = "ContactOut signed out";
      agentServerState.classList.add("has-warning");
    }
    return;
  }
  const configured = [
    contactOutSessionEnabled.checked && contactOutSessionConnected && "ContactOut session",
    contactOutApiKey.value.trim() && "ContactOut API",
    apolloApiKey.value.trim() && "Apollo",
    openAIApiKey.value.trim() && "OpenAI",
  ].filter(Boolean);
  const providerReady = contactOutSessionConnected || Boolean(contactOutApiKey.value.trim()) || Boolean(apolloApiKey.value.trim());
  agentServerState.textContent = configured.length ? configured.join(" + ") : "Keys needed";
  agentServerState.classList.toggle("has-access", providerReady && Boolean(openAIApiKey.value.trim()));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    commitTemplateFields();
    if (editableTemplates.some((template) => !template.name.trim() || !template.subject.trim() || !template.body.trim())) {
      throw new Error("Every email template needs a name, subject, and message.");
    }
    const savedTemplates = normalizeEmailTemplates(editableTemplates);
    if (!savedTemplates.length) throw new Error("Keep at least one complete email template.");

    const nextSettings = {
        endpointUrl: "",
        apiToken: "",
        writerEndpointUrl: "",
        writerToken: "",
        googleWebClientId: DEFAULT_SETTINGS.googleWebClientId,
        contactOutSessionEnabled: contactOutSessionEnabled.checked,
        contactOutApiKey: contactOutApiKey.value.trim(),
        apolloApiKey: apolloApiKey.value.trim(),
        openAIApiKey: openAIApiKey.value.trim(),
        openAIModel: "gpt-5.4-mini",
        includeContactOutPhone: includeContactOutPhone.checked,
        allowMultipleRecipients: allowMultipleRecipients.checked,
        deliveryMethod: deliveryMethodInputs.find((input) => input.checked)?.value === "mailto" ? "mailto" : "gmail",
        aiGenerationMode: "full",
        emailTemplates: savedTemplates,
        templateSubject: savedTemplates[0].subject,
        templateBody: savedTemplates[0].body,
        autoEnrich: autoEnrich.checked,
        theme: selectedTheme(),
        senderName: savedTemplates[0].senderName || DEFAULT_SETTINGS.senderName,
        calendarUrl: savedTemplates[0].calendarUrl || DEFAULT_SETTINGS.calendarUrl,
    };
    await storage.set({ velaGtmSettings: nextSettings });
    lastSavedSettings = cloneSettings(nextSettings);
    setUnsavedChanges(false);
    renderContactOutApiStatus({ state: contactOutApiKey.value.trim() ? "ready" : "unconfigured" });
    renderGoogleChooserSetup({ saved: true });
    if (isExtension) await probeGmailConnection();
    else renderGmailConnection({ oauthConfigured: Boolean(googleOAuthStrategy({ webClientId: googleWebClientId.value })) });
    showToast("Vela GTM settings saved.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not save settings.");
  }
});

themeInputs.forEach((input) => input.addEventListener("change", () => applyTheme(selectedTheme())));
form.addEventListener("input", markUnsaved);
form.addEventListener("change", markUnsaved);
templateName.addEventListener("input", () => {
  commitTemplateFields();
  templateEditorHeading.textContent = templateName.value.trim() || "Untitled template";
  renderTemplateList();
});
templateSubject.addEventListener("input", commitTemplateFields);
templateBody.addEventListener("input", commitTemplateFields);
templateSenderName.addEventListener("input", commitTemplateFields);
templateCalendarUrl.addEventListener("input", commitTemplateFields);
addTemplateButton.addEventListener("click", () => {
  commitTemplateFields();
  const id = `custom-${Date.now().toString(36)}`;
  const previous = activeEditableTemplate();
  editableTemplates.push({
    id,
    name: "New template",
    eyebrow: "Saved template",
    subject: "",
    body: "",
    senderName: previous?.senderName || DEFAULT_SETTINGS.senderName,
    calendarUrl: previous?.calendarUrl || DEFAULT_SETTINGS.calendarUrl,
  });
  activeTemplateId = id;
  renderTemplateEditor();
  templateName.select();
  markUnsaved();
});
deleteTemplateButton.addEventListener("click", () => {
  if (editableTemplates.length <= 1) return;
  const index = editableTemplates.findIndex((template) => template.id === activeTemplateId);
  editableTemplates = editableTemplates.filter((template) => template.id !== activeTemplateId);
  activeTemplateId = editableTemplates[Math.max(0, index - 1)]?.id || editableTemplates[0].id;
  renderTemplateEditor();
  markUnsaved();
});

for (const button of document.querySelectorAll("[data-secret-toggle]")) {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.secretToggle);
    if (!input) return;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.textContent = reveal ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(reveal));
  });
}

resetButton.addEventListener("click", () => {
  fillForm(DEFAULT_SETTINGS);
  markUnsaved();
  showToast("Defaults restored. Save to apply them.");
});

stickySaveButton.addEventListener("click", () => form.requestSubmit(saveButton));
discardChangesButton.addEventListener("click", () => {
  fillForm(cloneSettings(lastSavedSettings));
  setUnsavedChanges(false);
  showToast("Unsaved changes discarded.");
});

globalThis.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "";
});

contactOutApiKey.addEventListener("input", () => {
  renderContactOutApiStatus({ state: contactOutApiKey.value.trim() ? "needs-save" : "unconfigured" });
  updateAgentKeyState();
});
contactOutSessionEnabled.addEventListener("change", () => {
  if (contactOutSessionEnabled.checked) probeContactOutSession();
  else renderContactOutSession({ disabled: true });
  updateAgentKeyState();
});
apolloApiKey.addEventListener("input", updateAgentKeyState);
openAIApiKey.addEventListener("input", updateAgentKeyState);
function renderDeliveryMethod() {
  const mailto = deliveryMethodInputs.find((input) => input.checked)?.value === "mailto";
  gmailConnectionSetup.hidden = mailto;
  if (mailto) {
    gmailState.textContent = "Mail app";
    gmailState.classList.add("has-access");
    gmailState.classList.remove("has-warning");
    gmailState.title = "Vela will open a prefilled draft in the default email app.";
  }
}

deliveryMethodInputs.forEach((input) => input.addEventListener("change", () => {
  renderDeliveryMethod();
  if (input.checked && input.value === "gmail") probeGmailConnection();
}));

function contactOutUsageSummary(usage = {}) {
  const count = Number(usage.count);
  const quota = Number(usage.quota);
  const remaining = Number(usage.remaining);
  if (Number.isFinite(remaining)) return `${remaining} email credits remaining`;
  if (Number.isFinite(count) && Number.isFinite(quota)) return `${Math.max(0, quota - count)} of ${quota} email credits remaining`;
  return "API token accepted";
}

function renderContactOutApiStatus({ state = "unconfigured", detail = "" } = {}) {
  const copy = {
    unconfigured: ["Not configured", "Optional. Used only when the browser session cannot return a result, and for People Search."],
    "needs-save": ["Save before testing", "The token has changed. Save settings, then run the API test."],
    ready: ["Ready to test", "A token is saved in this Chrome profile. Test it to confirm access and credits."],
    testing: ["Testing…", "ContactOut is validating the saved API token."],
    connected: ["API ready", detail || "The saved ContactOut API token is working."],
    error: ["API not working", detail || "ContactOut rejected the saved API token."],
  }[state] || ["Not configured", detail];
  contactOutApiState.textContent = copy[0];
  contactOutApiState.dataset.state = state;
  contactOutApiDetail.textContent = copy[1];
  testContactOutButton.disabled = state === "testing" || state === "unconfigured";
}

function renderContactOutSession({ connected = false, checking = false, disabled = false, account = null, detail = "", code = "" } = {}) {
  contactOutSessionConnected = connected;
  const state = contactOutConnectionState({ connected, checking, disabled, code, detail });
  contactOutSessionMode = state;
  const stateCopy = {
    disabled: ["Disabled", "Browser session is off", "Enable the switch below to use ContactOut from this Chrome profile."],
    checking: ["Checking", "Checking ContactOut…", "Verifying the ContactOut login in this Chrome profile."],
    connected: ["Signed in", "ContactOut is ready", "The browser session is available for profile lookups."],
    "signed-out": ["Signed out", "Sign in required", detail || "Open ContactOut, finish signing in, then come back and check again."],
    error: ["Not working", "ContactOut needs attention", detail || "The browser session test failed. Retry it or open ContactOut to inspect the session."],
  }[state];
  contactOutSessionCard.dataset.state = state;
  contactOutSessionState.textContent = stateCopy[0];
  contactOutSessionState.classList.toggle("has-access", state === "connected");
  contactOutSessionState.classList.toggle("has-warning", state === "signed-out");
  contactOutSessionState.classList.toggle("has-error", state === "error");
  contactOutSessionTitle.textContent = stateCopy[1];
  contactOutSessionDetail.textContent = stateCopy[2];
  contactOutSessionAccount.hidden = state !== "connected";
  if (connected) {
    contactOutSessionAccountEmail.textContent = account?.email || account?.name || "Signed-in ContactOut account";
    contactOutSessionCredits.textContent = Number.isFinite(Number(account?.credits?.email))
      ? Number(account.credits.email).toLocaleString()
      : "Available";
  }
  connectContactOutSessionButton.textContent = connected ? "Open ContactOut" : disabled ? "Enable session above" : "Sign in to ContactOut";
  connectContactOutSessionButton.disabled = checking || disabled;
  checkContactOutSessionButton.disabled = checking || disabled;
  checkContactOutSessionButton.textContent = checking ? "Checking…" : connected ? "Test session" : "Check again";
  contactOutSessionHint.textContent = connected
    ? "Used first for profile lookups. The API token below is only a fallback."
    : state === "error"
      ? "Retry the test. If it still fails, the safe diagnostic log below shows the failed stage without exposing cookies or contact data."
      : "Vela checks the normal ContactOut page in this browser. Cookies never leave ContactOut.";
  updateAgentKeyState();
}

async function probeContactOutSession({ createPage = false, announce = false } = {}) {
  if (!contactOutSessionEnabled.checked) {
    renderContactOutSession({ disabled: true });
    return false;
  }
  if (!isExtension) {
    renderContactOutSession({ detail: "Load the extension in Chrome to test the ContactOut browser session." });
    return false;
  }
  renderContactOutSession({ checking: true });
  try {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_CONTACTOUT_SESSION_STATUS", createPage });
    if (!response?.ok) {
      const error = new Error(response?.error || "ContactOut session check failed.");
      error.code = response?.code || "";
      error.status = response?.status || 0;
      throw error;
    }
    renderContactOutSession({ connected: true, account: response.data });
    if (announce) showToast("ContactOut browser session connected.");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "ContactOut is not connected.";
    renderContactOutSession({ detail: message, code: error?.code || "" });
    if (announce) showToast(message);
    return false;
  }
}

connectContactOutSessionButton.addEventListener("click", async () => {
  if (!isExtension) { showToast("Load the extension in Chrome to connect ContactOut."); return; }
  try {
    connectContactOutSessionButton.disabled = true;
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_CONTACTOUT_SESSION_CONNECT" });
    if (!response?.ok) throw new Error(response?.error || "Could not open ContactOut login.");
    renderContactOutSession({ code: "login_required", detail: "Finish signing in on ContactOut, then return here and click Check again." });
    showToast("Finish signing in to ContactOut, then return to Settings.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open ContactOut login.";
    renderContactOutSession({ detail: message, code: error?.code || "" });
    showToast(message);
  } finally {
    connectContactOutSessionButton.disabled = false;
  }
});

checkContactOutSessionButton.addEventListener("click", () => probeContactOutSession({ createPage: true, announce: true }));

testContactOutButton.addEventListener("click", async () => {
  if (!isExtension) { showToast("Load the extension in Chrome to test ContactOut."); return; }
  const saved = (await storage.get("velaGtmSettings")).velaGtmSettings || {};
  const enteredToken = contactOutApiKey.value.trim();
  if (!enteredToken) { showToast("Add a ContactOut API token first."); return; }
  if (enteredToken !== saved.contactOutApiKey) { showToast("Save settings before testing the ContactOut token."); return; }
  try {
    renderContactOutApiStatus({ state: "testing" });
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_CONTACTOUT_STATUS" });
    if (!response?.ok) throw new Error(response?.error || "ContactOut API test failed.");
    const summary = contactOutUsageSummary(response.data?.usage || {});
    renderContactOutApiStatus({ state: "connected", detail: summary });
    showToast(`ContactOut connected · ${summary}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ContactOut API test failed.";
    renderContactOutApiStatus({ state: "error", detail: message });
    showToast(message);
  } finally {
    if (contactOutApiState.dataset.state === "testing") renderContactOutApiStatus({ state: "ready" });
  }
});

testApolloButton.addEventListener("click", async () => {
  if (!isExtension) { showToast("Load the extension in Chrome to test Apollo."); return; }
  const saved = (await storage.get("velaGtmSettings")).velaGtmSettings || {};
  const enteredKey = apolloApiKey.value.trim();
  if (!enteredKey) { showToast("Add an Apollo API key first."); return; }
  if (enteredKey !== saved.apolloApiKey) { showToast("Save settings before testing the Apollo key."); return; }
  try {
    testApolloButton.disabled = true;
    apolloApiState.textContent = "Testing";
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_APOLLO_STATUS" });
    if (!response?.ok) throw new Error(response?.error || "Apollo API test failed.");
    apolloApiState.textContent = "Connected";
    apolloApiState.classList.add("has-access");
    showToast("Apollo connected.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apollo API test failed.";
    apolloApiState.textContent = "API error";
    apolloApiState.title = message;
    apolloApiState.classList.remove("has-access");
    showToast(message);
  } finally {
    testApolloButton.disabled = false;
  }
});

function renderGoogleChooserSetup({ saved = false } = {}) {
  const strategy = googleOAuthStrategy({ webClientId: googleWebClientId.value });
  googleChooserState.textContent = !strategy
    ? "OAuth setup needed"
    : !saved
      ? "Save changes to enable"
      : "Web account chooser ready";
  googleChooserState.dataset.state = strategy ? saved ? "ready" : "needs-save" : "missing";
}

function googleChooserReady({ webClientId = "" } = {}) {
  return googleOAuthStrategy({ webClientId }) === GOOGLE_ACCOUNT_AUTH_MODE;
}

function revealGoogleChooserSetup() {
  gmailChooserHint.hidden = false;
  googleConnectionDetails.open = true;
  googleWebClientId.focus({ preventScroll: true });
  googleConnectionDetails.scrollIntoView({ behavior: "smooth", block: "center" });
  showToast("The Google Web OAuth account chooser is built into this Vela release.");
}

configureGoogleChooserButton.addEventListener("click", revealGoogleChooserSetup);

function renderConnectedGoogleAccounts(accounts = connectedGoogleAccounts, selectedId = selectedGoogleAccountId) {
  const fragment = document.createDocumentFragment();
  for (const account of accounts) {
    const row = document.createElement("div");
    row.className = `gmail-account-row${account.id === selectedId ? " is-selected" : ""}`;

    const select = document.createElement("button");
    select.type = "button";
    select.className = "gmail-account-select";
    select.dataset.accountId = account.id;
    select.innerHTML = `<strong></strong><small>${account.id === selectedId ? "Selected sender" : "Use this sender"}</small>`;
    select.querySelector("strong").textContent = account.email;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "gmail-account-remove";
    remove.dataset.removeAccountId = account.id;
    remove.setAttribute("aria-label", `Remove ${account.email}`);
    remove.textContent = "Remove";

    row.append(select, remove);
    fragment.append(row);
  }
  gmailAccountsList.replaceChildren(fragment);
}

async function persistGoogleAccounts(accounts, preferredAccountId = "") {
  connectedGoogleAccounts = normalizeGoogleAccounts(accounts);
  const selected = selectedGoogleAccount(connectedGoogleAccounts, preferredAccountId);
  selectedGoogleAccountId = selected?.id || "";
  await storage.set({
    [GOOGLE_ACCOUNTS_STORAGE_KEY]: connectedGoogleAccounts,
    [GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY]: selectedGoogleAccountId,
  });
  if (selected) await storage.set({ [GOOGLE_ACCOUNT_STORAGE_KEY]: selected });
  else await storage.remove(GOOGLE_ACCOUNT_STORAGE_KEY);
  return selected;
}

async function readGoogleAccounts() {
  const saved = await storage.get([
    GOOGLE_ACCOUNTS_STORAGE_KEY,
    GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY,
    GOOGLE_ACCOUNT_STORAGE_KEY,
  ]);
  const accounts = normalizeGoogleAccounts(saved[GOOGLE_ACCOUNTS_STORAGE_KEY], saved[GOOGLE_ACCOUNT_STORAGE_KEY]);
  const selected = selectedGoogleAccount(accounts, saved[GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY], saved[GOOGLE_ACCOUNT_STORAGE_KEY]);
  await persistGoogleAccounts(accounts, selected?.id || "");
  return { accounts: connectedGoogleAccounts, selected };
}

function renderGmailConnection({ connected = false, oauthConfigured = true, checking = false, detail = "", email = "", authMode = "" } = {}) {
  if (deliveryMethodInputs.find((input) => input.checked)?.value === "mailto") {
    renderDeliveryMethod();
    return;
  }
  gmailState.textContent = checking ? "Checking" : connected ? "Connected" : !oauthConfigured ? "Setup needed" : "Not connected";
  gmailState.classList.toggle("has-access", connected);
  gmailState.classList.toggle("has-warning", !connected && !checking && !oauthConfigured);
  gmailState.title = detail;
  connectGmailButton.textContent = connectedGoogleAccounts.length ? "Add another Gmail" : "Add Gmail account";
  connectGmailButton.disabled = checking || !oauthConfigured;
  gmailChooserHint.hidden = !connectedGoogleAccounts.length || googleChooserReady({ webClientId: lastSavedSettings.googleWebClientId });
  renderConnectedGoogleAccounts();
  gmailAccountDetail.textContent = email
    ? `${connectedGoogleAccounts.length} connected · sending from ${email} · explicitly selected`
    : detail || (oauthConfigured ? "No Gmail sender connected." : "The built-in Google Web OAuth client is unavailable.");
}

async function probeGmailConnection() {
  if (!isExtension) return;
  const configuredSettings = { ...DEFAULT_SETTINGS };
  const oauthConfigured = Boolean(googleOAuthStrategy({ webClientId: configuredSettings.googleWebClientId }));
  renderGmailConnection({ checking: true, oauthConfigured });
  try {
    const state = await readGoogleAccounts();
    if (!state.selected?.id) { renderGmailConnection({ oauthConfigured }); return; }
    const account = state.selected;
    const strategy = googleAuthStrategyForAccount({ account, webClientId: configuredSettings.googleWebClientId });
    if (strategy === GOOGLE_ACCOUNT_AUTH_MODE) {
      await getGoogleWebAuthToken({
        identity: chrome.identity,
        clientId: configuredSettings.googleWebClientId,
        scopes: [GMAIL_SEND_SCOPE],
        expectedEmail: account.email,
      });
    } else {
      renderGmailConnection({
        oauthConfigured,
        detail: "This sender needs to be reconnected through the Google account chooser.",
      });
      return;
    }
    renderGmailConnection({ connected: true, oauthConfigured, email: account.email || "Google account", authMode: account.authMode });
  } catch (error) {
    renderGmailConnection({ oauthConfigured, detail: error instanceof Error ? error.message : "Google delivery is not connected." });
  }
}

connectGmailButton.addEventListener("click", async () => {
  if (!isExtension) {
    showToast("Load the extension in Chrome to connect a Gmail sender.");
    return;
  }
  const configuredSettings = { ...DEFAULT_SETTINGS };
  const strategy = googleOAuthStrategy({ webClientId: configuredSettings.googleWebClientId });
  if (!strategy) {
    renderGmailConnection({ oauthConfigured: false });
    showToast("The built-in Google Web OAuth client is unavailable.");
    return;
  }
  try {
    connectGmailButton.disabled = true;
    const selected = await chooseGoogleAccount({
      identity: chrome.identity,
      clientId: configuredSettings.googleWebClientId,
      scopes: [GMAIL_SEND_SCOPE],
    });
    await persistGoogleAccounts(upsertGoogleAccount(connectedGoogleAccounts, selected), selected.id);
    renderGmailConnection({ connected: true, oauthConfigured: true, email: selected.email, authMode: selected.authMode });
    showToast(`${selected.email} connected for direct Gmail sending.`);
  } catch (error) {
    renderGmailConnection({ oauthConfigured: true, detail: error instanceof Error ? error.message : "Could not connect Google delivery." });
    showToast(error instanceof Error ? error.message : "Could not connect Google delivery.");
  } finally {
    connectGmailButton.disabled = false;
  }
});

gmailAccountsList.addEventListener("click", async (event) => {
  const removeButton = event.target.closest("[data-remove-account-id]");
  if (removeButton) {
    const account = connectedGoogleAccounts.find((item) => item.id === removeButton.dataset.removeAccountId);
    if (!account) return;
    await disconnectGoogle(chrome.identity, { authMode: account.authMode });
    const next = await persistGoogleAccounts(connectedGoogleAccounts.filter((item) => item.id !== account.id), selectedGoogleAccountId);
    const webClientId = DEFAULT_SETTINGS.googleWebClientId;
    renderGmailConnection({ connected: Boolean(next), oauthConfigured: Boolean(googleOAuthStrategy({ webClientId })), email: next?.email, authMode: next?.authMode });
    showToast(`${account.email} removed.`);
    return;
  }

  const selectButton = event.target.closest("[data-account-id]");
  if (!selectButton) return;
  const selected = await persistGoogleAccounts(connectedGoogleAccounts, selectButton.dataset.accountId);
  renderGmailConnection({ connected: Boolean(selected), oauthConfigured: true, email: selected?.email, authMode: selected?.authMode });
  showToast(`${selected.email} selected for new Gmail sends.`);
});

copyGoogleRedirectButton.addEventListener("click", async () => {
  if (!isExtension) { showToast("Load the extension in Chrome to copy its redirect URI."); return; }
  try {
    await navigator.clipboard.writeText(googleWebRedirectUri(chrome.identity));
    showToast("Google OAuth redirect URI copied.");
  } catch {
    showToast("Chrome could not copy the redirect URI. Select it manually.");
  }
});

loadSettings().then(() => Promise.all([probeContactOutSession(), probeGmailConnection(), refreshDiagnostics()]));
globalThis.addEventListener("focus", () => {
  if (contactOutSessionEnabled.checked && !contactOutSessionConnected) probeContactOutSession();
  refreshDiagnostics();
});
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (selectedTheme() === "system") applyTheme("system");
});
