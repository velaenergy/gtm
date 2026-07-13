import {
  DEFAULT_SETTINGS,
  TEMPLATES,
  applyTemplate,
  buildWorkNote,
  gmailComposeUrl,
  initialsFor,
  isEmail,
  normalizeEnrichmentResponse,
  resolveTheme,
  templateVariables,
} from "./lib/message.js";
import { buildWriterRequest, normalizeWriterResponse } from "./lib/ai-writer.js";
import { QUEUE_STORAGE_KEY, upsertProspects } from "./lib/queue.js";

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
    "loadingView", "pageGate", "workspace", "actionBar", "previewBadge", "settingsButton", "queueButton", "captureStatus",
    "avatar", "profileName", "profileHeadline", "profileLocationText", "emailSource", "emailConfidence", "emailInput",
    "findEmailButton", "copyEmailButton", "contactDetails", "workNote", "signalCount", "experienceList", "templateSelect",
    "templateEyebrow", "generateEmailButton", "subjectInput", "bodyInput", "wordCount", "copyDraftButton", "openGmailButton", "toast",
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  email: "",
  emailSource: "",
  contactDetails: { emails: [], phones: [], emailStatus: "" },
  confidence: null,
  note: "",
  templateId: TEMPLATES[0].id,
  subject: "",
  body: "",
  composerDirty: false,
  draftTimer: null,
  toastTimer: null,
  activeTabId: null,
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
  for (const template of TEMPLATES) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    fragment.append(option);
  }
  elements.templateSelect.replaceChildren(fragment);
}

function activeTemplate() {
  return TEMPLATES.find((template) => template.id === state.templateId) || TEMPLATES[0];
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
}

function renderEmail() {
  elements.emailInput.value = state.email;
  elements.emailInput.classList.toggle("is-invalid", Boolean(state.email) && !isEmail(state.email));
  elements.emailSource.textContent = state.emailSource || "Not found yet";
  elements.emailConfidence.hidden = state.confidence === null;
  elements.emailConfidence.textContent = state.confidence === null ? "" : `${Math.round(state.confidence)}% confidence`;
  const details = [];
  for (const email of state.contactDetails.emails || []) details.push({ value: email, primary: email === state.email });
  for (const phone of state.contactDetails.phones || []) details.push({ value: phone, primary: false });
  elements.contactDetails.hidden = details.length < 2 && !state.contactDetails.emailStatus;
  const fragment = document.createDocumentFragment();
  for (const detail of details) {
    const chip = document.createElement("span");
    chip.className = `contact-detail${detail.primary ? " is-primary" : ""}`;
    chip.textContent = detail.value;
    fragment.append(chip);
  }
  if (state.contactDetails.emailStatus) {
    const chip = document.createElement("span");
    chip.className = "contact-detail";
    chip.textContent = state.contactDetails.emailStatus;
    fragment.append(chip);
  }
  elements.contactDetails.replaceChildren(fragment);
}

function renderExperiences() {
  const experiences = state.profile?.experiences || [];
  elements.signalCount.textContent = `${experiences.length} found`;

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

  state.email = saved.email || state.email;
  state.emailSource = saved.email ? saved.emailSource || "Saved locally" : state.emailSource;
  state.confidence = saved.confidence ?? state.confidence;
  state.note = saved.note || state.note;
  state.templateId = TEMPLATES.some((template) => template.id === saved.templateId) ? saved.templateId : state.templateId;
  state.subject = saved.subject || "";
  state.body = saved.body || "";
  state.composerDirty = Boolean(saved.subject || saved.body);

  renderProfile();
  if (state.subject && state.body) {
    elements.subjectInput.value = state.subject;
    elements.bodyInput.value = state.body;
    elements.templateEyebrow.textContent = activeTemplate().eyebrow;
    updateWordCount();
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
        confidence: state.confidence,
        note: state.note,
        templateId: state.templateId,
        subject: state.subject,
        body: state.body,
        updatedAt: new Date().toISOString(),
      },
    });
  }, 250);
}

async function loadSettings() {
  const result = await storage.get(["velaGtmSettings"]);
  state.settings = { ...DEFAULT_SETTINGS, ...(result.velaGtmSettings || {}) };
  if (["light", "dark"].includes(previewTheme)) state.settings.theme = previewTheme;
  applyTheme(state.settings.theme);
}

