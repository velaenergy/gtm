import {
  DEFAULT_SETTINGS,
  TEMPLATES,
  applyTemplate,
  gmailComposeUrl,
  initialsFor,
  isEmail,
  normalizeEnrichmentResponse,
  resolveTheme,
  templateVariables,
} from "./lib/message.js";
import { buildWriterRequest, mergeEnrichedProfile, normalizeWriterResponse } from "./lib/ai-writer.js";
import { resolveContactEmail } from "./lib/contact-resolution.js";
import { QUEUE_STORAGE_KEY, upsertProspects } from "./lib/queue.js";
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
    "loadingView", "pageGate", "workspace", "actionBar", "previewBadge", "settingsButton", "queueButton", "captureStatus",
    "avatar", "profileName", "profileHeadline", "profileLocationText", "emailSource", "emailConfidence", "emailInput",
    "findEmailButton", "copyEmailButton", "contactDetails", "workNote", "signalCount", "experienceList", "templateSelect",
    "personalizationSource", "rewritePersonalizationButton", "templateEyebrow", "generateEmailButton", "subjectInput", "bodyInput", "wordCount", "copyDraftButton", "openGmailButton", "toast",
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
  note: "",
  templateId: TEMPLATES[0].id,
  subject: "",
  body: "",
  personalizationModel: "",
  campaigns: [],
  lastCampaignId: "",
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
  elements.emailSource.textContent = state.emailSource || "No contact provider has checked this profile yet";
  elements.emailConfidence.hidden = !state.emailVerified && state.emailType !== "linkedin";
  elements.emailConfidence.textContent = state.emailVerified ? "Provider verified" : state.emailType === "linkedin" ? "LinkedIn provided" : "";
  const details = (state.contactDetails.emails || []).filter((email) => email !== state.email
    && ["verified", "valid"].includes(state.contactDetails.emailStatuses?.[email]?.toLowerCase()));
  elements.contactDetails.hidden = details.length === 0;
  const fragment = document.createDocumentFragment();
  for (const email of details) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "contact-detail";
    chip.textContent = `${email} · verified`;
    chip.addEventListener("click", () => {
      state.email = email;
      state.emailVerified = true;
      state.emailSource = "Alternative email verified by provider";
      renderEmail();
      queueDraftSave();
    });
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
  state.confidence = saved.confidence ?? state.confidence;
  state.note = saved.note || state.note;
  state.templateId = TEMPLATES.some((template) => template.id === saved.templateId) ? saved.templateId : state.templateId;
  state.subject = saved.subject || "";
  state.body = saved.body || "";
  state.personalizationModel = saved.personalizationModel || "";
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
        emailVerified: state.emailVerified,
        emailType: state.emailType,
        contactDetails: state.contactDetails,
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

function setFindEmailLoading(loading, label = state.email ? "Refresh" : "Find email") {
  elements.findEmailButton.disabled = loading;
  elements.findEmailButton.classList.toggle("is-loading", loading);
  elements.findEmailButton.querySelector("span").textContent = label;
}

async function requestLinkedInEmail() {
  if (state.isPreview) return { ok: true, email: state.profile?.visibleEmail || "", strategy: "preview" };
  if (!state.activeTabId) throw new Error("Open a LinkedIn profile before using LinkedIn Contact Info.");
  const message = { type: "VELA_GTM_FIND_LINKEDIN_EMAIL" };
  try {
    return await chrome.tabs.sendMessage(state.activeTabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: state.activeTabId },
      files: ["lib/linkedin-parser.js", "content-script.js"],
    });
    return chrome.tabs.sendMessage(state.activeTabId, message);
  }
}

