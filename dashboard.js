import { buildWriterRequest, normalizeWriterResponse } from "./lib/ai-writer.js";
import { gmailDraftPayload } from "./lib/gmail.js";
import {
  DEFAULT_SETTINGS,
  TEMPLATES,
  applyTemplate,
  buildWorkNote,
  initialsFor,
  isEmail,
  normalizeEnrichmentResponse,
  resolveTheme,
  templateVariables,
} from "./lib/message.js";
import {
  QUEUE_STATUS,
  QUEUE_STORAGE_KEY,
  parseBulkProspects,
  queueStats,
  upsertProspects,
} from "./lib/queue.js";

const isExtension = Boolean(globalThis.chrome?.runtime?.id);
const previewTheme = !isExtension ? new URLSearchParams(location.search).get("theme") : null;
const elements = Object.fromEntries([
  "settingsButton", "searchForm", "searchBrief", "planSearchButton", "searchPlan", "searchStrategy", "searchOptions",
  "captureSearchButton", "openImportButton", "openImportButtonTop", "importDialog", "bulkInput", "importButton", "importHint",
  "processButton", "draftReadyButton", "queueBody", "emptyState", "totalStat", "readyStat", "draftedStat",
  "attentionStat", "progressBar", "progressText", "toast", "navTotal", "navResearch", "navReview", "navDrafted",
  "queueHeading", "queueDescription", "tableSearch", "statusFilterButton", "resultCount", "selectAll", "bulkBar",
  "selectedCount", "bulkResearchButton", "bulkDraftButton", "clearSelectionButton", "exportButton", "copySheetButton",
  "collapseSidebar", "drawerBackdrop", "reviewDrawer", "closeDrawerButton", "drawerAvatar", "drawerName", "drawerHeadline",
  "drawerLinkedIn", "drawerWorkNote", "drawerEmail", "drawerSubject", "drawerBody", "saveReviewButton", "approveDraftButton",
].map((id) => [id, document.getElementById(id)]));

