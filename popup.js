import {
  DEFAULT_SETTINGS,
  applyTemplate,
  deliveryRecipientEmails,
  emailTemplates,
  gmailComposeUrl,
  mailtoComposeUrl,
  initialsFor,
  isEmail,
  migrateLegacyQuickIntroDraft,
  normalizeEnrichmentResponse,
  normalizeRecipientSelection,
  resolveTheme,
  templateVariables,
} from "./lib/message.js";
import { runAutomaticProfileWorkflow } from "./lib/profile-workflow.js";
import {
  GOOGLE_ACCOUNTS_STORAGE_KEY,
  GOOGLE_ACCOUNT_STORAGE_KEY,
  GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY,
  normalizeGoogleAccounts,
  selectedGoogleAccount,
} from "./lib/google-auth.js";
import {
  DEFAULT_DELIVERY_SETTINGS,
  DELIVERY_SETTINGS_KEY,
  nextScheduledAt,
  normalizeDeliverySettings,
} from "./lib/schedule.js";
import { buildWriterRequest, mergeEnrichedProfile, normalizeWorkNote, normalizeWriterResponse, openerQualityIssues } from "./lib/ai-writer.js";
import { resolveContactEmail } from "./lib/contact-resolution.js";
import { PROVIDER, configuredEnrichmentProviders, providerLabel } from "./lib/provider-priority.js";
import { appendDiagnostic } from "./lib/diagnostics.js";
import { QUEUE_STORAGE_KEY, prospectIdentity, upsertProspects } from "./lib/queue.js";
import {
  CAMPAIGNS_STORAGE_KEY,
  addProspectToCampaign,
  campaignsForProspect,
  createCampaign,
  normalizeCampaigns,
} from "./lib/campaigns.js";

const DEMO_PROFILE = {
  name: "Joshua Rivera",
  headline: "Critical Operations Leader · Data Centers · Mission-Critical Infrastructure",
  location: "Greater Seattle Area",
  about: "Operations leader focused on reliable mission-critical infrastructure and high-performing technical teams.",
  visibleEmail: "joshxlr8er06@gmail.com",
  url: "https://www.linkedin.com/in/joshua-rivera",
  workNote:
    "your 20 years in critical operations, including Navy nuclear experience, AWS data center operations, and Stream Data Centers leadership",
  experiences: [
    { title: "Operations Leadership", company: "Stream Data Centers", dates: "Recent" },
    { title: "Data Center Operations", company: "Amazon Web Services", dates: "Prior" },
    { title: "Nuclear Operations", company: "U.S. Navy", dates: "20+ yr arc" },
  ],
};

const elements = Object.fromEntries(
  [
    "loadingView", "pageGate", "workspace", "actionBar", "previewBadge", "settingsButton", "queueButton", "gateWorkspaceButton", "captureStatus",
    "avatar", "profileName", "profileHeadline", "profileLocationText", "emailSource", "emailConfidence", "emailInput",
    "contactStep", "personalizationStep", "contactOutBalance", "emailDraftDisclosure",
    "findEmailButton", "copyEmailButton", "contactDetails", "workNote", "signalCount", "experienceList", "templateSelect",
    "personalizationSource", "rewritePersonalizationButton", "templateEyebrow", "generateEmailButton", "subjectInput", "bodyInput", "wordCount", "copyDraftButton", "sendEmailButton", "toast",
    "deliveryAccountButton", "deliveryAccount", "scheduleToggle", "scheduleTime", "scheduleHint",
    "addToCampaignButton", "campaignDialog", "closeCampaignDialog", "campaignList", "createCampaignForm", "newCampaignName",
    "createCampaignButton", "openCampaignWorkspace",
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  email: "",
  emailSource: "",
  emailVerified: false,
  emailType: "",
  contactDetails: { emails: [], phones: [], emailStatus: "", emailStatuses: {}, error: "" },
  confidence: null,
  selectedRecipients: new Set(),
  note: "",
  templates: [],
  templateId: "",
  subject: "",
  body: "",
  personalizationModel: "",
  campaigns: [],
  lastCampaignId: "",
  composerDirty: false,
  draftTimer: null,
  toastTimer: null,
  activeTabId: null,
  googleAccount: null,
  googleAccounts: [],
  deliverySettings: { ...DEFAULT_DELIVERY_SETTINGS },
  deliveryLoading: false,
  contactOutCreditsRemaining: null,
  autoLookupAttempts: new Set(),
  refreshTimer: null,
  refreshSequence: 0,
  isPreview: !globalThis.chrome?.tabs?.query,
};

const previewTheme = state.isPreview ? new URLSearchParams(location.search).get("theme") : null;
const previewTab = state.isPreview ? new URLSearchParams(location.search).get("tab") : null;

const storage = {
  async get(keys) {
    if (globalThis.chrome?.storage?.local) return chrome.storage.local.get(keys);
    const requested = Array.isArray(keys) ? keys : Object.keys(keys || {});
    return Object.fromEntries(requested.map((key) => [key, JSON.parse(localStorage.getItem(key) || "null")]));
  },
  async set(values) {
    if (globalThis.chrome?.storage?.local) return chrome.storage.local.set(values);
    Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
  },
};

function applyTheme(preference = "system") {
  const prefersDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2300);
}

function showView(view) {
  elements.loadingView.hidden = view !== "loading";
  elements.pageGate.hidden = view !== "gate";
  elements.workspace.hidden = view !== "workspace";
  elements.actionBar.hidden = view !== "workspace";
}

function setText(element, value, fallback = "") {
  element.textContent = value || fallback;
}

function populateTemplates() {
  const fragment = document.createDocumentFragment();
  for (const template of state.templates) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    fragment.append(option);
  }
  elements.templateSelect.replaceChildren(fragment);
}

function activeTemplate() {
  return state.templates.find((template) => template.id === state.templateId) || state.templates[0];
}

function rebuildComposer({ markClean = true } = {}) {
  if (!state.profile) return;
  const template = activeTemplate();
  const variables = templateVariables(state.profile, state.settings, state.note);
  const composed = applyTemplate(template, variables);
  state.subject = composed.subject;
  state.body = composed.body;
  state.composerDirty = !markClean;
  elements.subjectInput.value = state.subject;
  elements.bodyInput.value = state.body;
  elements.templateEyebrow.textContent = template.eyebrow;
  updateWordCount();
  queueDraftSave();
}

function updateWordCount() {
  const count = state.body.trim() ? state.body.trim().split(/\s+/).length : 0;
  elements.wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
  renderDelivery();
}

function verifiedRecipientEmails() {
  const statuses = state.contactDetails.emailStatuses || {};
  return [...new Set([
    ...(state.emailVerified && isEmail(state.email) ? [state.email] : []),
    ...(state.contactDetails.emails || []).filter((email) => ["verified", "valid"].includes(String(statuses[email] || statuses[email.toLowerCase()] || "").toLowerCase())),
  ].map((email) => String(email).trim().toLowerCase()).filter(isEmail))];
}