async function enrichProfile({ requestPermission = true, manageButton = true, openSettingsWhenMissing = true, silent = false, replaceProviderResult = false } = {}) {
  if (!state.profile) return;
  const providers = [
    state.settings.apolloApiKey ? "Apollo" : "",
    state.settings.contactOutApiKey ? "ContactOut" : "",
  ].filter(Boolean);
  const provider = providers[0] || "";
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
      for (const candidate of providers) {
        try {
          const response = await chrome.runtime.sendMessage({ type: `VELA_GTM_PROVIDER_${candidate.toUpperCase()}`, profile: state.profile });
          if (!response?.ok) throw new Error(response?.error || `${candidate} lookup failed.`);
          const candidateResult = normalizeEnrichmentResponse({ ...response.data, emailSource: response.data.source });
          state.profile = mergeEnrichedProfile(state.profile, candidateResult);
          renderExperiences();
          const candidateStatus = String(candidateResult.emailStatuses?.[candidateResult.email] || candidateResult.emailStatus || "").toLowerCase();
          if (candidateResult.email && ["verified", "valid"].includes(candidateStatus)) {
            result = candidateResult;
            break;
          }
          lastError = new Error(`${candidate} did not return an explicitly verified email.`);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(`${candidate} lookup failed.`);
        }
      }
      if (!result) throw lastError || new Error("No configured provider returned a verified email.");
    } else {
      let permitted = await hasEndpointPermission(state.settings.endpointUrl);
      if (!permitted && requestPermission) permitted = await requestEndpointPermission(state.settings.endpointUrl);
      if (!permitted) throw new Error("Vela GTM needs access to the enrichment endpoint.");
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (state.settings.apiToken) headers.Authorization = `Bearer ${state.settings.apiToken}`;
      const response = await fetch(state.settings.endpointUrl, { method: "POST", headers, body: JSON.stringify({ source: "vela-gtm-extension", profile: state.profile }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Enrichment service returned ${response.status}.`);
      result = normalizeEnrichmentResponse(payload);
    }
    const selectedStatus = String(result.emailStatuses?.[result.email] || result.emailStatus || "").toLowerCase();
    const fromProvider = direct || new RegExp(`^${provider}\\b`, "i").test(result.emailSource || "");
    if (!result.email || !["verified", "valid"].includes(selectedStatus) || !fromProvider) {
      state.email = "";
      state.emailVerified = false;
      state.emailType = "";
      state.emailSource = `No verified email found by ${provider}`;
      state.contactDetails = { emails: [], phones: [], emailStatus: "", emailStatuses: {}, error: `${providers.join(" or ")} did not return an explicitly verified address.` };
      renderEmail();
      queueDraftSave();
      throw new Error(`${provider} did not return a verified email for this profile.`);
    }

    state.email = result.email;
    state.emailVerified = true;
    state.emailType = result.workEmails?.includes(result.email) ? "work" : result.personalEmails?.includes(result.email) ? "personal" : "other";
    state.emailSource = `${state.emailType === "work" ? "Work" : state.emailType === "personal" ? "Personal" : "Contact"} email confirmed by ${provider}`;
    state.confidence = result.confidence;
    state.contactDetails = { emails: result.emails, phones: [], emailStatus: selectedStatus, emailStatuses: result.emailStatuses, error: "" };
    renderEmail();
    queueDraftSave();
    if (!silent) showToast(`Verified ${provider} email found. Writing personalization…`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enrichment failed. Check Settings.";
    state.emailSource = message;
    state.contactDetails = { ...state.contactDetails, error: message };
    renderEmail();
    if (!silent) showToast(message);
    return false;
  } finally {
    if (manageButton) setFindEmailLoading(false);
  }
}

async function findProspectEmail({ automatic = false } = {}) {
  if (!state.profile) return;
  setFindEmailLoading(true, "Looking up");

  try {
    const resolution = await resolveContactEmail({
      contactOutLookup: async () => {
        if (!state.settings.contactOutApiKey && !state.settings.apolloApiKey && !state.settings.endpointUrl) throw new Error("No contact provider is configured.");
        state.emailSource = `${[state.settings.contactOutApiKey ? "ContactOut" : "", state.settings.apolloApiKey ? "Apollo" : ""].filter(Boolean).join(" + ")} is checking this profile…`;
        renderEmail();
        const found = await enrichProfile({
          requestPermission: !automatic,
          manageButton: false,
          openSettingsWhenMissing: false,
          silent: true,
          replaceProviderResult: true,
        });
        if (found && state.emailVerified && state.email) return { email: state.email, result: found };
        throw new Error(state.contactDetails.error || `${[state.settings.contactOutApiKey ? "ContactOut" : "", state.settings.apolloApiKey ? "Apollo" : ""].filter(Boolean).join(" or ")} did not return a verified email for this profile.`);
      },
      linkedInLookup: async () => {
        state.emailSource = "Configured providers did not find an email. Checking LinkedIn Contact Info…";
        renderEmail();
        const response = await requestLinkedInEmail();
        if (!response?.ok) throw new Error(response?.error || "Could not read LinkedIn Contact Info.");
        return response;
      },
    });

    if (!resolution.email) {
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
      state.email = resolution.email;
      state.emailVerified = false;
      state.emailType = "linkedin";
      state.emailSource = resolution.strategy === "rsc" ? "LinkedIn Contact Info" : "LinkedIn Contact Info overlay";
      state.confidence = null;
      state.contactDetails = { ...state.contactDetails, error: "" };
      renderEmail();
      queueDraftSave();
    }

    setFindEmailLoading(true, "Personalizing");
    const written = await generateEmail({ silent: automatic, announce: false });
    if (!automatic) {
      const lookupLabel = resolution.source === "contactout" ? `${state.emailSource.match(/(?:ContactOut|Apollo)/i)?.[0] || "Provider"} email` : "LinkedIn Contact Info email";
      showToast(written ? `${lookupLabel} and AI personalization are ready.` : `${lookupLabel} found. Configure the AI writer to personalize it.`);
    }
    return true;
  } catch (error) {
    renderEmail();
    if (!automatic) showToast(error instanceof Error ? error.message : "Could not finish email lookup.");
    return false;
  } finally {
    setFindEmailLoading(false);
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
  if (!state.settings.openAIApiKey && !state.settings.writerEndpointUrl) {
    if (!silent) { showToast("Add an OpenAI key or writer endpoint in Settings first."); openSettings(); }
    return false;
  }

  try {
    setWriterLoading(true);

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
    state.personalizationModel = result.model || state.settings.openAIModel || "gpt-5.4-mini";
    const providerLabel = state.emailSource.match(/(?:ContactOut|Apollo)/i)?.[0] || "provider";
    const contextLabel = state.emailVerified ? `verified ${providerLabel} research` : state.emailType === "linkedin" ? "LinkedIn profile context" : "profile context";
    elements.personalizationSource.textContent = `Written with ${state.personalizationModel} from ${contextLabel}`;
    elements.subjectInput.value = state.subject;
    elements.bodyInput.value = state.body;
    elements.templateEyebrow.textContent = `Written with ${result.model || "gpt-5.4-mini"}`;
    updateWordCount();
    queueDraftSave();
    if (announce) showToast("AI personalization and email draft are ready.");
    return true;
  } catch (error) {
    if (!silent) showToast(error instanceof Error ? error.message : "Could not generate the email.");
    return false;
  } finally {
    setWriterLoading(false);
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
  elements.queueButton.addEventListener("click", () => openCampaigns());
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
    state.emailSource = state.email ? "Entered manually · not provider verified" : "No contact provider has checked this profile yet";
    state.emailVerified = false;
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

    state.email = "";
    state.emailSource = "No contact provider has checked this profile yet";
    state.emailVerified = false;
    state.note = "";
    elements.previewBadge.hidden = !state.isPreview;
    renderProfile();
    await loadDraft();
    await loadCampaigns();
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