const DEMO_QUEUE = [
  { url: "https://www.linkedin.com/in/joshua-rivera", name: "Joshua Rivera", headline: "VP, Critical Operations", location: "Seattle, WA", email: "joshua@northstarinfra.com", emailSource: "LinkedIn contact info", status: QUEUE_STATUS.READY, subject: "Your work in critical operations + a quick Vela intro", body: "Hi Joshua,\n\nI came across your work leading critical operations at Northstar Infrastructure and would love to learn from your perspective.\n\nBest,\nTarun", workNote: "your work leading critical operations at Northstar Infrastructure", profile: { experiences: [{ title: "VP, Critical Operations", company: "Northstar Infrastructure" }] }, updatedAt: new Date(Date.now() - 8 * 60_000).toISOString() },
  { url: "https://www.linkedin.com/in/maya-chen", name: "Maya Chen", headline: "Director of Energy Strategy", location: "San Francisco, CA", email: "maya@aperturecompute.com", emailSource: "ContactOut work email", status: QUEUE_STATUS.DRAFTED, subject: "Power strategy at Aperture Compute", body: "Hi Maya,\n\nYour work on energy strategy at Aperture Compute stood out to me.", workNote: "your work on energy strategy for high-density compute", profile: { experiences: [{ title: "Director of Energy Strategy", company: "Aperture Compute" }] }, updatedAt: new Date(Date.now() - 44 * 60_000).toISOString() },
  { url: "https://www.linkedin.com/in/omar-haddad", name: "Omar Haddad", headline: "Head of Site Selection", location: "Austin, TX", email: "omar@vectorgrid.com", emailSource: "LinkedIn contact info", status: QUEUE_STATUS.READY, subject: "Site selection, power, and a quick introduction", body: "Hi Omar,\n\nI was impressed by your work finding and powering new infrastructure sites.", workNote: "your work leading site selection at VectorGrid", profile: { experiences: [{ title: "Head of Site Selection", company: "VectorGrid" }] }, updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
  { url: "https://www.linkedin.com/in/elena-rossi", name: "Elena Rossi", headline: "SVP, Infrastructure Development", location: "New York, NY", status: QUEUE_STATUS.PROCESSING, profile: { experiences: [{ title: "SVP, Infrastructure Development", company: "Arcadia Data Centers" }] }, updatedAt: new Date(Date.now() - 4 * 3_600_000).toISOString() },
  { url: "https://www.linkedin.com/in/devon-brooks", name: "Devon Brooks", headline: "Utility Partnerships", location: "Denver, CO", status: QUEUE_STATUS.NEEDS_EMAIL, error: "No verified work email found.", subject: "Utility partnerships at Meridian", body: "Hi Devon,\n\nI’d value your perspective on utility partnership workflows.", profile: { experiences: [{ title: "Director, Utility Partnerships", company: "Meridian Power" }] }, updatedAt: new Date(Date.now() - 23 * 3_600_000).toISOString() },
  { url: "https://www.linkedin.com/in/priya-narayanan", name: "Priya Narayanan", headline: "VP, Power Procurement", location: "Chicago, IL", status: QUEUE_STATUS.NEW, background: "leads power procurement for a large industrial portfolio", profile: { experiences: [{ title: "VP, Power Procurement", company: "Forge Industrial" }] }, updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  { url: "https://www.linkedin.com/in/liam-foster", name: "Liam Foster", headline: "Chief Development Officer", location: "Phoenix, AZ", email: "liam@helioscolo.com", emailSource: "ContactOut work email", status: QUEUE_STATUS.DRAFTED, subject: "Development at Helios + Vela", body: "Hi Liam,\n\nI’d love to learn more about the infrastructure development work you’re leading.", workNote: "your infrastructure development work at Helios Colocation", profile: { experiences: [{ title: "Chief Development Officer", company: "Helios Colocation" }] }, updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
];

const state = { queue: [], settings: { ...DEFAULT_SETTINGS }, busy: false, toastTimer: null, view: "all", query: "", selected: new Set(), activeProspectId: null, attentionOnly: false };

const storage = {
  async get(keys) {
    if (isExtension) return chrome.storage.local.get(keys);
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.map((key) => [key, JSON.parse(localStorage.getItem(key) || "null")]));
  },
  async set(values) {
    if (isExtension) return chrome.storage.local.set(values);
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
  },
};

function applyTheme(preference = "system") {
  const dark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
  document.documentElement.dataset.theme = resolveTheme(preference, dark);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

function setBusy(busy, label = "Researching queue") {
  state.busy = busy;
  elements.progressBar.hidden = !busy;
  elements.progressText.textContent = label;
  elements.processButton.disabled = busy;
  elements.draftReadyButton.disabled = busy;
  elements.captureSearchButton.disabled = busy;
}

async function persistQueue() {
  await storage.set({ [QUEUE_STORAGE_KEY]: state.queue });
}

function statusLabel(status) {
  return ({
    [QUEUE_STATUS.NEW]: "Queued",
    [QUEUE_STATUS.PROCESSING]: "Researching",
    [QUEUE_STATUS.NEEDS_EMAIL]: "Needs email",
    [QUEUE_STATUS.READY]: "Ready to review",
    [QUEUE_STATUS.DRAFTED]: "In Gmail",
    [QUEUE_STATUS.ERROR]: "Try again",
  })[status] || "Queued";
}

function appendText(parent, tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function companyAndRole(prospect) {
  const experience = prospect.profile?.experiences?.[0] || {};
  return { company: experience.company || prospect.company || "—", role: experience.title || prospect.headline || prospect.background || "Role not researched" };
}

function relativeTime(value) {
  const elapsed = Date.now() - new Date(value || Date.now()).getTime();
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

function prospectMatchesView(prospect) {
  if (state.view === "research" && ![QUEUE_STATUS.NEW, QUEUE_STATUS.PROCESSING, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(prospect.status)) return false;
  if (state.view === "review" && prospect.status !== QUEUE_STATUS.READY) return false;
  if (state.view === "drafted" && prospect.status !== QUEUE_STATUS.DRAFTED) return false;
  if (state.attentionOnly && ![QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(prospect.status)) return false;
  if (!state.query) return true;
  const details = companyAndRole(prospect);
  return [prospect.name, prospect.email, prospect.headline, prospect.location, details.company, details.role, prospect.subject].join(" ").toLowerCase().includes(state.query.toLowerCase());
}

function visibleProspects() {
  return state.queue.filter(prospectMatchesView);
}

function renderQueue() {
  const stats = queueStats(state.queue);
  elements.totalStat.textContent = stats.total;
  elements.readyStat.textContent = stats.ready;
  elements.draftedStat.textContent = stats.drafted;
  elements.attentionStat.textContent = stats.attention;
  elements.navTotal.textContent = stats.total;
  elements.navResearch.textContent = state.queue.filter((item) => [QUEUE_STATUS.NEW, QUEUE_STATUS.PROCESSING, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status)).length;
  elements.navReview.textContent = stats.ready;
  elements.navDrafted.textContent = stats.drafted;
  const visible = visibleProspects();
  elements.emptyState.hidden = visible.length > 0;
  elements.queueBody.hidden = visible.length === 0;
  elements.resultCount.textContent = `${visible.length} prospect${visible.length === 1 ? "" : "s"}`;
  elements.draftReadyButton.disabled = state.busy || stats.ready === 0;
  elements.selectAll.checked = visible.length > 0 && visible.every((item) => state.selected.has(item.id));
  elements.selectAll.indeterminate = visible.some((item) => state.selected.has(item.id)) && !elements.selectAll.checked;
  elements.selectedCount.textContent = state.selected.size;
  elements.bulkBar.hidden = state.selected.size === 0;

  const fragment = document.createDocumentFragment();
  for (const prospect of visible) {
    const row = document.createElement("tr");
    row.className = `queue-row${state.selected.has(prospect.id) ? " is-selected" : ""}`;
    const checkCell = document.createElement("td");
    checkCell.className = "check-cell";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selected.has(prospect.id);
    checkbox.setAttribute("aria-label", `Select ${prospect.name || "prospect"}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selected.add(prospect.id); else state.selected.delete(prospect.id);
      renderQueue();
    });
    checkCell.append(checkbox);

    const personCell = document.createElement("td");
    const person = document.createElement("div");
    person.className = "person";
    appendText(person, "span", initialsFor(prospect.name), "person-avatar");
    const copy = document.createElement("div");
    copy.className = "person-copy";
    appendText(copy, "strong", prospect.name || "LinkedIn prospect");
    const linkedIn = appendText(copy, "a", prospect.location || "View LinkedIn");
    linkedIn.href = prospect.url;
    linkedIn.target = "_blank";
    linkedIn.rel = "noreferrer";
    person.append(copy);
    personCell.append(person);

    const details = companyAndRole(prospect);
    const roleCell = document.createElement("td");
    roleCell.className = "role-cell";
    appendText(roleCell, "strong", details.company);
    appendText(roleCell, "span", details.role);

    const emailCell = appendText(row, "td", prospect.email || "Not found", `email-cell${prospect.email ? "" : " email-empty"}`);
    emailCell.title = prospect.emailSource || prospect.error || "";
    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `status status-${prospect.status}`;
    status.append(document.createElement("i"), document.createTextNode(statusLabel(prospect.status)));
    status.title = prospect.error || "";
    statusCell.append(status);

    const draftCell = document.createElement("td");
    draftCell.className = "draft-cell";
    if (prospect.subject) {
      appendText(draftCell, "strong", prospect.subject);
      appendText(draftCell, "span", prospect.body?.split("\n").find(Boolean) || "Draft prepared");
    } else appendText(draftCell, "span", "Not drafted", "draft-empty");
    const updatedCell = appendText(row, "td", relativeTime(prospect.updatedAt || prospect.createdAt), "updated-cell");

    const actions = document.createElement("td");
    actions.className = "row-actions";
    if (prospect.status === QUEUE_STATUS.READY) {
      const review = appendText(actions, "button", "Review", "row-button");
      review.type = "button";
      review.addEventListener("click", () => openReviewDrawer(prospect.id));
    } else if (prospect.status !== QUEUE_STATUS.DRAFTED) {
      const research = appendText(actions, "button", prospect.status === QUEUE_STATUS.ERROR ? "Retry" : "Research", "row-button");
      research.type = "button";
      research.addEventListener("click", () => processQueue([prospect.id]));
    }
    if (prospect.subject && prospect.status !== QUEUE_STATUS.READY) {
      const review = appendText(actions, "button", "Open", "row-button");
      review.type = "button";
      review.addEventListener("click", () => openReviewDrawer(prospect.id));
    }
    const remove = appendText(actions, "button", "···", "row-button row-menu");
    remove.type = "button";
    remove.title = "Remove prospect";
    remove.addEventListener("click", async () => {
      state.queue = state.queue.filter((item) => item.id !== prospect.id);
      state.selected.delete(prospect.id);
      await persistQueue();
      renderQueue();
    });

    row.append(checkCell, personCell, roleCell, emailCell, statusCell, draftCell, updatedCell, actions);
    fragment.append(row);
  }
  elements.queueBody.replaceChildren(fragment);
}

async function addProspects(prospects, message) {
  const before = state.queue.length;
  state.queue = upsertProspects(state.queue, prospects);
  await persistQueue();
  renderQueue();
  showToast(message || `${state.queue.length - before} prospect${state.queue.length - before === 1 ? "" : "s"} added.`);
}

function linkedinSearchUrl(brief) {
  const url = new URL("https://www.linkedin.com/search/results/people/");
  url.searchParams.set("keywords", brief.trim());
  url.searchParams.set("origin", "GLOBAL_SEARCH_HEADER");
  return url.toString();
}

function agentEndpoint(path) {
  const url = new URL(state.settings.writerEndpointUrl || DEFAULT_SETTINGS.writerEndpointUrl);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function openLinkedInSearch(query) {
  const url = linkedinSearchUrl(query);
  if (isExtension) await chrome.tabs.create({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

function renderSearchPlan(plan) {
  elements.searchStrategy.textContent = plan.strategy;
  const fragment = document.createDocumentFragment();
  for (const search of plan.searches || []) {
    const button = document.createElement("button");
    button.className = "search-option";
    button.type = "button";
    appendText(button, "strong", search.label);
    appendText(button, "p", `${search.query} — ${search.rationale}`);
    appendText(button, "b", "↗");
    button.title = state.settings.contactOutApiKey ? "Find candidates with ContactOut" : "Open this search in LinkedIn";
    button.addEventListener("click", () => runPlannedSearch(search));
    fragment.append(button);
  }
  elements.searchOptions.replaceChildren(fragment);
  elements.searchPlan.hidden = false;
}

async function runPlannedSearch(search) {
  if (!state.settings.contactOutApiKey) {
    await openLinkedInSearch(search.query);
    return;
  }
  try {
    setBusy(true, "Finding people with ContactOut");
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_PEOPLE_SEARCH", filters: search.filters });
    if (!response?.ok) throw new Error(response?.error || "ContactOut People Search failed.");
    const prospects = response.data?.prospects || [];
    if (!prospects.length) throw new Error("ContactOut found no people for this strategy. Try a broader plan.");
    await addProspects(prospects, `Added ${prospects.length} of ${response.data.total || prospects.length} matching people.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "People search failed.");
  } finally {
    setBusy(false);
    renderQueue();
  }
}

async function planSearch(brief) {
  if (!isExtension) {
    renderSearchPlan({
      strategy: "Split the brief into operating ownership, power responsibility, and mission-critical infrastructure so each search stays specific.",
      searches: [
        { label: "Critical operations", query: "critical operations data center power", rationale: "Targets operators responsible for uptime and electrical systems.", filters: { job_title: ["Critical Operations", "Data Center Operations"], seniority: ["manager", "director"], skills: ["Critical Facilities"], location: [], industry: ["Data Centers"], company: [], keyword: "power infrastructure" } },
        { label: "Energy strategy", query: "data center energy infrastructure power procurement", rationale: "Targets leaders involved in power availability and procurement.", filters: { job_title: ["Energy Strategy", "Power Procurement"], seniority: ["director", "vice president"], skills: [], location: [], industry: ["Data Centers"], company: [], keyword: "power procurement" } },
      ],
    });
    return;
  }
  if (state.settings.openAIApiKey) {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_PLAN_SEARCH", brief });
    if (!response?.ok) throw new Error(response?.error || "Vela search planning failed.");
    renderSearchPlan(response.data);
    return;
  }
  if (!state.settings.writerEndpointUrl) throw new Error("Add an OpenAI API key in Settings to use the Vela search agent.");
  const endpoint = agentEndpoint("/plan-search");
  if (!(await ensureOriginPermission(endpoint))) throw new Error("Vela agent server access was declined.");
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (state.settings.writerToken) headers.Authorization = `Bearer ${state.settings.writerToken}`;
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ brief }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Search agent returned ${response.status}.`);
  renderSearchPlan(payload.data);
}

async function sendLinkedInMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/linkedin-parser.js", "content-script.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function waitForTab(tabId, timeout = 18000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("LinkedIn took too long to load.");
}

async function captureVisibleSearch() {
  if (!isExtension) {
    await addProspects(DEMO_QUEUE, "Captured 2 preview prospects.");
    return;
  }
  try {
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    const matches = await chrome.tabs.query({ url: "https://www.linkedin.com/search/results/people/*" });
    const tab = active.find((item) => /linkedin\.com\/search\/results\/people/i.test(item.url || "")) || matches.at(-1);
    if (!tab?.id) throw new Error("Open a LinkedIn People search first.");
    const response = await sendLinkedInMessage(tab.id, { type: "VELA_GTM_EXTRACT_SEARCH_RESULTS" });
    if (!response?.ok || !response.prospects?.length) throw new Error("No visible profile results were found on that page.");
    await addProspects(response.prospects, `Captured ${response.prospects.length} visible LinkedIn results.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not capture this search.");
  }
}

function originPattern(endpointUrl) {
  const url = new URL(endpointUrl);
  return `${url.protocol}//${url.host}/*`;
}

async function ensureOriginPermission(endpointUrl) {
  if (!endpointUrl || !isExtension) return true;
  const origins = [originPattern(endpointUrl)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

async function callEnrichment(profile) {
  if (state.settings.contactOutApiKey) {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_CONTACTOUT", profile });
    if (!response?.ok) throw new Error(response?.error || "ContactOut lookup failed.");
    return normalizeEnrichmentResponse({ ...response.data, emailSource: response.data.source });
  }
  if (!state.settings.endpointUrl) return {};
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (state.settings.apiToken) headers.Authorization = `Bearer ${state.settings.apiToken}`;
  const response = await fetch(state.settings.endpointUrl, {
    method: "POST", headers, body: JSON.stringify({ source: "vela-gtm-extension", profile }),
  });
  if (!response.ok) throw new Error(`Enrichment returned ${response.status}.`);
  return normalizeEnrichmentResponse(await response.json());
}

function templateDraft(profile, workNote) {
  return applyTemplate(TEMPLATES[0], templateVariables(profile, state.settings, workNote));
}

async function callWriter(profile, workNote, draft) {
  if (state.settings.openAIApiKey) {
    const input = buildWriterRequest(profile, state.settings, workNote, draft);
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_WRITE", input });
    if (!response?.ok) throw new Error(response?.error || "OpenAI writing failed.");
    return normalizeWriterResponse({ data: response.data, model: state.settings.openAIModel || "gpt-5.4-mini" });
  }
  if (!state.settings.writerEndpointUrl) return { ...draft, workNote };
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (state.settings.writerToken) headers.Authorization = `Bearer ${state.settings.writerToken}`;
  const response = await fetch(state.settings.writerEndpointUrl, {
    method: "POST", headers, body: JSON.stringify(buildWriterRequest(profile, state.settings, workNote, draft)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `AI writer returned ${response.status}.`);
  const result = normalizeWriterResponse(payload);
  if (!result.subject || !result.body) throw new Error("The AI writer returned an incomplete draft.");
  return result;
}

async function researchProspect(prospect) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url: prospect.url, active: false });
    await waitForTab(tab.id);
    const profileResponse = await sendLinkedInMessage(tab.id, { type: "VELA_GTM_EXTRACT_PROFILE" });
    if (!profileResponse?.ok) throw new Error(profileResponse?.error || "Could not read the LinkedIn profile.");
    let profile = { ...profileResponse.profile, workNote: prospect.background || prospect.workNote };

    let email = profile.visibleEmail || prospect.email || "";
    let emailSource = email ? "Visible on profile" : prospect.emailSource || "";
    let contactDetails = { emails: [], phones: [], emailStatus: "" };
    let workNote = prospect.background || buildWorkNote(profile);
    if (state.settings.contactOutApiKey || state.settings.endpointUrl) {
      try {
        const enriched = await callEnrichment(profile);
        if (enriched.email) { email = enriched.email; emailSource = enriched.emailSource || "Enrichment service"; }
        contactDetails = { emails: enriched.emails || [], phones: enriched.phones || [], emailStatus: enriched.emailStatus || "" };
        if (enriched.note) workNote = enriched.note;
        if (enriched.profile) {
          profile = {
            ...enriched.profile, ...profile,
            name: profile.name || enriched.profile.name,
            headline: profile.headline || enriched.profile.headline,
            location: profile.location || enriched.profile.location,
            about: profile.about || enriched.profile.about,
            experiences: profile.experiences?.length ? profile.experiences : enriched.profile.experiences,
            contactOut: { company: enriched.profile.company || null, industry: enriched.profile.industry || "", skills: enriched.profile.skills || [] },
          };
        }
      } catch {
        // LinkedIn Contact info below remains available when ContactOut misses or errors.
      }
    }
    if (!email) {
      try {
        const contact = await chrome.tabs.sendMessage(tab.id, { type: "VELA_GTM_FIND_LINKEDIN_EMAIL" });
        if (contact?.email) { email = contact.email; emailSource = "LinkedIn contact info"; }
      } catch {
        // LinkedIn Contact info is the final fallback after ContactOut.
      }
    }

    const fallback = templateDraft(profile, workNote);
    let written;
    try {
      written = await callWriter(profile, workNote, fallback);
    } catch (error) {
      written = { ...fallback, workNote };
      if (state.settings.writerEndpointUrl) showToast(`AI writer unavailable for ${profile.name || "one prospect"}; used the Vela template.`);
    }

    return {
      ...prospect,
      profile,
      name: profile.name || prospect.name,
      headline: profile.headline || prospect.headline,
      location: profile.location || prospect.location,
      email,
      emailSource,
      contactDetails,
      workNote: written.workNote || workNote,
      subject: written.subject,
      body: written.body,
      status: isEmail(email) ? QUEUE_STATUS.READY : QUEUE_STATUS.NEEDS_EMAIL,
      error: isEmail(email) ? "" : "No email was available in LinkedIn Contact info or the configured enrichment service.",
      updatedAt: new Date().toISOString(),
    };
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function processQueue(ids = null) {
  if (state.busy) return;
  if (!isExtension) {
    const targets = new Set(ids || state.queue.filter((item) => [QUEUE_STATUS.NEW, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status)).map((item) => item.id));
    state.queue = state.queue.map((item) => targets.has(item.id) ? {
      ...item,
      email: item.email || `${(item.name || "prospect").toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@example.com`,
      subject: item.subject || `A quick Vela introduction for ${item.name || "you"}`,
      body: item.body || `Hi ${(item.name || "there").split(" ")[0]},\n\nI came across your work and would love to learn from your perspective.\n\nBest,\n${state.settings.senderName}`,
      workNote: item.workNote || item.background || `your work in ${item.headline || "energy infrastructure"}`,
      status: QUEUE_STATUS.READY,
      error: "",
      updatedAt: new Date().toISOString(),
    } : item);
    await persistQueue();
    renderQueue();
    showToast("Preview queue researched.");
    return;
  }

  const candidates = state.queue.filter((item) => ids ? ids.includes(item.id) : [QUEUE_STATUS.NEW, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status));
  if (!candidates.length) { showToast("There are no prospects waiting for research."); return; }
  try {
    if (!state.settings.contactOutApiKey && state.settings.endpointUrl && !(await ensureOriginPermission(state.settings.endpointUrl))) throw new Error("Email enrichment access was declined.");
    if (!state.settings.openAIApiKey && state.settings.writerEndpointUrl && !(await ensureOriginPermission(state.settings.writerEndpointUrl))) throw new Error("AI writer access was declined.");
    setBusy(true);
    for (let index = 0; index < candidates.length; index += 1) {
      const current = candidates[index];
      elements.progressText.textContent = `Researching ${index + 1} of ${candidates.length}`;
      state.queue = state.queue.map((item) => item.id === current.id ? { ...item, status: QUEUE_STATUS.PROCESSING, error: "" } : item);
      renderQueue();
      try {
        const result = await researchProspect(current);
        state.queue = state.queue.map((item) => item.id === current.id ? result : item);
      } catch (error) {
        state.queue = state.queue.map((item) => item.id === current.id ? {
          ...item, status: QUEUE_STATUS.ERROR, error: error instanceof Error ? error.message : "Research failed.", updatedAt: new Date().toISOString(),
        } : item);
      }
      await persistQueue();
      renderQueue();
    }
    showToast("Queue research finished. Review the ready drafts.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not research the queue.");
  } finally {
    setBusy(false);
    renderQueue();
  }
}

async function gmailToken() {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id || "";
  if (clientId.startsWith("REPLACE_WITH_")) throw new Error("Add the Google OAuth client ID in manifest.json, then reload the extension.");
  const result = await chrome.identity.getAuthToken({ interactive: true });
  const token = typeof result === "string" ? result : result?.token;
  if (!token) throw new Error("Gmail authorization did not return an access token.");
  return token;
}

async function createGmailDraft(token, prospect) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(gmailDraftPayload({ to: prospect.email, subject: prospect.subject, body: prospect.body })),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Gmail returned ${response.status}.`);
  return payload.id || "created";
}

async function createDrafts(ids = null) {
  if (state.busy) return;
  const ready = state.queue.filter((item) => item.status === QUEUE_STATUS.READY && (!ids || ids.includes(item.id)));
  if (!ready.length) { showToast("No reviewed drafts are ready for Gmail."); return; }
  if (!isExtension) {
    state.queue = state.queue.map((item) => ready.some((prospect) => prospect.id === item.id) ? { ...item, status: QUEUE_STATUS.DRAFTED, draftId: "preview", updatedAt: new Date().toISOString() } : item);
    await persistQueue();
    renderQueue();
    showToast(`Prepared ${ready.length} Gmail draft${ready.length === 1 ? "" : "s"}. Nothing was sent.`);
    return;
  }
  try {
    setBusy(true, "Connecting to Gmail");
    const token = await gmailToken();
    for (let index = 0; index < ready.length; index += 1) {
      const prospect = ready[index];
      elements.progressText.textContent = `Creating Gmail draft ${index + 1} of ${ready.length}`;
      try {
        const draftId = await createGmailDraft(token, prospect);
        state.queue = state.queue.map((item) => item.id === prospect.id ? { ...item, draftId, status: QUEUE_STATUS.DRAFTED, error: "" } : item);
      } catch (error) {
        state.queue = state.queue.map((item) => item.id === prospect.id ? { ...item, error: error instanceof Error ? error.message : "Gmail draft failed." } : item);
      }
      await persistQueue();
      renderQueue();
    }
    showToast(`Created ${ready.length} Gmail draft${ready.length === 1 ? "" : "s"}. Nothing was sent.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not connect to Gmail.");
  } finally {
    setBusy(false);
    renderQueue();
  }
}

const VIEW_COPY = {
  all: ["All prospects", "Every prospect across research, review, and Gmail."],
  research: ["Research queue", "Prospects waiting for enrichment, context, or a first draft."],
  review: ["Review queue", "Personalized drafts that need a human decision before Gmail."],
  drafted: ["Gmail drafts", "Approved messages prepared in Gmail. Nothing has been sent."],
};

function setView(view) {
  state.view = view;
  state.attentionOnly = false;
  elements.statusFilterButton.classList.remove("is-active");
  for (const button of document.querySelectorAll("[data-view]")) button.classList.toggle("is-active", button.dataset.view === view);
  [elements.queueHeading.textContent, elements.queueDescription.textContent] = VIEW_COPY[view] || VIEW_COPY.all;
  renderQueue();
}

function openReviewDrawer(id) {
  const prospect = state.queue.find((item) => item.id === id);
  if (!prospect) return;
  state.activeProspectId = id;
  elements.drawerAvatar.textContent = initialsFor(prospect.name);
  elements.drawerName.textContent = prospect.name || "LinkedIn prospect";
  elements.drawerHeadline.textContent = prospect.headline || companyAndRole(prospect).role;
  elements.drawerLinkedIn.href = prospect.url;
  elements.drawerWorkNote.value = prospect.workNote || prospect.background || "";
  elements.drawerEmail.value = prospect.email || "";
  elements.drawerSubject.value = prospect.subject || "";
  elements.drawerBody.value = prospect.body || "";
  elements.approveDraftButton.disabled = prospect.status === QUEUE_STATUS.DRAFTED;
  elements.approveDraftButton.textContent = prospect.status === QUEUE_STATUS.DRAFTED ? "Already in Gmail" : "Approve & create Gmail draft";
  elements.drawerBackdrop.hidden = false;
  elements.reviewDrawer.classList.add("is-open");
  elements.reviewDrawer.setAttribute("aria-hidden", "false");
  elements.drawerSubject.focus();
}

function closeReviewDrawer() {
  elements.reviewDrawer.classList.remove("is-open");
  elements.reviewDrawer.setAttribute("aria-hidden", "true");
  elements.drawerBackdrop.hidden = true;
  state.activeProspectId = null;
}

async function saveReview() {
  const id = state.activeProspectId;
  if (!id) return false;
  const email = elements.drawerEmail.value.trim();
  const subject = elements.drawerSubject.value.trim();
  const body = elements.drawerBody.value.trim();
  if (!isEmail(email)) { showToast("Add a valid email before approving this draft."); elements.drawerEmail.focus(); return false; }
  if (!subject || !body) { showToast("The subject and message both need content."); return false; }
  state.queue = state.queue.map((item) => item.id === id ? { ...item, email, subject, body, workNote: elements.drawerWorkNote.value.trim(), updatedAt: new Date().toISOString() } : item);
  await persistQueue();
  renderQueue();
  showToast("Review changes saved.");
  return true;
}

function exportRows(items) {
  return items.map((prospect) => {
    const details = companyAndRole(prospect);
    return [prospect.name || "", details.company, details.role, prospect.email || "", statusLabel(prospect.status), prospect.subject || "", prospect.workNote || "", prospect.url || "", prospect.updatedAt || ""];
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCsv() {
  const items = state.selected.size ? state.queue.filter((item) => state.selected.has(item.id)) : visibleProspects();
  if (!items.length) { showToast("There are no prospects to export in this view."); return; }
  const headers = ["Name", "Company", "Role", "Email", "Stage", "Subject", "Personalization note", "LinkedIn URL", "Updated at"];
  const csv = [headers, ...exportRows(items)].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `vela-gtm-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${items.length} prospect${items.length === 1 ? "" : "s"} for Google Sheets.`);
}

async function copyForSheets() {
  const items = state.selected.size ? state.queue.filter((item) => state.selected.has(item.id)) : visibleProspects();
  if (!items.length) { showToast("There are no prospects to copy in this view."); return; }
  const headers = ["Name", "Company", "Role", "Email", "Stage", "Subject", "Personalization note", "LinkedIn URL", "Updated at"];
  const tsv = [headers, ...exportRows(items)].map((row) => row.map((value) => String(value ?? "").replaceAll("\t", " ").replaceAll("\n", " ")).join("\t")).join("\n");
  try {
    await navigator.clipboard.writeText(tsv);
    showToast(`Copied ${items.length} row${items.length === 1 ? "" : "s"}. Paste directly into Google Sheets.`);
  } catch {
    showToast("Clipboard access was blocked. Use Export CSV instead.");
  }
}

function bindEvents() {
  elements.settingsButton.addEventListener("click", () => isExtension ? chrome.runtime.openOptionsPage() : window.open("options.html", "_blank"));
  elements.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const brief = elements.searchBrief.value.trim();
    if (!brief) { showToast("Describe the people you want to find first."); return; }
    try {
      elements.planSearchButton.disabled = true;
      await planSearch(brief);
    } catch (error) {
      showToast(error instanceof Error ? `${error.message} Opening a direct search instead.` : "Search planning failed.");
      await openLinkedInSearch(brief);
    } finally {
      elements.planSearchButton.disabled = false;
    }
  });
  elements.searchBrief.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") elements.searchForm.requestSubmit();
  });
  for (const suggestion of document.querySelectorAll("[data-prompt]")) suggestion.addEventListener("click", () => {
    elements.searchBrief.value = suggestion.dataset.prompt;
    elements.searchBrief.focus();
  });
  for (const navItem of document.querySelectorAll("[data-view]")) navItem.addEventListener("click", () => setView(navItem.dataset.view));
  elements.captureSearchButton.addEventListener("click", captureVisibleSearch);
  const openImport = () => elements.importDialog.showModal();
  elements.openImportButton.addEventListener("click", openImport);
  elements.openImportButtonTop.addEventListener("click", openImport);
  elements.importButton.addEventListener("click", async () => {
    const prospects = parseBulkProspects(elements.bulkInput.value);
    if (!prospects.length) { showToast("Paste at least one valid LinkedIn profile URL."); return; }
    await addProspects(prospects, `Added ${prospects.length} unique prospect${prospects.length === 1 ? "" : "s"}.`);
    elements.bulkInput.value = "";
    elements.importDialog.close();
  });
  elements.processButton.addEventListener("click", () => processQueue());
  elements.draftReadyButton.addEventListener("click", () => createDrafts());
  elements.tableSearch.addEventListener("input", () => { state.query = elements.tableSearch.value.trim(); renderQueue(); });
  elements.statusFilterButton.addEventListener("click", () => {
    state.attentionOnly = !state.attentionOnly;
    elements.statusFilterButton.classList.toggle("is-active", state.attentionOnly);
    renderQueue();
  });
  elements.selectAll.addEventListener("change", () => {
    for (const item of visibleProspects()) {
      if (elements.selectAll.checked) state.selected.add(item.id); else state.selected.delete(item.id);
    }
    renderQueue();
  });
  elements.clearSelectionButton.addEventListener("click", () => { state.selected.clear(); renderQueue(); });
  elements.bulkResearchButton.addEventListener("click", () => processQueue([...state.selected]));
  elements.bulkDraftButton.addEventListener("click", () => createDrafts([...state.selected]));
  elements.exportButton.addEventListener("click", exportCsv);
  elements.copySheetButton.addEventListener("click", copyForSheets);
  elements.collapseSidebar.addEventListener("click", () => {
    document.querySelector(".sidebar").classList.toggle("is-collapsed");
    document.querySelector(".workspace").classList.toggle("sidebar-collapsed");
  });
  elements.closeDrawerButton.addEventListener("click", closeReviewDrawer);
  elements.drawerBackdrop.addEventListener("click", closeReviewDrawer);
  elements.saveReviewButton.addEventListener("click", saveReview);
  elements.approveDraftButton.addEventListener("click", async () => {
    const id = state.activeProspectId;
    if (await saveReview()) { await createDrafts([id]); closeReviewDrawer(); }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.activeProspectId) closeReviewDrawer();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); elements.tableSearch.focus(); }
  });
}

async function initialize() {
  const saved = await storage.get([QUEUE_STORAGE_KEY, "velaGtmSettings"]);
  state.settings = { ...DEFAULT_SETTINGS, ...(saved.velaGtmSettings || {}) };
  if (["light", "dark"].includes(previewTheme)) state.settings.theme = previewTheme;
  applyTheme(state.settings.theme);
  state.queue = saved[QUEUE_STORAGE_KEY] || (!isExtension ? DEMO_QUEUE : []);
  bindEvents();
  renderQueue();
}

applyTheme();
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.settings.theme === "system") applyTheme("system");
});
initialize().catch((error) => showToast(error instanceof Error ? error.message : "Could not open the queue."));