function selectedRecipientEmails() {
  return normalizeRecipientSelection(verifiedRecipientEmails(), state.selectedRecipients, {
    allowMultiple: Boolean(state.settings.allowMultipleRecipients),
    preferred: state.email,
  });
}

function deliveryRecipients() {
  return deliveryRecipientEmails({
    deliveryMethod: state.settings.deliveryMethod,
    gmailConnected: Boolean(state.googleAccount?.id),
    currentEmail: state.email,
    verifiedEmails: verifiedRecipientEmails(),
    selectedRecipients: state.selectedRecipients,
    allowMultiple: Boolean(state.settings.allowMultipleRecipients),
  });
}

function formatScheduledTime(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

function renderDelivery() {
  if (!elements.sendEmailButton) return;
  const mailto = state.settings.deliveryMethod === "mailto";
  const connected = !mailto && Boolean(state.googleAccount?.id);
  const recipients = deliveryRecipients();
  const options = [];
  if (mailto) options.push({ value: "", label: "Default email app" });
  else if (state.googleAccounts.length) options.push(...state.googleAccounts.map((account) => ({ value: account.id, label: account.email })));
  else options.push({ value: "", label: "Connect Gmail in Settings" });
  elements.deliveryAccount.replaceChildren(...options.map(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  elements.deliveryAccount.value = connected ? state.googleAccount.id : "";
  elements.deliveryAccount.disabled = mailto;
  elements.deliveryAccountButton.classList.toggle("is-connected", connected);
  elements.scheduleToggle.checked = !mailto && state.deliverySettings.scheduleEnabled;
  elements.scheduleTime.value = state.deliverySettings.scheduleTime;
  elements.scheduleToggle.disabled = !connected;
  elements.scheduleTime.disabled = !connected || !state.deliverySettings.scheduleEnabled;
  if (mailto) {
    elements.scheduleHint.textContent = "Manual send · scheduling unavailable";
    elements.sendEmailButton.textContent = recipients.length > 1 ? `Open ${recipients.length} emails` : "Open email app";
  } else if (!connected) {
    elements.scheduleHint.textContent = "Connect Gmail to schedule";
    elements.sendEmailButton.textContent = recipients.length > 1 ? `Open ${recipients.length} drafts` : "Open Gmail";
  } else if (state.deliverySettings.scheduleEnabled) {
    const next = nextScheduledAt(state.deliverySettings.scheduleTime);
    elements.scheduleHint.textContent = `Next occurrence · ${formatScheduledTime(next)} · stays on`;
    elements.sendEmailButton.textContent = recipients.length > 1 ? `Schedule to ${recipients.length}` : "Schedule send";
  } else {
    elements.scheduleHint.textContent = "Off · sends immediately";
    elements.sendEmailButton.textContent = recipients.length > 1 ? `Send to ${recipients.length}` : "Send email";
  }
  elements.sendEmailButton.disabled = state.deliveryLoading || !recipients.length || !state.subject.trim() || !state.body.trim();
  elements.sendEmailButton.title = !recipients.length
    ? !connected ? "Add a valid recipient email" : "Choose a verified recipient"
    : !connected
      ? mailto ? "Open a prefilled draft in the default email app" : "Open a prefilled Gmail draft and send it manually"
      : "";
}

function renderEmail() {
  elements.emailInput.value = state.email;
  if (!elements.findEmailButton.disabled) elements.findEmailButton.querySelector("span").textContent = state.email ? "Refresh" : "Find verified";
  elements.emailInput.classList.toggle("is-invalid", Boolean(state.email) && !isEmail(state.email));
  elements.emailSource.textContent = state.emailSource || "No contact provider has checked this profile yet";
  elements.emailConfidence.hidden = !state.emailVerified && state.emailType !== "linkedin";
  elements.emailConfidence.textContent = state.emailVerified ? "Provider verified" : state.emailType === "linkedin" ? "LinkedIn provided" : "";
  const remaining = Number(state.contactOutCreditsRemaining);
  elements.contactOutBalance.hidden = !Number.isFinite(remaining);
  elements.contactOutBalance.textContent = Number.isFinite(remaining) ? `${remaining.toLocaleString()} remaining` : "";
  const recipients = verifiedRecipientEmails();
  const selected = selectedRecipientEmails();
  const allowMultiple = Boolean(state.settings.allowMultipleRecipients);
  state.selectedRecipients = new Set(selected);
  elements.contactDetails.hidden = recipients.length === 0;
  const fragment = document.createDocumentFragment();
  if (recipients.length) {
    const head = document.createElement("div");
    head.className = "recipient-picker-head";
    const label = document.createElement("span");
    label.textContent = allowMultiple ? "Send to" : "Send to one";
    if (allowMultiple && recipients.length > 1) {
      const selectAll = document.createElement("button");
      selectAll.type = "button";
      selectAll.textContent = selected.length === recipients.length ? "All selected" : "Select all";
      selectAll.disabled = selected.length === recipients.length;
      selectAll.addEventListener("click", () => {
        state.selectedRecipients = new Set(recipients);
        renderEmail();
        queueDraftSave();
      });
      head.append(label, selectAll);
    } else {
      const mode = document.createElement("span");
      mode.className = "recipient-picker-mode";
      mode.textContent = "One recipient";
      head.append(label, mode);
    }
    fragment.append(head);
  }
  for (const email of recipients) {
    const option = document.createElement("label");
    option.className = `recipient-option${allowMultiple ? "" : " is-single"}`;
    const checkbox = document.createElement("input");
    checkbox.type = allowMultiple ? "checkbox" : "radio";
    if (!allowMultiple) checkbox.name = "verifiedRecipient";
    checkbox.checked = state.selectedRecipients.has(email);
    const mark = document.createElement("i");
    mark.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    const address = document.createElement("strong");
    address.textContent = email;
    const status = document.createElement("small");
    status.textContent = email === state.email ? "Primary · provider verified" : "Alternative · provider verified";
    copy.append(address, status);
    option.append(checkbox, mark, copy);
    checkbox.addEventListener("change", () => {
      if (!allowMultiple && checkbox.checked) state.selectedRecipients = new Set([email]);
      else if (checkbox.checked) state.selectedRecipients.add(email);
      else if (selectedRecipientEmails().length > 1) state.selectedRecipients.delete(email);
      else checkbox.checked = true;
      renderEmail();
      queueDraftSave();
    });
    fragment.append(option);
  }
  elements.contactDetails.replaceChildren(fragment);
  elements.contactStep.classList.toggle("is-complete", selectedRecipientEmails().length > 0);
  renderDelivery();
}

function renderExperiences() {
  const experiences = state.profile?.experiences || [];
  elements.signalCount.textContent = `${experiences.length} ${experiences.length === 1 ? "role" : "roles"}`;

  if (!experiences.length) {
    const empty = document.createElement("p");
    empty.className = "empty-signals";
    empty.textContent = "No structured experience was visible. Add a sharper personalization note above.";
    elements.experienceList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const experience of experiences.slice(0, 4)) {
    const item = document.createElement("article");
    item.className = "experience-item";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const company = document.createElement("span");
    const dates = document.createElement("time");
    title.textContent = experience.title || "Role";
    company.textContent = experience.company || "Company not visible";
    dates.textContent = experience.dates || "";
    copy.append(title, company);
    item.append(copy, dates);
    fragment.append(item);
  }
  elements.experienceList.replaceChildren(fragment);
}

function renderProfile() {
  const profile = state.profile;
  setText(elements.profileName, profile.name, "LinkedIn prospect");
  setText(elements.profileHeadline, profile.headline, "Work history visible on LinkedIn");
  setText(elements.profileLocationText, profile.location, "Location not visible");
  elements.avatar.textContent = initialsFor(profile.name);
  const statusDot = document.createElement("i");
  elements.captureStatus.replaceChildren(statusDot, document.createTextNode(state.isPreview ? " Demo data" : " Live page"));
  elements.workNote.value = state.note;
  elements.personalizationStep.classList.toggle("is-complete", Boolean(state.note));
  const savedProvider = state.emailSource.match(/(?:ContactOut|Apollo)/i)?.[0] || "provider";
  const savedContextLabel = state.emailVerified ? `verified ${savedProvider} research` : state.emailType === "linkedin" ? "LinkedIn profile context" : "profile context";
  elements.personalizationSource.textContent = state.personalizationModel
    ? `Written with ${state.personalizationModel} from ${savedContextLabel}`
    : state.emailVerified ? "Ready to write from verified research"
      : state.emailType === "linkedin" ? "Ready to write from LinkedIn Contact Info"
        : "Runs after an email is found";
  elements.templateSelect.value = state.templateId;
  renderEmail();
  renderExperiences();
}

function draftKey() {
  return `vela-gtm:draft:${encodeURIComponent(state.profile?.url || "unknown")}`;
}

async function loadDraft() {
  const key = draftKey();
  const saved = (await storage.get([key]))[key];
  if (!saved) {
    rebuildComposer();
    return;
  }

  const savedVerified = Boolean(saved.emailVerified);
  const savedManual = /^Entered manually\b/i.test(saved.emailSource || "");
  const savedLinkedIn = /^LinkedIn Contact Info\b/i.test(saved.emailSource || "");
  state.email = savedVerified || savedManual || savedLinkedIn ? saved.email || "" : state.email;
  state.emailSource = state.email ? saved.emailSource || "Saved locally" : state.emailSource;
  state.emailVerified = savedVerified;
  state.emailType = saved.emailType || "";
  state.contactDetails = saved.contactDetails || state.contactDetails;
  state.selectedRecipients = new Set(Array.isArray(saved.selectedRecipients) ? saved.selectedRecipients : []);
  state.confidence = saved.confidence ?? state.confidence;
  const savedNote = saved.note || state.note;
  state.note = normalizeWorkNote(savedNote, state.profile);
  state.templateId = state.templates.some((template) => template.id === saved.templateId) ? saved.templateId : state.templateId;
  state.subject = saved.subject || "";
  state.body = saved.body || "";
  const noteWasNormalized = Boolean(savedNote && state.note && savedNote !== state.note);
  if (noteWasNormalized && state.body.includes(savedNote)) state.body = state.body.replace(savedNote, state.note);
  const migratedDraft = migrateLegacyQuickIntroDraft(
    { subject: state.subject, body: state.body },
    templateVariables(state.profile, state.settings, state.note),
  );
  const draftWasMigrated = migratedDraft.subject !== state.subject || migratedDraft.body !== state.body;
  state.subject = migratedDraft.subject;
  state.body = migratedDraft.body;
  state.personalizationModel = saved.personalizationModel || "";
  state.composerDirty = Boolean(saved.subject || saved.body);

  renderProfile();
  if (state.subject && state.body) {
    elements.subjectInput.value = state.subject;
    elements.bodyInput.value = state.body;
    elements.templateEyebrow.textContent = activeTemplate().eyebrow;
    updateWordCount();
    if (noteWasNormalized || draftWasMigrated) queueDraftSave();
  } else {
    rebuildComposer();
  }
}

function queueDraftSave() {
  if (!state.profile) return;
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(async () => {
    await storage.set({
      [draftKey()]: {
        email: state.email,
        emailSource: state.emailSource,
        emailVerified: state.emailVerified,
        emailType: state.emailType,
        contactDetails: state.contactDetails,
        selectedRecipients: selectedRecipientEmails(),
        confidence: state.confidence,
        note: state.note,
        templateId: state.templateId,
        subject: state.subject,
        body: state.body,
        personalizationModel: state.personalizationModel,
        updatedAt: new Date().toISOString(),
      },
    });
  }, 250);
}

async function loadSettings() {
  const result = await storage.get([
    "velaGtmSettings",
    GOOGLE_ACCOUNTS_STORAGE_KEY,
    GOOGLE_ACCOUNT_STORAGE_KEY,
    GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY,
    DELIVERY_SETTINGS_KEY,
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...(result.velaGtmSettings || {}) };
  state.templates = emailTemplates(state.settings);
  state.templateId = state.templates[0]?.id || "";
  state.googleAccounts = normalizeGoogleAccounts(result[GOOGLE_ACCOUNTS_STORAGE_KEY], result[GOOGLE_ACCOUNT_STORAGE_KEY]);
  state.googleAccount = selectedGoogleAccount(state.googleAccounts, result[GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY], result[GOOGLE_ACCOUNT_STORAGE_KEY]);
  const storageNeedsMigration = JSON.stringify(result[GOOGLE_ACCOUNTS_STORAGE_KEY] || []) !== JSON.stringify(state.googleAccounts)
    || String(result[GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY] || "") !== String(state.googleAccount?.id || "")
    || (state.googleAccount && result[GOOGLE_ACCOUNT_STORAGE_KEY]?.id !== state.googleAccount.id);
  if (!state.isPreview && storageNeedsMigration) {
    await storage.set({
      [GOOGLE_ACCOUNTS_STORAGE_KEY]: state.googleAccounts,
      [GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY]: state.googleAccount?.id || "",
      ...(state.googleAccount ? { [GOOGLE_ACCOUNT_STORAGE_KEY]: state.googleAccount } : {}),
    });
  }
  state.deliverySettings = normalizeDeliverySettings(result[DELIVERY_SETTINGS_KEY]);
  if (state.isPreview && !state.googleAccount) {
    state.googleAccounts = [
      { id: "preview-tarun", email: "tarun@velaenergy.ai", authMode: "account-chooser" },
      { id: "preview-tony", email: "tony@velaenergy.ai", authMode: "account-chooser" },
    ];
    state.googleAccount = state.googleAccounts[0];
  }
  if (["light", "dark"].includes(previewTheme)) state.settings.theme = previewTheme;
  applyTheme(state.settings.theme);
  populateTemplates();
  if (state.profile) renderEmail();
  renderDelivery();
}

function linkedInProfileIdentity(url = "") {
  const match = String(url).match(/^https:\/\/(?:www\.)?linkedin\.com\/in\/([^/?#]+)/i);
  return match ? `https://www.linkedin.com/in/${match[1].toLowerCase()}` : "";
}

function isLinkedInProfile(url = "") {
  return Boolean(linkedInProfileIdentity(url));
}

async function requestProfileFromTab(tabId) {
  const message = { type: "VELA_GTM_EXTRACT_PROFILE" };
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/linkedin-parser.js", "content-script.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function getActiveProfile() {
  if (state.isPreview) return DEMO_PROFILE;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isLinkedInProfile(tab.url)) return null;
  state.activeTabId = tab.id;
  const response = await requestProfileFromTab(tab.id);
  if (!response?.ok) throw new Error(response?.error || "Could not read this LinkedIn profile.");
  return response.profile;
}

function originPatternFor(endpointUrl) {
  const url = new URL(endpointUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Use an http:// or https:// endpoint URL.");
  return `${url.protocol}//${url.host}/*`;
}

async function hasEndpointPermission(endpointUrl) {
  if (!globalThis.chrome?.permissions) return true;
  return chrome.permissions.contains({ origins: [originPatternFor(endpointUrl)] });
}

async function requestEndpointPermission(endpointUrl) {
  if (!globalThis.chrome?.permissions) return true;
  return chrome.permissions.request({ origins: [originPatternFor(endpointUrl)] });
}

function setFindEmailLoading(loading, label = state.email ? "Refresh" : "Find email") {
  elements.findEmailButton.disabled = loading;
  elements.findEmailButton.classList.toggle("is-loading", loading);
  elements.findEmailButton.querySelector("span").textContent = label;
}

function withTimeout(promise, timeout, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); }),
  ]).finally(() => clearTimeout(timer));
}

async function requestLinkedInEmail(tabId = state.activeTabId, profile = state.profile) {
  if (state.isPreview) return { ok: true, email: profile?.visibleEmail || "", strategy: "preview" };
  if (!tabId) throw new Error("Open a LinkedIn profile before using LinkedIn Contact Info.");
  const message = { type: "VELA_GTM_FIND_LINKEDIN_EMAIL" };
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/linkedin-parser.js", "content-script.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function enrichProfile({ requestPermission = true, manageButton = true, openSettingsWhenMissing = true, silent = false, replaceProviderResult = false, allowSessionReveal = false } = {}) {
  if (!state.profile) return;
  const profileAtStart = state.profile;
  const isCurrentProfile = () => state.profile === profileAtStart;
  const providerIds = configuredEnrichmentProviders(state.settings);
  const providers = providerIds.map(providerLabel);
  const provider = providers[0] || "";
  let resolvedProvider = provider;
  const direct = Boolean(providers.length && globalThis.chrome?.runtime?.sendMessage);
  if (!direct && !state.settings.endpointUrl) {
    if (openSettingsWhenMissing) {
      showToast("Add a ContactOut or Apollo API key in Settings first.");
      openSettings();
    }
    return false;
  }

  try {
    const priorProviderEmail = /^(ContactOut|Apollo)\b/i.test(state.emailSource || "")
      || (state.contactDetails.emails || []).includes(state.email);
    if (replaceProviderResult && priorProviderEmail) {
      state.email = "";
      state.emailSource = `Checking ${provider}…`;
      state.contactDetails = { emails: [], phones: [], emailStatus: "", emailStatuses: {}, error: "" };
      renderEmail();
    }
    if (manageButton) setFindEmailLoading(true, "Searching");
    let result;
    if (direct) {
      let lastError;
      const providerErrors = [];
      for (const providerId of providerIds) {
        const candidate = providerLabel(providerId);
        try {
          await appendDiagnostic({ area: "popup", stage: "provider_dispatch", outcome: "sent", provider: providerId, profileKind: isLinkedInProfile(profileAtStart.url) ? "linkedin_profile" : "invalid_profile" });
          if (!isCurrentProfile()) return false;
          const response = await withTimeout(
            chrome.runtime.sendMessage({ type: `VELA_GTM_PROVIDER_${providerId}`, profile: profileAtStart }),
            20000,
            `${candidate} lookup timed out.`,
          );
          if (!isCurrentProfile()) return false;
          if (!response?.ok) throw new Error(response?.error || `${candidate} lookup failed.`);
          let providerData = response.data;
          if (providerId === PROVIDER.CONTACTOUT_SESSION) {
            const credits = Number(providerData?.credits?.after ?? providerData?.credits?.before);
            if (Number.isFinite(credits)) state.contactOutCreditsRemaining = credits;
          }
          if (providerId === PROVIDER.CONTACTOUT_SESSION && providerData?.requiresReveal) {
            if (!allowSessionReveal) {
              state.emailSource = "ContactOut is ready. Click Find verified to reveal the best email.";
              state.contactDetails = { ...state.contactDetails, error: "" };
              renderEmail();
              return false;
            }
            const reveal = await withTimeout(
              chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_CONTACTOUT_SESSION_REVEAL", revealToken: providerData.revealToken }),
              20000,
              "ContactOut reveal timed out. Check your credit balance before retrying.",
            );
            if (!isCurrentProfile()) return false;
            if (!reveal?.ok) throw new Error(reveal?.error || "ContactOut reveal failed.");
            providerData = reveal.data;
            const credits = Number(providerData?.credits?.after ?? providerData?.credits?.before);
            if (Number.isFinite(credits)) state.contactOutCreditsRemaining = credits;
          }
          const candidateResult = normalizeEnrichmentResponse({ ...providerData, emailSource: providerData.source });
          const enrichedProfile = mergeEnrichedProfile(profileAtStart, candidateResult);
          Object.assign(profileAtStart, enrichedProfile);
          state.profile = profileAtStart;
          renderExperiences();
          const candidateStatus = String(candidateResult.emailStatuses?.[candidateResult.email] || candidateResult.emailStatus || "").toLowerCase();
          if (candidateResult.email && ["verified", "valid"].includes(candidateStatus)) {
            result = candidateResult;
            resolvedProvider = candidate;
            break;
          }
          lastError = new Error(`${candidate} did not return an explicitly verified email.`);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(`${candidate} lookup failed.`);
          providerErrors.push(`${candidate}: ${lastError.message}`);
          await appendDiagnostic({ area: "popup", stage: "provider_dispatch", outcome: "error", provider: providerId, message: lastError.message });
        }
      }
      if (!result) throw new Error(providerErrors.join(" · ") || lastError?.message || "No configured provider returned a verified email.");
    } else {
      let permitted = await hasEndpointPermission(state.settings.endpointUrl);
      if (!permitted && requestPermission) permitted = await requestEndpointPermission(state.settings.endpointUrl);
      if (!permitted) throw new Error("Vela GTM needs access to the enrichment endpoint.");
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (state.settings.apiToken) headers.Authorization = `Bearer ${state.settings.apiToken}`;
      const response = await fetch(state.settings.endpointUrl, { method: "POST", headers, body: JSON.stringify({ source: "vela-gtm-extension", profile: profileAtStart }) });
      if (!isCurrentProfile()) return false;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Enrichment service returned ${response.status}.`);
      result = normalizeEnrichmentResponse(payload);
    }
    if (!isCurrentProfile()) return false;
    const selectedStatus = String(result.emailStatuses?.[result.email] || result.emailStatus || "").toLowerCase();
    const fromProvider = direct || new RegExp(`^${resolvedProvider}\\b`, "i").test(result.emailSource || "");
    if (!result.email || !["verified", "valid"].includes(selectedStatus) || !fromProvider) {
      state.email = "";
      state.emailVerified = false;
      state.emailType = "";
      state.emailSource = `No verified email found by ${resolvedProvider}`;
      state.contactDetails = { emails: [], phones: [], emailStatus: "", emailStatuses: {}, error: `${providers.join(" or ")} did not return an explicitly verified address.` };
      renderEmail();
      queueDraftSave();
      throw new Error(`${resolvedProvider} did not return a verified email for this profile.`);
    }

    state.email = result.email;
    state.emailVerified = true;
    state.selectedRecipients = new Set([state.email]);
    state.emailType = result.workEmails?.includes(result.email) ? "work" : result.personalEmails?.includes(result.email) ? "personal" : "other";
    state.emailSource = `${state.emailType === "work" ? "Work" : state.emailType === "personal" ? "Personal" : "Contact"} email confirmed by ${resolvedProvider}`;
    state.confidence = result.confidence;
    state.contactDetails = { emails: result.emails, phones: [], emailStatus: selectedStatus, emailStatuses: result.emailStatuses, error: "" };
    renderEmail();
    queueDraftSave();
    if (!silent) showToast(`Verified ${resolvedProvider} email found. Writing personalization…`);
    return result;
  } catch (error) {
    if (!isCurrentProfile()) return false;
    const message = error instanceof Error ? error.message : "Enrichment failed. Check Settings.";
    state.emailSource = message;
    state.contactDetails = { ...state.contactDetails, error: message };
    renderEmail();
    if (!silent) showToast(message);
    return false;
  } finally {
    if (manageButton && isCurrentProfile()) setFindEmailLoading(false);
  }
}

async function findProspectEmail({ automatic = false, personalize = true } = {}) {
  if (!state.profile) return;
  const profileAtStart = state.profile;
  const activeTabIdAtStart = state.activeTabId;
  const isCurrentProfile = () => state.profile === profileAtStart;
  setFindEmailLoading(true, "Looking up");
  await appendDiagnostic({
    area: "popup", stage: "lookup_start", outcome: automatic ? "automatic" : "manual",
    provider: configuredEnrichmentProviders(state.settings).join("+"), profileKind: isLinkedInProfile(profileAtStart.url) ? "linkedin_profile" : "invalid_profile",
  });
  if (!isCurrentProfile()) return false;

  try {
    const resolution = await resolveContactEmail({
      contactOutLookup: async () => {
        if (!isCurrentProfile()) throw new Error("Profile changed during lookup.");
        if (!state.settings.contactOutSessionEnabled && !state.settings.contactOutApiKey && !state.settings.apolloApiKey && !state.settings.endpointUrl) throw new Error("No contact provider is configured.");
        state.emailSource = `${[state.settings.contactOutSessionEnabled ? "ContactOut session" : "", state.settings.contactOutApiKey ? "ContactOut API" : "", state.settings.apolloApiKey ? "Apollo" : ""].filter(Boolean).join(" + ")} is checking this profile…`;
        renderEmail();
        const found = await enrichProfile({
          requestPermission: !automatic,
          manageButton: false,
          openSettingsWhenMissing: false,
          silent: true,
          replaceProviderResult: true,
          allowSessionReveal: true,
        });
        if (!isCurrentProfile()) throw new Error("Profile changed during lookup.");
        if (found && state.emailVerified && state.email) return { email: state.email, result: found };
        throw new Error(state.contactDetails.error || `${[state.settings.contactOutSessionEnabled ? "ContactOut session" : "", state.settings.contactOutApiKey ? "ContactOut API" : "", state.settings.apolloApiKey ? "Apollo" : ""].filter(Boolean).join(" or ")} did not return a verified email for this profile.`);
      },
      linkedInLookup: async () => {
        if (!isCurrentProfile()) throw new Error("Profile changed during lookup.");
        await appendDiagnostic({ area: "popup", stage: "linkedin_fallback", outcome: "started", profileKind: isLinkedInProfile(profileAtStart.url) ? "linkedin_profile" : "invalid_profile" });
        if (!isCurrentProfile()) throw new Error("Profile changed during lookup.");
        state.emailSource = "Configured providers did not find an email. Checking LinkedIn Contact Info…";
        renderEmail();
        const response = await withTimeout(
          requestLinkedInEmail(activeTabIdAtStart, profileAtStart),
          12000,
          "LinkedIn Contact Info did not respond within 12 seconds.",
        );
        if (!isCurrentProfile()) throw new Error("Profile changed during lookup.");
        if (!response?.ok) throw new Error(response?.error || "Could not read LinkedIn Contact Info.");
        return response;
      },
    });
    if (!isCurrentProfile()) return false;

    if (!resolution.email) {
      await appendDiagnostic({ area: "popup", stage: "lookup_complete", outcome: "no_email", message: [resolution.contactOutError, resolution.linkedInError].filter(Boolean).join("; ") });
      const details = [resolution.contactOutError, resolution.linkedInError].filter(Boolean).join(" LinkedIn fallback: ");
      state.email = "";
      state.emailVerified = false;
      state.emailType = "";
      state.emailSource = "No email found through the configured providers or LinkedIn Contact Info";
      state.contactDetails = { ...state.contactDetails, error: details };
      renderEmail();
      queueDraftSave();
      if (!automatic) showToast(details || state.emailSource);
      return false;
    }

    if (resolution.source === "linkedin") {
      await appendDiagnostic({ area: "popup", stage: "linkedin_fallback", outcome: "email_visible_unverified" });
      state.email = resolution.email;
      state.emailVerified = false;
      state.selectedRecipients = new Set();
      state.emailType = "linkedin";
      state.emailSource = resolution.strategy === "rsc" ? "LinkedIn Contact Info" : "LinkedIn Contact Info overlay";
      state.confidence = null;
      state.contactDetails = { ...state.contactDetails, error: "" };
      renderEmail();
      queueDraftSave();
    }

    let written = false;
    if (personalize) {
      setFindEmailLoading(true, "Personalizing");
      written = await generateEmail({ silent: automatic, announce: false });
    }
    if (!isCurrentProfile()) return false;
    if (!automatic) {
      const lookupLabel = resolution.source === "contactout" ? `${state.emailSource.match(/(?:ContactOut|Apollo)/i)?.[0] || "Provider"} email` : "LinkedIn Contact Info email";
      showToast(written ? `${lookupLabel} and AI personalization are ready.` : `${lookupLabel} found. Configure the AI writer to personalize it.`);
    }
    return true;
  } catch (error) {
    if (!isCurrentProfile()) return false;
    await appendDiagnostic({ area: "popup", stage: "lookup_complete", outcome: "error", message: error instanceof Error ? error.message : "Could not finish email lookup." });
    renderEmail();
    if (!automatic) showToast(error instanceof Error ? error.message : "Could not finish email lookup.");
    return false;
  } finally {
    if (isCurrentProfile()) setFindEmailLoading(false);
  }
}

function setWriterLoading(loading) {
  for (const button of [elements.generateEmailButton, elements.rewritePersonalizationButton]) {
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    const label = button.querySelector("span");
    if (label) label.textContent = loading ? "Writing" : button === elements.generateEmailButton ? "Write with AI" : "Rewrite with AI";
  }
}

async function generateEmail({ silent = false, announce = true } = {}) {
  if (!state.profile) return;
  const profileAtStart = state.profile;
  const isCurrentProfile = () => state.profile === profileAtStart;
  if (!state.settings.openAIApiKey && !state.settings.writerEndpointUrl) {
    if (!silent) { showToast("Add an OpenAI key or writer endpoint in Settings first."); openSettings(); }
    return false;
  }

  try {
    setWriterLoading(true);

    const input = buildWriterRequest(profileAtStart, state.settings, state.note, { subject: state.subject, body: state.body });
    let payload;
    if (state.settings.openAIApiKey) {
      const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_WRITE", input });
      if (!isCurrentProfile()) return false;
      if (!response?.ok) throw new Error(response?.error || "OpenAI writing failed.");
      payload = { data: response.data, model: state.settings.openAIModel || "gpt-5.4-mini" };
    } else {
      let permitted = await hasEndpointPermission(state.settings.writerEndpointUrl);
      if (!permitted) permitted = await requestEndpointPermission(state.settings.writerEndpointUrl);
      if (!isCurrentProfile()) return false;
      if (!permitted) throw new Error("Vela GTM needs access to the AI writer endpoint.");
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (state.settings.writerToken) headers.Authorization = `Bearer ${state.settings.writerToken}`;
      const response = await fetch(state.settings.writerEndpointUrl, { method: "POST", headers, body: JSON.stringify(input) });
      payload = await response.json().catch(() => ({}));
      if (!isCurrentProfile()) return false;
      if (!response.ok) throw new Error(payload.error || `AI writer returned ${response.status}.`);
    }
    const result = normalizeWriterResponse(payload, profileAtStart);
    if (!result.subject || !result.body) throw new Error("The AI writer returned an incomplete draft.");
    const openerIssues = openerQualityIssues(result.workNote);
    if (openerIssues.length) throw new Error(`The AI writer returned a generic opener. ${openerIssues.join(" ")}`);
    if (result.workNote) {
      state.note = result.workNote;
      elements.workNote.value = result.workNote;
      elements.personalizationStep.classList.add("is-complete");
    }
    if (state.settings.aiGenerationMode === "full") {
      state.subject = result.subject;
      state.body = result.body;
      state.composerDirty = true;
    } else {
      rebuildComposer({ markClean: true });
    }
    state.personalizationModel = result.model || state.settings.openAIModel || "gpt-5.4-mini";
    const providerLabel = state.emailSource.match(/(?:ContactOut|Apollo)/i)?.[0] || "provider";
    const contextLabel = state.emailVerified ? `verified ${providerLabel} research` : state.emailType === "linkedin" ? "LinkedIn profile context" : "profile context";
    elements.personalizationSource.textContent = `Written with ${state.personalizationModel} from ${contextLabel}`;
    elements.subjectInput.value = state.subject;
    elements.bodyInput.value = state.body;
    elements.templateEyebrow.textContent = `Written with ${result.model || "gpt-5.4-mini"}`;
    updateWordCount();
    queueDraftSave();
    if (announce) showToast(state.settings.aiGenerationMode === "full" ? "AI opener and email draft are ready." : "AI opener updated from this prospect's context.");
    return true;
  } catch (error) {
    if (!isCurrentProfile()) return false;
    if (!silent) showToast(error instanceof Error ? error.message : "Could not generate the email.");
    return false;
  } finally {
    if (isCurrentProfile()) setWriterLoading(false);
  }
}

function switchTab(tabName) {
  if (tabName === "draft") elements.emailDraftDisclosure.open = true;
}

async function copyText(text, successMessage) {
  if (!text) {
    showToast("There’s nothing to copy yet.");
    return;
  }
  await navigator.clipboard.writeText(text);
  showToast(successMessage);
}

function openSettings() {
  if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open("options.html", "_blank", "noopener,noreferrer");
}

function currentProspect() {
  return {
    url: state.profile.url,
    name: state.profile.name,
    headline: state.profile.headline,
    location: state.profile.location,
    email: state.email,
    emailSource: state.emailSource,
    contactDetails: state.contactDetails,
    workNote: state.note,
    subject: state.subject,
    body: state.body,
    profile: state.profile,
  };
}

function updateCampaignButton() {
  if (!state.profile) return;
  const memberships = campaignsForProspect(state.campaigns, state.profile.url);
  const strong = elements.addToCampaignButton.querySelector("strong");
  const small = elements.addToCampaignButton.querySelector("small");
  elements.addToCampaignButton.classList.toggle("is-saved", memberships.length > 0);
  strong.textContent = memberships.length ? `Saved to ${memberships.length} campaign${memberships.length === 1 ? "" : "s"}` : "Add to campaign";
  small.textContent = memberships.length ? "Profile and note are synced" : "Save this profile and note";
}

function renderCampaignList() {
  const memberships = new Set(campaignsForProspect(state.campaigns, state.profile?.url).map((campaign) => campaign.id));
  const fragment = document.createDocumentFragment();
  for (const campaign of state.campaigns) {
    const added = memberships.has(campaign.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `campaign-option${added ? " is-added" : ""}`;
    button.setAttribute("aria-pressed", String(added));
    const mark = document.createElement("span");
    mark.className = "campaign-option-mark";
    mark.textContent = campaign.name.slice(0, 2).toUpperCase();
    const copy = document.createElement("span");
    copy.className = "campaign-option-copy";
    const name = document.createElement("strong");
    name.textContent = campaign.name;
    const count = document.createElement("small");
    count.textContent = `${campaign.prospectIds.length} prospect${campaign.prospectIds.length === 1 ? "" : "s"}`;
    copy.append(name, count);
    const status = document.createElement("span");
    status.className = "campaign-option-status";
    status.textContent = added ? "Added" : "Add";
    button.append(mark, copy, status);
    button.addEventListener("click", async () => {
      state.lastCampaignId = campaign.id;
      if (!added) await saveToCampaign(campaign.id);
      else showToast(`Already saved to ${campaign.name}.`);
    });
    fragment.append(button);
  }
  if (!state.campaigns.length) {
    const empty = document.createElement("p");
    empty.className = "campaign-empty";
    empty.textContent = "No campaigns yet. Create one below and this person will be added immediately.";
    fragment.append(empty);
  }
  elements.campaignList.replaceChildren(fragment);
  updateCampaignButton();
}

async function loadCampaigns() {
  const saved = await storage.get([CAMPAIGNS_STORAGE_KEY]);
  state.campaigns = normalizeCampaigns(saved[CAMPAIGNS_STORAGE_KEY] || []);
  if (state.isPreview && !state.campaigns.length) {
    state.campaigns = [
      createCampaign({ id: "data-center-operators", name: "Data center operators" }),
      createCampaign({ id: "energy-buyers", name: "Energy buyers" }),
    ];
  }
  renderCampaignList();
}

async function saveToCampaign(campaignId) {
  if (!state.profile) return;
  state.note = elements.workNote.value.trim();
  const saved = await storage.get([QUEUE_STORAGE_KEY]);
  const queue = upsertProspects(saved[QUEUE_STORAGE_KEY] || [], [currentProspect()]);
  state.campaigns = addProspectToCampaign(state.campaigns, campaignId, state.profile.url);
  await storage.set({ [QUEUE_STORAGE_KEY]: queue, [CAMPAIGNS_STORAGE_KEY]: state.campaigns });
  state.lastCampaignId = campaignId;
  const campaign = state.campaigns.find((item) => item.id === campaignId);
  renderCampaignList();
  showToast(`Added to ${campaign?.name || "campaign"} with your note.`);
}

function openCampaignDialog() {
  renderCampaignList();
  elements.campaignDialog.showModal();
  if (!state.campaigns.length) setTimeout(() => elements.newCampaignName.focus(), 0);
}

async function openCampaigns(campaignId = "") {
  const page = new URL("dashboard.html", location.href);
  if (campaignId) page.searchParams.set("campaign", campaignId);
  if (globalThis.chrome?.tabs?.create) await chrome.tabs.create({ url: chrome.runtime.getURL(`${page.pathname.split("/").pop()}${page.search}`) });
  else window.open(page.toString(), "_blank", "noopener,noreferrer");
}

async function saveDeliverySettings() {
  await storage.set({ [DELIVERY_SETTINGS_KEY]: state.deliverySettings });
}

async function deliverEmail() {
  const mailto = state.settings.deliveryMethod === "mailto";
  const connected = !mailto && Boolean(state.googleAccount?.id);
  const recipients = deliveryRecipients();
  if (!recipients.length) { showToast(!connected ? "Add a valid recipient email." : "Choose at least one provider-verified email."); return; }
  if (!state.subject.trim() || !state.body.trim()) { showToast("Add a subject and message before sending."); return; }

  const prospect = currentProspect();
  const prospectId = prospectIdentity(prospect);
  const saved = await storage.get([QUEUE_STORAGE_KEY]);
  await storage.set({ [QUEUE_STORAGE_KEY]: upsertProspects(saved[QUEUE_STORAGE_KEY] || [], [prospect]) });

  if (!connected) {
    const composeUrls = recipients.map((recipient) => (mailto ? mailtoComposeUrl : gmailComposeUrl)({
      to: recipient,
      subject: state.subject,
      body: state.body,
    }));
    try {
      state.deliveryLoading = true;
      renderDelivery();
      if (globalThis.chrome?.tabs?.create) {
        for (const [index, url] of composeUrls.entries()) await chrome.tabs.create({ url, active: index === 0 });
      } else {
        composeUrls.forEach((url) => window.open(url, "_blank", "noopener,noreferrer"));
      }
      showToast(mailto
        ? `Opened ${composeUrls.length} draft${composeUrls.length === 1 ? "" : "s"} in your email app.`
        : `Opened ${composeUrls.length} Gmail draft${composeUrls.length === 1 ? "" : "s"} for review and manual send.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Could not open ${mailto ? "the email app" : "Gmail"}.`);
    } finally {
      state.deliveryLoading = false;
      renderDelivery();
    }
    return;
  }

  const delivery = {
    accountId: state.googleAccount.id,
    senderEmail: state.googleAccount.email || "",
    recipients,
    subject: state.subject,
    body: state.body,
    prospectId,
  };
  if (state.deliverySettings.scheduleEnabled) delivery.scheduledAt = nextScheduledAt(state.deliverySettings.scheduleTime).toISOString();

  if (state.isPreview) {
    const action = state.deliverySettings.scheduleEnabled ? `Scheduled for ${formatScheduledTime(new Date(delivery.scheduledAt))}` : "Sent";
    showToast(`${action} to ${recipients.length} verified address${recipients.length === 1 ? "" : "es"}.`);
    return;
  }

  try {
    state.deliveryLoading = true;
    renderDelivery();
    const response = await chrome.runtime.sendMessage({
      type: state.deliverySettings.scheduleEnabled ? "VELA_GTM_EMAIL_SCHEDULE" : "VELA_GTM_EMAIL_SEND",
      delivery,
    });
    if (!response?.ok) throw new Error(response?.error || "Gmail delivery failed.");
    if (state.deliverySettings.scheduleEnabled) {
      showToast(`Scheduled for ${formatScheduledTime(new Date(response.data.scheduledAt))}. Scheduling stays on.`);
    } else {
      const sent = response.data.sent?.length || 0;
      const failed = response.data.failed?.length || 0;
      showToast(failed ? `Sent to ${sent}; ${failed} failed.` : `Sent to ${sent} verified address${sent === 1 ? "" : "es"}.`);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Gmail delivery failed.");
  } finally {
    state.deliveryLoading = false;
    renderDelivery();
  }
}

function bindEvents() {
  elements.settingsButton.addEventListener("click", openSettings);
  elements.queueButton.addEventListener("click", () => openCampaigns());
  elements.gateWorkspaceButton.addEventListener("click", () => openCampaigns());
  elements.addToCampaignButton.addEventListener("click", openCampaignDialog);
  elements.closeCampaignDialog.addEventListener("click", () => elements.campaignDialog.close());
  elements.openCampaignWorkspace.addEventListener("click", () => openCampaigns(state.lastCampaignId));
  elements.createCampaignForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = elements.newCampaignName.value.trim();
    if (!name) { elements.newCampaignName.focus(); return; }
    let campaign = state.campaigns.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!campaign) {
      campaign = createCampaign({ name });
      state.campaigns = [...state.campaigns, campaign];
    }
    elements.newCampaignName.value = "";
    await saveToCampaign(campaign.id);
  });
  elements.templateSelect.addEventListener("change", () => {
    state.templateId = elements.templateSelect.value;
    state.composerDirty = false;
    rebuildComposer();
  });

  elements.workNote.addEventListener("input", () => {
    const previousNote = state.note;
    state.note = elements.workNote.value.trim();
    elements.personalizationStep.classList.toggle("is-complete", Boolean(state.note));
    if (!state.composerDirty) rebuildComposer();
    else if (previousNote && state.body.includes(previousNote)) {
      state.body = state.body.replace(previousNote, state.note);
      elements.bodyInput.value = state.body;
      updateWordCount();
    }
    queueDraftSave();
  });

  elements.subjectInput.addEventListener("input", () => {
    state.subject = elements.subjectInput.value;
    state.composerDirty = true;
    queueDraftSave();
    renderDelivery();
  });

  elements.bodyInput.addEventListener("input", () => {
    state.body = elements.bodyInput.value;
    state.composerDirty = true;
    updateWordCount();
    queueDraftSave();
    renderDelivery();
  });

  elements.emailInput.addEventListener("input", () => {
    state.email = elements.emailInput.value.trim();
    state.emailSource = state.email ? "Entered manually · not provider verified" : "No contact provider has checked this profile yet";
    state.emailVerified = false;
    state.selectedRecipients = new Set();
    state.emailType = "";
    state.confidence = null;
    renderEmail();
    queueDraftSave();
  });

  elements.findEmailButton.addEventListener("click", () => findProspectEmail());
  elements.generateEmailButton.addEventListener("click", () => generateEmail());
  elements.rewritePersonalizationButton.addEventListener("click", () => generateEmail());
  elements.copyEmailButton.addEventListener("click", () => copyText(elements.emailInput.value.trim(), "Email copied."));
  elements.copyDraftButton.addEventListener("click", () =>
    copyText(`To: ${deliveryRecipients().join(", ")}\nSubject: ${state.subject}\n\n${state.body}`, "Draft copied."),
  );
  elements.deliveryAccountButton.addEventListener("pointerdown", (event) => {
    if (state.settings.deliveryMethod !== "mailto" && !state.googleAccounts.length) {
      event.preventDefault();
      openSettings();
    }
  });
  elements.deliveryAccount.addEventListener("change", async () => {
    const selected = selectedGoogleAccount(state.googleAccounts, elements.deliveryAccount.value);
    if (!selected) { openSettings(); return; }
    state.googleAccount = selected;
    await storage.set({
      [GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY]: selected.id,
      [GOOGLE_ACCOUNT_STORAGE_KEY]: selected,
    });
    renderDelivery();
    showToast(`Sending from ${selected.email}.`);
  });
  elements.scheduleToggle.addEventListener("change", async () => {
    state.deliverySettings = { ...state.deliverySettings, scheduleEnabled: elements.scheduleToggle.checked };
    await saveDeliverySettings();
    renderDelivery();
  });
  elements.scheduleTime.addEventListener("change", async () => {
    state.deliverySettings = normalizeDeliverySettings({ ...state.deliverySettings, scheduleTime: elements.scheduleTime.value });
    await saveDeliverySettings();
    renderDelivery();
  });
  elements.sendEmailButton.addEventListener("click", deliverEmail);
}

function resetProfileWorkspace() {
  clearTimeout(state.draftTimer);
  setFindEmailLoading(false, "Find verified");
  setWriterLoading(false);
  state.draftTimer = null;
  state.profile = null;
  state.activeTabId = null;
  state.email = "";
  state.emailSource = "No contact provider has checked this profile yet";
  state.emailVerified = false;
  state.emailType = "";
  state.contactDetails = { emails: [], phones: [], emailStatus: "", emailStatuses: {}, error: "" };
  state.confidence = null;
  state.selectedRecipients = new Set();
  state.note = "";
  state.subject = "";
  state.body = "";
  state.personalizationModel = "";
  state.composerDirty = false;
  state.contactOutCreditsRemaining = null;
}

async function refreshActiveProfile() {
  const refreshSequence = ++state.refreshSequence;
  showView("loading");
  try {
    resetProfileWorkspace();
    const profile = await getActiveProfile();
    if (refreshSequence !== state.refreshSequence) return;
    if (!profile) {
      showView("gate");
      return;
    }

    state.profile = profile;
    elements.previewBadge.hidden = !state.isPreview;
    renderProfile();
    await loadDraft();
    if (refreshSequence !== state.refreshSequence) return;
    if (state.isPreview && !state.email) {
      state.contactOutCreditsRemaining = 1683;
      state.email = state.profile.visibleEmail;
      state.emailVerified = true;
      state.emailType = "work";
      state.emailSource = "Work email confirmed by ContactOut";
      state.contactDetails = {
        emails: [state.email, "joshua.rivera@streamdatacenters.com"],
        emailStatuses: { [state.email]: "verified", "joshua.rivera@streamdatacenters.com": "valid" },
        error: "",
      };
      state.selectedRecipients = new Set([state.email]);
      renderProfile();
    }
    await loadCampaigns();
    if (refreshSequence !== state.refreshSequence) return;
    showView("workspace");
    if (previewTab === "draft") switchTab("draft");

    if (!state.isPreview) {
      const lookupKey = linkedInProfileIdentity(state.profile.url);
      if (lookupKey && !state.autoLookupAttempts.has(lookupKey)) {
        state.autoLookupAttempts.add(lookupKey);
        runAutomaticProfileWorkflow({
          researchEnabled: Boolean(state.settings.autoEnrich),
          hasVerifiedEmail: state.emailVerified,
          research: () => findProspectEmail({ automatic: true, personalize: false }),
          write: () => generateEmail({ silent: true, announce: false }),
        }).catch(() => {});
      }
    }
  } catch (error) {
    if (refreshSequence !== state.refreshSequence) return;
    showView("gate");
    showToast(error instanceof Error ? error.message : "Could not read this profile.");
  }
}

function queueActiveProfileRefresh(delay = 180) {
  if (state.isPreview) return;
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => refreshActiveProfile(), delay);
}

async function initialize() {
  bindEvents();
  await loadSettings();
  await loadCampaigns();
  await refreshActiveProfile();

  if (!state.isPreview) {
    chrome.tabs.onActivated.addListener(() => queueActiveProfileRefresh());
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!tab.active || (!changeInfo.url && changeInfo.status !== "complete")) return;
      const currentIdentity = linkedInProfileIdentity(state.profile?.url);
      const nextIdentity = linkedInProfileIdentity(changeInfo.url || tab.url);
      if (tabId === state.activeTabId && (!changeInfo.url || currentIdentity === nextIdentity)) return;
      queueActiveProfileRefresh(changeInfo.url ? 80 : 180);
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes.velaGtmSettings || changes[GOOGLE_ACCOUNTS_STORAGE_KEY] || changes[GOOGLE_ACCOUNT_STORAGE_KEY] || changes[GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY] || changes[DELIVERY_SETTINGS_KEY]) {
        loadSettings().catch(() => {});
      }
      if (changes[CAMPAIGNS_STORAGE_KEY]) {
        state.campaigns = normalizeCampaigns(changes[CAMPAIGNS_STORAGE_KEY].newValue || []);
        renderCampaignList();
      }
    });
  }
}

applyTheme(DEFAULT_SETTINGS.theme);
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.settings.theme === "system") applyTheme("system");
});
initialize();