function isLinkedInProfile(url = "") {
  return /^https:\/\/www\.linkedin\.com\/in\/[^/?#]+/i.test(url);
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

function setFindEmailLoading(loading, label = "Retry lookup") {
  elements.findEmailButton.disabled = loading;
  elements.findEmailButton.classList.toggle("is-loading", loading);
  elements.findEmailButton.querySelector("span").textContent = label;
}

async function enrichProfile({ requestPermission = true, manageButton = true, openSettingsWhenMissing = true, silent = false } = {}) {
  if (!state.profile) return;
  const direct = Boolean(state.settings.contactOutApiKey && globalThis.chrome?.runtime?.sendMessage);
  if (!direct && !state.settings.endpointUrl) {
    if (openSettingsWhenMissing) {
      showToast("Add an enrichment webhook in Settings first.");
      openSettings();
    }
    return false;
  }

  try {
    if (manageButton) setFindEmailLoading(true, "Searching");
    let payload;
    if (direct) {
      const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_CONTACTOUT", profile: state.profile });
      if (!response?.ok) throw new Error(response?.error || "ContactOut lookup failed.");
      payload = { ...response.data, emailSource: response.data.source };
    } else {
      let permitted = await hasEndpointPermission(state.settings.endpointUrl);
      if (!permitted && requestPermission) permitted = await requestEndpointPermission(state.settings.endpointUrl);
      if (!permitted) throw new Error("Vela GTM needs access to the enrichment endpoint.");
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (state.settings.apiToken) headers.Authorization = `Bearer ${state.settings.apiToken}`;
      const response = await fetch(state.settings.endpointUrl, { method: "POST", headers, body: JSON.stringify({ source: "vela-gtm-extension", profile: state.profile }) });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Enrichment service returned ${response.status}.`);
    }
    const result = normalizeEnrichmentResponse(payload);
    if (!result.email && !result.note) throw new Error("The service returned no email or note.");

    if (result.email) {
      state.email = result.email;
      state.emailSource = result.emailSource || "Enrichment service";
      state.confidence = result.confidence;
    }
    state.contactDetails = { emails: result.emails, phones: result.phones, emailStatus: result.emailStatus };
    if (result.note) {
      state.note = result.note;
      elements.workNote.value = state.note;
      if (!state.composerDirty) rebuildComposer();
    }
    renderEmail();
    queueDraftSave();
    if (!silent) showToast(result.email ? "Email found and added to the draft." : "Research note refreshed.");
    return Boolean(result.email || result.note);
  } catch (error) {
    if (!silent) showToast(error instanceof Error ? error.message : "Enrichment failed. Check Settings.");
    return false;
  } finally {
    if (manageButton) setFindEmailLoading(false);
  }
}

async function findProspectEmail({ automatic = false } = {}) {
  if (!state.profile) return;
  let contactOutError = "";
  setFindEmailLoading(true, "Looking up");

  try {
    if (state.settings.contactOutApiKey || state.settings.endpointUrl) {
      state.emailSource = "Checking ContactOut…";
      renderEmail();
      const permitted = state.settings.contactOutApiKey || await hasEndpointPermission(state.settings.endpointUrl).catch(() => false);
      if (permitted || !automatic) {
        const found = await enrichProfile({
          requestPermission: !automatic,
          manageButton: false,
          openSettingsWhenMissing: false,
          silent: automatic,
        });
        if (found && state.email) return;
      } else {
        contactOutError = "ContactOut server access has not been granted.";
      }
    }

    state.emailSource = "Checking LinkedIn contact info…";
    renderEmail();
    if (!state.isPreview && state.activeTabId) {
      const response = await chrome.tabs.sendMessage(state.activeTabId, { type: "VELA_GTM_FIND_LINKEDIN_EMAIL" });
      if (response?.email) {
        state.email = response.email;
        state.emailSource = "LinkedIn contact info";
        state.confidence = null;
        renderEmail();
        queueDraftSave();
        if (!automatic) showToast("Email found in LinkedIn Contact info.");
        return;
      }
      if (!response?.ok) throw new Error(response?.error || "Could not read LinkedIn Contact info.");
    }

    state.emailSource = "No email found";
    renderEmail();
    if (!automatic) showToast(contactOutError || "No email was found through ContactOut or LinkedIn.");
  } catch (error) {
    state.emailSource = "Lookup needs attention";
    renderEmail();
    if (!automatic) showToast(error instanceof Error ? error.message : "Could not finish email lookup.");
  } finally {
    setFindEmailLoading(false);
  }
}

async function generateEmail() {
  if (!state.profile) return;
  if (!state.settings.openAIApiKey && !state.settings.writerEndpointUrl) {
    showToast("Add an OpenAI key or writer endpoint in Settings first.");
    openSettings();
    return;
  }

  const buttonLabel = elements.generateEmailButton.querySelector("span");
  try {
    elements.generateEmailButton.disabled = true;
    elements.generateEmailButton.classList.add("is-loading");
    buttonLabel.textContent = "Writing";

    const input = buildWriterRequest(state.profile, state.settings, state.note, { subject: state.subject, body: state.body });
    let payload;
    if (state.settings.openAIApiKey) {
      const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_WRITE", input });
      if (!response?.ok) throw new Error(response?.error || "OpenAI writing failed.");
      payload = { data: response.data, model: state.settings.openAIModel || "gpt-5.4-mini" };
    } else {
      let permitted = await hasEndpointPermission(state.settings.writerEndpointUrl);
      if (!permitted) permitted = await requestEndpointPermission(state.settings.writerEndpointUrl);
      if (!permitted) throw new Error("Vela GTM needs access to the AI writer endpoint.");
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (state.settings.writerToken) headers.Authorization = `Bearer ${state.settings.writerToken}`;
      const response = await fetch(state.settings.writerEndpointUrl, { method: "POST", headers, body: JSON.stringify(input) });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `AI writer returned ${response.status}.`);
    }
    const result = normalizeWriterResponse(payload);
    if (!result.subject || !result.body) throw new Error("The AI writer returned an incomplete draft.");
    state.subject = result.subject;
    state.body = result.body;
    state.composerDirty = true;
    if (result.workNote) {
      state.note = result.workNote;
      elements.workNote.value = result.workNote;
    }
    elements.subjectInput.value = state.subject;
    elements.bodyInput.value = state.body;
    elements.templateEyebrow.textContent = `Written with ${result.model || "gpt-5.4-mini"}`;
    updateWordCount();
    queueDraftSave();
    showToast("AI draft ready. Review it before sending.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not generate the email.");
  } finally {
    elements.generateEmailButton.disabled = false;
    elements.generateEmailButton.classList.remove("is-loading");
    buttonLabel.textContent = "Write with AI";
  }
}

function switchTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.tab === tabName));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tabName;
  });
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

async function addCurrentToQueue() {
  if (state.profile) {
    const saved = await storage.get([QUEUE_STORAGE_KEY]);
    const queue = upsertProspects(saved[QUEUE_STORAGE_KEY] || [], [{
      url: state.profile.url,
      name: state.profile.name,
      headline: state.profile.headline,
      location: state.profile.location,
      email: state.email,
      emailSource: state.emailSource,
      workNote: state.note,
      subject: state.subject,
      body: state.body,
      profile: state.profile,
    }]);
    await storage.set({ [QUEUE_STORAGE_KEY]: queue });
  }
  if (globalThis.chrome?.tabs?.create) await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  else window.open("dashboard.html", "_blank", "noopener,noreferrer");
}

async function openGmail() {
  const email = elements.emailInput.value.trim();
  if (email && !isEmail(email)) {
    elements.emailInput.classList.add("is-invalid");
    showToast("Check the email address before composing.");
    return;
  }
  const url = gmailComposeUrl({ to: email, subject: state.subject, body: state.body });
  if (globalThis.chrome?.tabs?.create) await chrome.tabs.create({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

function bindEvents() {
  elements.settingsButton.addEventListener("click", openSettings);
  elements.queueButton.addEventListener("click", addCurrentToQueue);
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  elements.templateSelect.addEventListener("change", () => {
    state.templateId = elements.templateSelect.value;
    state.composerDirty = false;
    rebuildComposer();
  });

  elements.workNote.addEventListener("input", () => {
    state.note = elements.workNote.value.trim();
    if (!state.composerDirty) rebuildComposer();
    queueDraftSave();
  });

  elements.subjectInput.addEventListener("input", () => {
    state.subject = elements.subjectInput.value;
    state.composerDirty = true;
    queueDraftSave();
  });

  elements.bodyInput.addEventListener("input", () => {
    state.body = elements.bodyInput.value;
    state.composerDirty = true;
    updateWordCount();
    queueDraftSave();
  });

  elements.emailInput.addEventListener("input", () => {
    state.email = elements.emailInput.value.trim();
    state.emailSource = state.email ? "Entered manually" : "Not found yet";
    state.confidence = null;
    renderEmail();
    queueDraftSave();
  });

  elements.findEmailButton.addEventListener("click", () => findProspectEmail());
  elements.generateEmailButton.addEventListener("click", generateEmail);
  elements.copyEmailButton.addEventListener("click", () => copyText(elements.emailInput.value.trim(), "Email copied."));
  elements.copyDraftButton.addEventListener("click", () =>
    copyText(`To: ${elements.emailInput.value.trim()}\nSubject: ${state.subject}\n\n${state.body}`, "Draft copied."),
  );
  elements.openGmailButton.addEventListener("click", openGmail);
}

async function initialize() {
  populateTemplates();
  bindEvents();
  showView("loading");

  try {
    await loadSettings();
    state.profile = await getActiveProfile();
    if (!state.profile) {
      showView("gate");
      return;
    }

    state.email = state.profile.visibleEmail || "";
    state.emailSource = state.email ? "Visible on profile" : "Not found yet";
    state.note = buildWorkNote(state.profile);
    elements.previewBadge.hidden = !state.isPreview;
    renderProfile();
    await loadDraft();
    showView("workspace");
    if (previewTab === "draft") switchTab("draft");

    if (!state.email && state.settings.autoEnrich) findProspectEmail({ automatic: true });
  } catch (error) {
    showView("gate");
    showToast(error instanceof Error ? error.message : "Could not read this profile.");
  }
}

applyTheme(DEFAULT_SETTINGS.theme);
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.settings.theme === "system") applyTheme("system");
});
initialize();
