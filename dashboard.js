import { buildWriterRequest, mergeEnrichedProfile, normalizeWriterResponse, openerQualityIssues } from "./lib/ai-writer.js";
import {
  IMPORT_FIELDS,
  exportMailMergeWorkbook,
  mappedRowsToProspects,
  readSpreadsheet,
} from "./lib/mail-merge.js";
import {
  DEFAULT_SETTINGS,
  applyTemplate,
  buildWorkNote,
  initialsFor,
  isEmail,
  normalizeEnrichmentResponse,
  outreachTemplate,
  resolveTheme,
  templateVariables,
} from "./lib/message.js";
import {
  QUEUE_STATUS,
  QUEUE_STORAGE_KEY,
  parseBulkProspects,
  queueStats,
  upsertProspects,
  withActivity,
} from "./lib/queue.js";
import {
  CAMPAIGNS_STORAGE_KEY,
  addProspectToCampaign,
  campaignProspects,
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  normalizeCampaigns,
  removeProspectFromAllCampaigns,
  removeProspectFromCampaign,
  updateCampaign,
} from "./lib/campaigns.js";
import {
  PROVIDER,
  configuredEnrichmentProviders,
  configuredSearchProviders,
  preferredProvider,
  providerLabel,
} from "./lib/provider-priority.js";
import {
  SCHEDULED_SENDS_STORAGE_KEY,
  normalizeScheduledSends,
} from "./lib/schedule.js";
import {
  DELIVERY_LOG_STORAGE_KEY,
  DELIVERY_STATUS,
  normalizeDeliveryLog,
} from "./lib/delivery-ledger.js";
import {
  buildDailySendSeries,
  collectSentEvents,
  deliveryOutcomeCounts,
  summarizeDailySends,
} from "./lib/analytics.js";
import {
  WORKSPACE_BACKUP_STORAGE_KEY,
  workspaceRecoveryPatch,
} from "./lib/workspace-persistence.js";

const isExtension = Boolean(globalThis.chrome?.runtime?.id);
const pageParams = new URLSearchParams(location.search);
const previewTheme = !isExtension ? pageParams.get("theme") : null;
const previewSidebar = !isExtension ? pageParams.get("sidebar") : null;
const requestedCampaignId = pageParams.get("campaign") || "";
const requestedView = pageParams.get("view") || "";
const WORKSPACE_STATE_STORAGE_KEY = "velaGtmWorkspaceState";
const elements = Object.fromEntries([
  "settingsButton", "searchForm", "searchBrief", "planSearchButton", "searchPlan", "searchStrategy", "searchOptions",
  "captureSearchButton", "openImportButton", "openImportButtonTop", "importDialog", "bulkInput", "importButton", "importHint",
  "spreadsheetImportPanel", "linkedinImportPanel", "importFileInput", "dropZone", "importFileName", "mappingStage", "mappingGrid", "mappingSummary", "mappingIssues", "replaceImportFile",
  "processButton", "mailMergeReadyButton", "queueBody", "emptyState", "totalStat", "readyStat", "draftedStat",
  "sentStat", "attentionStat", "totalDelta", "progressBar", "progressText", "toast", "navTotal", "navResearch", "navReview", "navDrafted", "navTracking",
  "navScheduled", "heroEyebrow", "pageTitle", "pageSubtitle", "workspaceCrumb", "agentPanel", "metricsPanel", "analyticsPanel", "overviewPanel", "overviewReviewCount", "overviewResponseCount", "overviewScheduledCount", "overviewSentTodayCount", "overviewScheduleList", "overviewActivityList", "overviewReviewList", "overviewResponseList", "refreshResponsesButton", "pipelineBar",
  "engagementSent", "engagementReplies", "engagementRate", "engagementRateDetail", "engagementMeetings", "engagementWindow", "conversionSent", "conversionReplied", "conversionBooked",
  "dailySendChart", "analyticsWeekSent", "analyticsDailyAverage", "analyticsBestDay", "analyticsDeliveryBreakdown",
  "operationsPanel", "operationsKicker", "operationsTitle", "operationsDescription", "operationsPrimaryAction", "deliveryList", "queueSection",
  "trackingPanel", "trackingImported", "trackingResearched", "trackingDrafted", "trackingSent", "trackingActivity",
  "queueHeading", "queueDescription", "tableSearch", "statusFilterButton", "resultCount", "selectAll", "bulkBar",
  "selectedCount", "bulkResearchButton", "bulkMailMergeButton", "clearSelectionButton",
  "collapseSidebar", "drawerBackdrop", "reviewDrawer", "closeDrawerButton", "drawerAvatar", "drawerName", "drawerHeadline",
  "drawerLocation", "drawerLinkedIn", "drawerWorkNote", "drawerEmail", "drawerSubject", "drawerBody", "saveReviewButton", "approveDraftButton",
  "drawerEmailChoices", "drawerEmailSource", "drawerEmailStatus", "copyDrawerEmail", "retryDrawerLookup", "drawerExperienceCount", "drawerExperienceList", "drawerActivity", "markSentButton",
  "agentActivity", "agentActivityTitle", "agentActivityDetail", "campaignNav", "newCampaignButton", "newCampaignButtonTop",
  "campaignActions", "campaignActionsButton", "campaignActionsMenu", "editCampaignButton", "duplicateCampaignButton", "deleteCampaignButton",
  "campaignDialog", "campaignForm", "campaignName", "campaignDescription", "campaignDialogKicker", "campaignDialogTitle", "campaignDialogDescription", "campaignSubmitButton", "closeCampaignDialog", "cancelCampaignButton",
  "deleteCampaignDialog", "deleteCampaignDescription", "confirmDeleteCampaignButton",
].map((id) => [id, document.getElementById(id)]));

const DEMO_QUEUE = [
  { url: "https://www.linkedin.com/in/joshua-rivera", name: "Joshua Rivera", headline: "VP, Critical Operations", location: "Seattle, WA", email: "joshua@northstarinfra.com", emailSource: "ContactOut verified contact", contactDetails: { emails: ["joshua@northstarinfra.com", "josh.rivera@gmail.com", "jrivera@yahoo.com"], workEmails: ["joshua@northstarinfra.com"], personalEmails: ["josh.rivera@gmail.com", "jrivera@yahoo.com"], emailStatus: "Verified" }, status: QUEUE_STATUS.READY, subject: "Your work in critical operations + a quick Vela intro", body: "Hi Joshua,\n\nI came across your work leading critical operations at Northstar Infrastructure and would love to learn from your perspective.\n\nBest,\nTarun", workNote: "your work leading critical operations at Northstar Infrastructure", profile: { experiences: [{ title: "VP, Critical Operations", company: "Northstar Infrastructure", dates: "Apr 2026 - Present" }, { title: "Director, Critical Facilities", company: "Northstar Infrastructure", dates: "Sep 2019 - Apr 2026" }, { title: "Critical Facilities Manager", company: "Meridian Data Centers", dates: "Jan 2017 - Sep 2019" }] }, updatedAt: new Date(Date.now() - 8 * 60_000).toISOString() },
  { url: "https://www.linkedin.com/in/maya-chen", name: "Maya Chen", headline: "Director of Energy Strategy", location: "San Francisco, CA", email: "maya@aperturecompute.com", emailSource: "ContactOut work email", status: QUEUE_STATUS.SENT, subject: "Power strategy at Aperture Compute", body: "Hi Maya,\n\nYour work on energy strategy at Aperture Compute stood out to me.", workNote: "your work on energy strategy for high-density compute", replyReceivedAt: new Date(Date.now() - 19 * 60_000).toISOString(), replyPreview: "Interested — can you send a few times that work next week?", activity: [{ type: "reply_received", detail: "Interested — can you send a few times that work next week?", at: new Date(Date.now() - 19 * 60_000).toISOString() }], profile: { experiences: [{ title: "Director of Energy Strategy", company: "Aperture Compute" }] }, updatedAt: new Date(Date.now() - 19 * 60_000).toISOString() },
  { url: "https://www.linkedin.com/in/omar-haddad", name: "Omar Haddad", headline: "Head of Site Selection", location: "Austin, TX", email: "omar@vectorgrid.com", emailSource: "LinkedIn contact info", status: QUEUE_STATUS.READY, subject: "Site selection, power, and a quick introduction", body: "Hi Omar,\n\nYou lead site selection at VectorGrid, and I wanted to ask how power availability is changing which markets your team can pursue.", workNote: "You lead site selection at VectorGrid, and I wanted to ask how power availability is changing which markets your team can pursue.", profile: { experiences: [{ title: "Head of Site Selection", company: "VectorGrid" }] }, updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
  { url: "https://www.linkedin.com/in/elena-rossi", name: "Elena Rossi", headline: "SVP, Infrastructure Development", location: "New York, NY", status: QUEUE_STATUS.PROCESSING, profile: { experiences: [{ title: "SVP, Infrastructure Development", company: "Arcadia Data Centers" }] }, updatedAt: new Date(Date.now() - 4 * 3_600_000).toISOString() },
  { url: "https://www.linkedin.com/in/devon-brooks", name: "Devon Brooks", headline: "Utility Partnerships", location: "Denver, CO", status: QUEUE_STATUS.NEEDS_EMAIL, error: "No verified work email found.", subject: "Utility partnerships at Meridian", body: "Hi Devon,\n\nI’d value your perspective on utility partnership workflows.", profile: { experiences: [{ title: "Director, Utility Partnerships", company: "Meridian Power" }] }, updatedAt: new Date(Date.now() - 23 * 3_600_000).toISOString() },
  { url: "https://www.linkedin.com/in/priya-narayanan", name: "Priya Narayanan", headline: "VP, Power Procurement", location: "Chicago, IL", status: QUEUE_STATUS.NEW, background: "leads power procurement for a large industrial portfolio", profile: { experiences: [{ title: "VP, Power Procurement", company: "Forge Industrial" }] }, updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  { url: "https://www.linkedin.com/in/liam-foster", name: "Liam Foster", headline: "Chief Development Officer", location: "Phoenix, AZ", email: "liam@helioscolo.com", emailSource: "ContactOut work email", status: QUEUE_STATUS.DRAFTED, subject: "Development at Helios + Vela", body: "Hi Liam,\n\nI’d love to learn more about the infrastructure development work you’re leading.", workNote: "your infrastructure development work at Helios Colocation", profile: { experiences: [{ title: "Chief Development Officer", company: "Helios Colocation" }] }, updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
];

const DEMO_CAMPAIGNS = [
  createCampaign({ id: "critical-infrastructure-leaders", name: "Critical infrastructure leaders", description: "Operators responsible for power and uptime", prospectIds: [DEMO_QUEUE[0].url, DEMO_QUEUE[2].url, DEMO_QUEUE[3].url] }),
  createCampaign({ id: "energy-buyers", name: "Energy buyers", description: "Procurement and utility strategy", prospectIds: [DEMO_QUEUE[1].url, DEMO_QUEUE[4].url, DEMO_QUEUE[5].url] }),
];

const DEMO_SCHEDULED_SENDS = [
  {
    id: "demo-scheduled-1",
    accountId: "preview",
    senderEmail: "tarun@vela.energy",
    recipients: ["omar@vectorgrid.com"],
    subject: "Site selection, power, and a quick introduction",
    prospectId: DEMO_QUEUE[2].url,
    scheduledAt: new Date(Date.now() + 72 * 60_000).toISOString(),
    status: DELIVERY_STATUS.SCHEDULED,
    createdAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    completedAt: "",
  },
  {
    id: "demo-scheduled-2",
    accountId: "preview",
    senderEmail: "tarun@vela.energy",
    recipients: ["joshua@northstarinfra.com"],
    subject: "Your work in critical operations + a quick Vela intro",
    prospectId: DEMO_QUEUE[0].url,
    scheduledAt: new Date(Date.now() + 26 * 60 * 60_000).toISOString(),
    status: DELIVERY_STATUS.SCHEDULED,
    createdAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    completedAt: "",
  },
];

const DEMO_DELIVERY_LOG = normalizeDeliveryLog([
  {
    id: "demo-delivery-1",
    mode: "immediate",
    status: DELIVERY_STATUS.SENT,
    senderEmail: "tarun@vela.energy",
    recipients: ["maya@aperturecompute.com"],
    subject: "Power strategy at Aperture Compute",
    prospectId: DEMO_QUEUE[1].url,
    createdAt: new Date(Date.now() - 48 * 60_000).toISOString(),
    completedAt: new Date(Date.now() - 48 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 48 * 60_000).toISOString(),
  },
  {
    id: "demo-delivery-2",
    mode: "scheduled",
    status: DELIVERY_STATUS.SENT,
    senderEmail: "tarun@vela.energy",
    recipients: ["liam@helioscolo.com"],
    subject: "Development at Helios + Vela",
    prospectId: DEMO_QUEUE[6].url,
    scheduledAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
    createdAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
    completedAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
  },
]);

const state = { queue: [], campaigns: [], scheduledJobs: [], deliveryLog: [], activeCampaignId: "", editingCampaignId: "", settings: { ...DEFAULT_SETTINGS }, searchPlan: null, busy: false, toastTimer: null, workspacePersistTimer: null, view: "overview", query: "", selected: new Set(), activeProspectId: null, drawerReturnFocus: null, attentionOnly: false, sidebarCollapsed: false, importSource: "spreadsheet", importData: null };

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

function workspaceStateSnapshot() {
  return {
    view: state.view,
    campaignId: state.activeCampaignId,
    query: state.query,
    attentionOnly: state.attentionOnly,
    sidebarCollapsed: state.sidebarCollapsed,
  };
}

function persistWorkspaceStateSoon() {
  clearTimeout(state.workspacePersistTimer);
  state.workspacePersistTimer = setTimeout(() => {
    storage.set({ [WORKSPACE_STATE_STORAGE_KEY]: workspaceStateSnapshot() }).catch(() => {});
  }, 120);
}

function setSidebarCollapsed(collapsed, { persist = true } = {}) {
  const sidebar = document.querySelector(".sidebar");
  const workspace = document.querySelector(".workspace");
  sidebar.classList.toggle("is-collapsed", collapsed);
  workspace.classList.toggle("sidebar-collapsed", collapsed);
  elements.collapseSidebar.classList.toggle("is-collapsed", collapsed);
  elements.collapseSidebar.setAttribute("aria-expanded", String(!collapsed));
  elements.collapseSidebar.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  elements.collapseSidebar.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  state.sidebarCollapsed = collapsed;
  if (persist) persistWorkspaceStateSoon();
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
  elements.mailMergeReadyButton.disabled = busy;
  elements.captureSearchButton.disabled = busy;
  elements.agentActivity.hidden = !busy;
  if (busy) updateAgentActivity(label.toLowerCase().includes("finding") ? "source" : label.toLowerCase().includes("mail merge") ? "draft" : "research", label);
}

const AGENT_STEP_ORDER = ["plan", "source", "research", "draft"];

function updateAgentActivity(step, title, detail = "Vela is using connected sources and tools") {
  elements.agentActivityTitle.textContent = title;
  elements.agentActivityDetail.textContent = detail;
  const activeIndex = AGENT_STEP_ORDER.indexOf(step);
  for (const node of document.querySelectorAll("[data-agent-step]")) {
    const index = AGENT_STEP_ORDER.indexOf(node.dataset.agentStep);
    node.classList.toggle("is-active", index === activeIndex);
    node.classList.toggle("is-complete", index < activeIndex);
  }
}

async function persistQueue() {
  await storage.set({ [QUEUE_STORAGE_KEY]: state.queue });
}

async function persistCampaigns() {
  await storage.set({ [CAMPAIGNS_STORAGE_KEY]: state.campaigns });
}

function statusLabel(status) {
  return ({
    [QUEUE_STATUS.NEW]: "Queued",
    [QUEUE_STATUS.PROCESSING]: "Researching",
    [QUEUE_STATUS.NEEDS_EMAIL]: "Needs email",
    [QUEUE_STATUS.READY]: "Ready to review",
    [QUEUE_STATUS.DRAFTED]: "Exported",
    [QUEUE_STATUS.SENT]: "Sent",
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

function activeCampaign() {
  return state.campaigns.find((campaign) => campaign.id === state.activeCampaignId) || null;
}

function scopedQueue() {
  const campaign = activeCampaign();
  return campaign ? campaignProspects(state.queue, campaign) : state.queue;
}

function prospectMatchesView(prospect) {
  const campaign = activeCampaign();
  if (campaign && !campaign.prospectIds.includes(prospect.id)) return false;
  if (state.view === "research" && ![QUEUE_STATUS.NEW, QUEUE_STATUS.PROCESSING, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(prospect.status)) return false;
  if (state.view === "review" && prospect.status !== QUEUE_STATUS.READY) return false;
  if (state.view === "drafted" && prospect.status !== QUEUE_STATUS.DRAFTED) return false;
  if (state.view === "tracking" && ![QUEUE_STATUS.DRAFTED, QUEUE_STATUS.SENT].includes(prospect.status) && !(prospect.activity || []).length) return false;
  if (state.attentionOnly && ![QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(prospect.status)) return false;
  if (!state.query) return true;
  const details = companyAndRole(prospect);
  return [prospect.name, prospect.email, prospect.headline, prospect.location, details.company, details.role, prospect.subject].join(" ").toLowerCase().includes(state.query.toLowerCase());
}

function visibleProspects() {
  return state.queue.filter(prospectMatchesView);
}

function renderCampaignNav() {
  const fragment = document.createDocumentFragment();
  for (const campaign of state.campaigns) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nav-item campaign-nav-item${campaign.id === state.activeCampaignId ? " is-active" : ""}`;
    button.title = campaign.description || campaign.name;
    button.dataset.tooltip = campaign.name;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 20 20");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3 5.5h5l1.5 1.7H17v8.3H3z");
    icon.append(path);
    appendText(button, "span", campaign.name);
    appendText(button, "b", String(campaignProspects(state.queue, campaign).length));
    button.prepend(icon);
    button.addEventListener("click", () => setCampaignView(campaign.id));
    fragment.append(button);
  }
  if (!state.campaigns.length) appendText(fragment, "p", "Save someone from the LinkedIn popup or create a campaign.", "campaign-nav-empty");
  elements.campaignNav.replaceChildren(fragment);
}

function renderTracking(scope = state.queue) {
  const allActivity = scope.flatMap((prospect) => (prospect.activity || []).map((event) => ({ ...event, prospect })))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  elements.trackingImported.textContent = scope.filter((item) => item.importedAt || (item.activity || []).some((event) => event.type === "imported")).length;
  elements.trackingResearched.textContent = scope.filter((item) => item.researchedAt || (item.activity || []).some((event) => event.type === "researched")).length;
  elements.trackingDrafted.textContent = scope.filter((item) => item.exportedAt || item.status === QUEUE_STATUS.DRAFTED).length;
  elements.trackingSent.textContent = scope.filter((item) => item.emailSentAt || item.status === QUEUE_STATUS.SENT).length;
  const fragment = document.createDocumentFragment();
  for (const event of allActivity.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "tracking-event";
    appendText(row, "span", initialsFor(event.prospect.name), "tracking-avatar");
    const copy = document.createElement("div");
    appendText(copy, "strong", event.prospect.name || event.prospect.email || "Prospect");
    appendText(copy, "small", event.detail || statusLabel(event.type), "tracking-detail");
    row.append(copy);
    appendText(row, "time", relativeTime(event.at), "tracking-time");
    fragment.append(row);
  }
  if (!allActivity.length) appendText(fragment, "p", "Workflow activity will appear here after an import, research run, draft, export, or sent update.", "tracking-empty");
  elements.trackingActivity.replaceChildren(fragment);
}

function deliveryProspect(record = {}) {
  return state.queue.find((prospect) => prospect.id === record.prospectId || prospect.url === record.prospectId) || null;
}

function deliveryDate(value, { relative = false } = {}) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  if (relative) {
    const remaining = date.getTime() - Date.now();
    if (remaining > 0 && remaining < 3_600_000) return `in ${Math.max(1, Math.round(remaining / 60_000))}m`;
    if (remaining >= 3_600_000 && remaining < 86_400_000) return `in ${Math.round(remaining / 3_600_000)}h`;
    if (remaining >= 86_400_000) return `in ${Math.round(remaining / 86_400_000)}d`;
    return relativeTime(date.toISOString());
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function deliveryStatusLabel(status = "") {
  return ({
    [DELIVERY_STATUS.SCHEDULED]: "Scheduled",
    [DELIVERY_STATUS.SENT]: "Delivered",
    [DELIVERY_STATUS.PARTIAL]: "Partially sent",
    [DELIVERY_STATUS.FAILED]: "Failed",
    [DELIVERY_STATUS.CANCELLED]: "Cancelled",
  })[status] || "Delivery";
}

async function cancelScheduledDelivery(id, button) {
  if (!id) return;
  button.disabled = true;
  try {
    if (isExtension) {
      const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_EMAIL_SCHEDULE_CANCEL", id });
      if (!response?.ok) throw new Error(response?.error || "Could not cancel this scheduled send.");
      const saved = await storage.get([SCHEDULED_SENDS_STORAGE_KEY, DELIVERY_LOG_STORAGE_KEY]);
      state.scheduledJobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]);
      state.deliveryLog = normalizeDeliveryLog(saved[DELIVERY_LOG_STORAGE_KEY]);
    } else {
      const completedAt = new Date().toISOString();
      const job = state.scheduledJobs.find((item) => item.id === id);
      state.scheduledJobs = state.scheduledJobs.map((item) => item.id === id ? { ...item, status: DELIVERY_STATUS.CANCELLED, completedAt } : item);
      state.deliveryLog = normalizeDeliveryLog(state.deliveryLog.map((item) => item.id === id ? { ...item, ...job, status: DELIVERY_STATUS.CANCELLED, completedAt, updatedAt: completedAt } : item));
    }
    renderQueue();
    showToast("Scheduled send cancelled. Nothing was delivered.");
  } catch (error) {
    button.disabled = false;
    showToast(error instanceof Error ? error.message : "Could not cancel this scheduled send.");
  }
}

function createDeliveryRow(record = {}, { compact = false, cancellable = false } = {}) {
  const prospect = deliveryProspect(record);
  const row = document.createElement("article");
  row.className = `delivery-row${compact ? " is-compact" : ""}`;
  const mark = appendText(row, "span", initialsFor(prospect?.name || record.recipients?.[0]), "delivery-avatar");
  mark.setAttribute("aria-hidden", "true");
  const copy = document.createElement("div");
  copy.className = "delivery-copy";
  appendText(copy, "strong", prospect?.name || record.recipients?.join(", ") || "Email delivery");
  appendText(copy, "span", record.subject || "Untitled message", "delivery-subject");
  if (!compact) appendText(copy, "small", [record.recipients?.join(", "), record.senderEmail ? `from ${record.senderEmail}` : ""].filter(Boolean).join(" · ") || "Recipient unavailable", "delivery-meta");
  row.append(copy);
  const timing = document.createElement("div");
  timing.className = "delivery-timing";
  appendText(timing, "span", deliveryStatusLabel(record.status), `delivery-state delivery-state-${record.status}`);
  appendText(timing, "time", compact ? deliveryDate(record.scheduledAt || record.completedAt || record.updatedAt, { relative: true }) : deliveryDate(record.scheduledAt || record.completedAt || record.updatedAt));
  if (!compact && record.error) appendText(timing, "small", record.error, "delivery-error");
  row.append(timing);
  if (cancellable && record.status === DELIVERY_STATUS.SCHEDULED) {
    const cancel = appendText(row, "button", "Cancel", "delivery-cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => cancelScheduledDelivery(record.id, cancel));
  }
  return row;
}

const REPLY_ACTIVITY_TYPES = new Set(["reply", "replied", "reply_received", "gmail_reply"]);
const RESPONSE_ACTIVITY_TYPES = new Set(["response_sent", "reply_sent"]);
const MEETING_ACTIVITY_TYPES = new Set(["meeting", "meeting_booked", "calendar_booked"]);

function latestProspectEvent(prospect, types) {
  return (prospect.activity || [])
    .filter((event) => types.has(event.type))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))[0] || null;
}

function prospectReply(prospect) {
  const event = latestProspectEvent(prospect, REPLY_ACTIVITY_TYPES);
  const at = prospect.replyReceivedAt || event?.at || "";
  if (!at) return null;
  const answered = latestProspectEvent(prospect, RESPONSE_ACTIVITY_TYPES);
  return answered && Date.parse(answered.at) >= Date.parse(at) ? null : {
    at,
    detail: prospect.replyPreview || event?.detail || "Reply received in Gmail",
  };
}

function renderEngagement() {
  const successful = state.deliveryLog.filter((record) => [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status));
  const sentProspects = new Set(successful.map((record) => record.prospectId || record.recipients?.[0]).filter(Boolean));
  for (const prospect of state.queue) if (prospect.emailSentAt || prospect.status === QUEUE_STATUS.SENT) sentProspects.add(prospect.id || prospect.email);
  const replied = state.queue.filter((prospect) => prospect.replyReceivedAt || latestProspectEvent(prospect, REPLY_ACTIVITY_TYPES)).length;
  const booked = state.queue.filter((prospect) => prospect.meetingBookedAt || latestProspectEvent(prospect, MEETING_ACTIVITY_TYPES)).length;
  const sent = sentProspects.size;
  const rate = sent ? Math.round((replied / sent) * 100) : 0;
  elements.engagementSent.textContent = sent;
  elements.engagementReplies.textContent = replied;
  elements.engagementRate.textContent = `${rate}%`;
  elements.engagementRateDetail.textContent = sent ? `${replied} of ${sent} delivered emails` : "No sends yet";
  elements.engagementMeetings.textContent = booked;
  elements.conversionSent.style.setProperty("--value", sent ? "100%" : "0%");
  elements.conversionReplied.style.setProperty("--value", `${Math.min(100, rate)}%`);
  elements.conversionBooked.style.setProperty("--value", `${sent ? Math.min(100, Math.round((booked / sent) * 100)) : 0}%`);
}

function renderAnalytics() {
  renderEngagement();
  const events = collectSentEvents({ deliveryLog: state.deliveryLog, queue: state.queue });
  const series = buildDailySendSeries(events, { days: 14 });
  const summary = summarizeDailySends(series);
  const max = Math.max(1, ...series.map((day) => day.count));
  const chart = document.createDocumentFragment();

  for (const day of series) {
    const column = document.createElement("span");
    column.className = `daily-send-column${day.count ? " has-volume" : ""}`;
    column.title = `${day.shortDate}: ${day.count} successful send${day.count === 1 ? "" : "s"}`;
    const value = appendText(column, "strong", String(day.count));
    value.setAttribute("aria-hidden", "true");
    const bar = document.createElement("i");
    bar.style.setProperty("--bar-height", day.count ? `${Math.max(8, Math.round((day.count / max) * 100))}%` : "2px");
    column.append(bar);
    appendText(column, "small", day.label);
    chart.append(column);
  }
  elements.dailySendChart.replaceChildren(chart);
  elements.dailySendChart.setAttribute("aria-label", `Emails sent per day for the last 14 days. ${summary.total} successful sends total, ${summary.lastSeven} in the last 7 days.`);
  elements.analyticsWeekSent.textContent = summary.lastSeven;
  elements.analyticsDailyAverage.textContent = summary.average ? summary.average.toFixed(1) : "0";
  elements.analyticsBestDay.textContent = summary.best ? `${summary.best.shortDate} · ${summary.best.count}` : "—";

  const counts = deliveryOutcomeCounts({ deliveryLog: state.deliveryLog, scheduledJobs: state.scheduledJobs });
  const outcomes = [
    ["Delivered", counts.sent, "sent"],
    ["Scheduled", counts.scheduled, "scheduled"],
    ["Failed", counts.failed, "failed"],
    ["Cancelled", counts.cancelled, "cancelled"],
  ];
  const outcomeMax = Math.max(1, ...outcomes.map(([, count]) => count));
  const outcomeFragment = document.createDocumentFragment();
  for (const [label, count, status] of outcomes) {
    const row = document.createElement("div");
    row.className = `analytics-outcome analytics-outcome-${status}`;
    appendText(row, "span", label);
    appendText(row, "strong", String(count));
    const track = document.createElement("i");
    track.style.setProperty("--outcome-width", `${Math.round((count / outcomeMax) * 100)}%`);
    row.append(track);
    outcomeFragment.append(row);
  }
  elements.analyticsDeliveryBreakdown.replaceChildren(outcomeFragment);
}

function renderResponseQueue() {
  const waiting = state.queue
    .map((prospect) => ({ prospect, reply: prospectReply(prospect) }))
    .filter((item) => item.reply)
    .sort((a, b) => String(b.reply.at).localeCompare(String(a.reply.at)));
  elements.overviewResponseCount.textContent = waiting.length;
  const fragment = document.createDocumentFragment();
  for (const { prospect, reply } of waiting.slice(0, 6)) {
    const row = document.createElement("article");
    row.className = "response-row";
    appendText(row, "span", initialsFor(prospect.name), "person-avatar");
    const copy = document.createElement("div");
    copy.className = "response-copy";
    const title = document.createElement("span");
    appendText(title, "strong", prospect.name || prospect.email || "Prospect");
    appendText(title, "b", "Reply");
    copy.append(title);
    appendText(copy, "small", reply.detail);
    row.append(copy);
    const actions = document.createElement("div");
    actions.className = "response-actions";
    appendText(actions, "time", relativeTime(reply.at));
    const respond = appendText(actions, "button", "Respond", "row-button");
    respond.type = "button";
    respond.addEventListener("click", () => {
      const query = encodeURIComponent(`from:${prospect.email || ""}`);
      window.open(`https://mail.google.com/mail/u/0/#search/${query}`, "_blank", "noopener,noreferrer");
    });
    row.append(actions);
    fragment.append(row);
  }
  if (!waiting.length) {
    const empty = document.createElement("div");
    empty.className = "response-empty";
    appendText(empty, "strong", "You’re caught up");
    appendText(empty, "p", "Replies you mark from a prospect’s action menu will collect here so you can jump straight into the conversations that need you.");
    const settings = appendText(empty, "button", "Review Gmail setup", "button button-ghost");
    settings.type = "button";
    settings.addEventListener("click", () => isExtension ? chrome.runtime.openOptionsPage() : window.open("options.html", "_blank"));
    fragment.append(empty);
  }
  elements.overviewResponseList.replaceChildren(fragment);
}

function renderOverview() {
  const scheduled = state.scheduledJobs
    .filter((job) => job.status === DELIVERY_STATUS.SCHEDULED)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const nextDay = Date.now() + 24 * 60 * 60_000;
  const deliveredToday = state.deliveryLog.filter((record) => [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status) && Date.parse(record.completedAt || record.updatedAt) >= startOfDay);
  elements.overviewReviewCount.textContent = state.queue.filter((item) => item.status === QUEUE_STATUS.READY).length;
  elements.overviewScheduledCount.textContent = scheduled.filter((job) => Date.parse(job.scheduledAt) <= nextDay).length;
  elements.overviewSentTodayCount.textContent = deliveredToday.length;
  renderResponseQueue();

  const scheduleFragment = document.createDocumentFragment();
  for (const record of scheduled.slice(0, 3)) scheduleFragment.append(createDeliveryRow(record, { compact: true }));
  if (!scheduled.length) appendText(scheduleFragment, "p", "No sends are queued. Review a verified draft in the side panel to schedule one.", "overview-empty");
  elements.overviewScheduleList.replaceChildren(scheduleFragment);

  const activityFragment = document.createDocumentFragment();
  const recent = state.deliveryLog.filter((record) => record.status !== DELIVERY_STATUS.SCHEDULED).slice(0, 3);
  for (const record of recent) activityFragment.append(createDeliveryRow(record, { compact: true }));
  if (!recent.length) appendText(activityFragment, "p", "Delivered, failed, and cancelled sends will build a permanent local log here.", "overview-empty");
  elements.overviewActivityList.replaceChildren(activityFragment);

  const readyProspects = state.queue
    .filter((item) => item.status === QUEUE_STATUS.READY)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, 5);
  const reviewFragment = document.createDocumentFragment();
  for (const prospect of readyProspects) {
    const row = document.createElement("article");
    row.className = "review-row";
    appendText(row, "span", initialsFor(prospect.name), "person-avatar");
    const copy = document.createElement("div");
    copy.className = "review-row-copy";
    appendText(copy, "strong", prospect.name || "LinkedIn prospect");
    appendText(copy, "span", prospect.subject || companyAndRole(prospect).role, "review-row-subject");
    row.append(copy);
    appendText(row, "time", relativeTime(prospect.updatedAt || prospect.createdAt));
    const open = appendText(row, "button", "Review", "row-button");
    open.type = "button";
    open.addEventListener("click", (event) => openReviewDrawer(prospect.id, event.currentTarget));
    reviewFragment.append(row);
  }
  if (!readyProspects.length) appendText(reviewFragment, "p", "No drafts are waiting. Research a prospect and its draft lands here for approval.", "overview-empty");
  elements.overviewReviewList.replaceChildren(reviewFragment);
}

function renderDeliveryOperations() {
  if (!["scheduled", "history"].includes(state.view)) return;
  const scheduledView = state.view === "scheduled";
  const records = scheduledView
    ? state.scheduledJobs.filter((job) => job.status === DELIVERY_STATUS.SCHEDULED).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
    : state.deliveryLog.filter((record) => record.status !== DELIVERY_STATUS.SCHEDULED);
  elements.operationsKicker.textContent = scheduledView ? "Delivery queue" : "Delivery ledger";
  elements.operationsTitle.textContent = scheduledView ? "Scheduled sends" : "Every delivery, in one place";
  elements.operationsDescription.textContent = scheduledView
    ? "These reviewed messages are persisted in Chrome and will run through Gmail at the listed time."
    : "A local audit trail of sent, partial, failed, and cancelled deliveries—without inbox-reading access.";
  elements.operationsPrimaryAction.textContent = scheduledView ? "Review more drafts" : "Open review queue";
  const fragment = document.createDocumentFragment();
  for (const record of records) fragment.append(createDeliveryRow(record, { cancellable: scheduledView }));
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "delivery-empty";
    appendText(empty, "h3", scheduledView ? "No sends are scheduled" : "No delivery history yet");
    appendText(empty, "p", scheduledView ? "Choose Schedule sends in the side panel, review the message, and click Schedule send." : "Once a reviewed email sends, its recipient, subject, sender, and result will appear here.");
    fragment.append(empty);
  }
  elements.deliveryList.replaceChildren(fragment);
}

function closeProspectMenu() {
  document.querySelector(".prospect-popover")?.remove();
  for (const trigger of document.querySelectorAll(".row-menu[aria-expanded='true']")) trigger.setAttribute("aria-expanded", "false");
}

function prospectMenuAction(menu, label, handler, { destructive = false } = {}) {
  const button = appendText(menu, "button", label);
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.classList.toggle("is-destructive", destructive);
  button.addEventListener("click", async () => {
    closeProspectMenu();
    await handler();
  });
  return button;
}

function openProspectMenu(anchor, prospect, campaign) {
  closeProspectMenu();
  const menu = document.createElement("div");
  menu.className = "prospect-popover";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Actions for ${prospect.name || "prospect"}`);
  prospectMenuAction(menu, prospect.subject ? "Open details" : "Open prospect", () => openReviewDrawer(prospect.id, anchor));
  if (![QUEUE_STATUS.DRAFTED, QUEUE_STATUS.SENT].includes(prospect.status) && prospect.url) {
    prospectMenuAction(menu, prospect.status === QUEUE_STATUS.ERROR ? "Retry research" : "Research prospect", () => processQueue([prospect.id]));
  }
  if (prospect.email) {
    prospectMenuAction(menu, "Compose in Gmail", () => {
      const query = encodeURIComponent(`to:${prospect.email}`);
      window.open(`https://mail.google.com/mail/u/0/#search/${query}`, "_blank", "noopener,noreferrer");
    });
  }
  const waitingReply = prospectReply(prospect);
  if (waitingReply) {
    prospectMenuAction(menu, "Mark response handled", async () => {
      const at = new Date().toISOString();
      state.queue = state.queue.map((item) => item.id === prospect.id ? withActivity(item, "response_sent", "Response handled in Gmail", at) : item);
      await persistQueue();
      renderQueue();
      showToast(`${prospect.name || "Conversation"} marked handled.`);
    });
  } else if (prospect.emailSentAt || prospect.status === QUEUE_STATUS.SENT || state.deliveryLog.some((record) => record.prospectId === prospect.id && [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status))) {
    prospectMenuAction(menu, "Mark reply received…", async () => {
      const detail = globalThis.prompt(`What did ${prospect.name || "this prospect"} say?`, "Reply received in Gmail")?.trim();
      if (!detail) return;
      const at = new Date().toISOString();
      state.queue = state.queue.map((item) => item.id === prospect.id ? {
        ...withActivity(item, "reply_received", detail, at),
        replyReceivedAt: at,
        replyPreview: detail,
      } : item);
      await persistQueue();
      renderQueue();
      showToast(`${prospect.name || "Prospect"} added to Needs a response.`);
    });
  }
  const separator = document.createElement("hr");
  separator.setAttribute("role", "separator");
  menu.append(separator);
  const destructiveLabel = campaign ? `Remove from ${campaign.name}` : "Delete prospect…";
  prospectMenuAction(menu, destructiveLabel, async () => {
    const confirmed = globalThis.confirm(campaign
      ? `Remove ${prospect.name || "this prospect"} from “${campaign.name}”? The prospect and research will stay in All prospects.`
      : `Delete ${prospect.name || "this prospect"} from Vela GTM? This removes its saved research and draft.`);
    if (!confirmed) return;
    if (campaign) {
      state.campaigns = removeProspectFromCampaign(state.campaigns, campaign.id, prospect.url || prospect.email || prospect.id);
      await persistCampaigns();
    } else {
      state.queue = state.queue.filter((item) => item.id !== prospect.id);
      state.campaigns = removeProspectFromAllCampaigns(state.campaigns, prospect.url || prospect.email || prospect.id);
      await storage.set({ [QUEUE_STORAGE_KEY]: state.queue, [CAMPAIGNS_STORAGE_KEY]: state.campaigns });
    }
    state.selected.delete(prospect.id);
    renderQueue();
    showToast(campaign ? `${prospect.name || "Prospect"} removed from ${campaign.name}.` : `${prospect.name || "Prospect"} deleted.`);
  }, { destructive: true });
  document.body.append(menu);
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, anchorRect.right - menuRect.width));
  const fitsBelow = anchorRect.bottom + menuRect.height + 8 <= window.innerHeight;
  const top = fitsBelow ? anchorRect.bottom + 5 : Math.max(8, anchorRect.top - menuRect.height - 5);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  anchor.setAttribute("aria-expanded", "true");
  menu.querySelector("button")?.focus();
}

function renderQueue() {
  closeProspectMenu();
  const scope = scopedQueue();
  const stats = queueStats(scope);
  const campaign = activeCampaign();
  const scheduledCount = state.scheduledJobs.filter((job) => job.status === DELIVERY_STATUS.SCHEDULED).length;
  const deliveredCount = state.deliveryLog.filter((record) => [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status)).length;
  renderCampaignNav();
  elements.totalStat.textContent = stats.total;
  elements.readyStat.textContent = stats.ready;
  elements.draftedStat.textContent = scheduledCount;
  elements.sentStat.textContent = deliveredCount;
  elements.attentionStat.textContent = stats.attention;
  const pipelineSegments = { research: stats.attention, review: stats.ready, scheduled: scheduledCount, delivered: deliveredCount };
  for (const segment of elements.pipelineBar.children) {
    const value = pipelineSegments[segment.dataset.stage] || 0;
    segment.style.flexGrow = value;
    segment.classList.toggle("is-empty", value === 0);
  }
  elements.totalDelta.textContent = campaign ? `In ${campaign.name}` : "Across your workspace";
  elements.campaignActions.hidden = !campaign;
  elements.navTotal.textContent = state.queue.length;
  elements.navResearch.textContent = state.queue.filter((item) => [QUEUE_STATUS.NEW, QUEUE_STATUS.PROCESSING, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status)).length;
  elements.navReview.textContent = stats.ready;
  elements.navDrafted.textContent = stats.drafted;
  elements.navScheduled.textContent = scheduledCount;
  elements.navTracking.textContent = deliveredCount;
  elements.agentPanel.hidden = state.view !== "research";
  elements.metricsPanel.hidden = state.view !== "overview";
  elements.analyticsPanel.hidden = state.view !== "analytics";
  elements.overviewPanel.hidden = state.view !== "overview";
  elements.operationsPanel.hidden = !["scheduled", "history"].includes(state.view);
  elements.queueSection.hidden = ["overview", "analytics", "scheduled", "history"].includes(state.view);
  elements.trackingPanel.hidden = state.view !== "tracking";
  renderTracking(scope);
  renderOverview();
  renderAnalytics();
  renderDeliveryOperations();
  const visible = visibleProspects();
  elements.emptyState.hidden = visible.length > 0;
  elements.queueBody.hidden = visible.length === 0;
  elements.resultCount.textContent = `${visible.length} prospect${visible.length === 1 ? "" : "s"}`;
  elements.mailMergeReadyButton.disabled = state.busy || stats.ready === 0;
  elements.selectAll.checked = visible.length > 0 && visible.every((item) => state.selected.has(item.id));
  elements.selectAll.indeterminate = visible.some((item) => state.selected.has(item.id)) && !elements.selectAll.checked;
  elements.selectedCount.textContent = state.selected.size;
  elements.bulkBar.hidden = state.selected.size === 0;
  const emptyTitle = elements.emptyState.querySelector("h3");
  const emptyDescription = elements.emptyState.querySelector("p");
  emptyTitle.textContent = campaign ? `No prospects in ${campaign.name}` : "No prospects in this view";
  emptyDescription.textContent = campaign ? "Add someone from the LinkedIn popup, or import a list while this campaign is selected." : "Try another filter or ask the Vela agent to build a new search.";

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
    const linkedIn = appendText(copy, prospect.url ? "a" : "span", prospect.location || (prospect.url ? "View LinkedIn" : "Spreadsheet import"));
    if (prospect.url) {
      linkedIn.href = prospect.url;
      linkedIn.target = "_blank";
      linkedIn.rel = "noreferrer";
    }
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
      review.addEventListener("click", (event) => openReviewDrawer(prospect.id, event.currentTarget));
    } else if (![QUEUE_STATUS.DRAFTED, QUEUE_STATUS.SENT].includes(prospect.status) && prospect.url) {
      const research = appendText(actions, "button", prospect.status === QUEUE_STATUS.ERROR ? "Retry" : "Research", "row-button");
      research.type = "button";
      research.addEventListener("click", () => processQueue([prospect.id]));
    }
    if (prospect.subject && prospect.status !== QUEUE_STATUS.READY) {
      const review = appendText(actions, "button", [QUEUE_STATUS.DRAFTED, QUEUE_STATUS.SENT].includes(prospect.status) ? "Details" : "Open", "row-button");
      review.type = "button";
      review.addEventListener("click", (event) => openReviewDrawer(prospect.id, event.currentTarget));
    }
    const more = appendText(actions, "button", "···", "row-button row-menu");
    more.type = "button";
    more.title = `More actions for ${prospect.name || "prospect"}`;
    more.setAttribute("aria-label", more.title);
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const alreadyOpen = more.getAttribute("aria-expanded") === "true";
      closeProspectMenu();
      if (!alreadyOpen) openProspectMenu(more, prospect, campaign);
    });

    row.append(checkCell, personCell, roleCell, emailCell, statusCell, draftCell, updatedCell, actions);
    fragment.append(row);
  }
  elements.queueBody.replaceChildren(fragment);
}

async function addProspects(prospects, message) {
  const before = state.queue.length;
  state.queue = upsertProspects(state.queue, prospects);
  if (state.activeCampaignId) {
    for (const prospect of prospects) state.campaigns = addProspectToCampaign(state.campaigns, state.activeCampaignId, prospect.url || prospect.email || prospect.id);
  }
  await storage.set({ [QUEUE_STORAGE_KEY]: state.queue, [CAMPAIGNS_STORAGE_KEY]: state.campaigns });
  renderQueue();
  showToast(message || `${state.queue.length - before} prospect${state.queue.length - before === 1 ? "" : "s"} added.`);
}

function setImportSource(source = "spreadsheet") {
  state.importSource = source;
  for (const button of document.querySelectorAll("[data-import-source]")) {
    const active = button.dataset.importSource === source;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  elements.spreadsheetImportPanel.hidden = source !== "spreadsheet";
  elements.linkedinImportPanel.hidden = source !== "linkedin";
  elements.importButton.disabled = source === "spreadsheet" ? !state.importData : !parseBulkProspects(elements.bulkInput.value).length;
  elements.importButton.textContent = source === "spreadsheet" ? "Import prospects" : "Add to workspace";
}

function mappingValid() {
  if (!state.importData) return false;
  const { mapping } = state.importData;
  const identities = mapping.includes("email") || mapping.includes("linkedInUrl");
  const duplicates = mapping.filter((field) => field !== "skip" && mapping.indexOf(field) !== mapping.lastIndexOf(field));
  const messages = [];
  if (!identities) messages.push("Map at least one Recipient email or LinkedIn URL column.");
  if (duplicates.length) messages.push(`Each field can only be mapped once: ${[...new Set(duplicates)].join(", ")}.`);
  elements.mappingIssues.hidden = messages.length === 0;
  elements.mappingIssues.textContent = messages.join(" ");
  return !messages.length;
}

function renderImportMapping() {
  const data = state.importData;
  if (!data) return;
  const fragment = document.createDocumentFragment();
  data.headers.forEach((header, columnIndex) => {
    const column = document.createElement("article");
    column.className = `mapping-column${data.mapping[columnIndex] === "skip" ? " is-skipped" : ""}`;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Map ${header}`);
    for (const field of IMPORT_FIELDS) {
      const option = document.createElement("option");
      option.value = field.value;
      option.textContent = field.label;
      option.selected = data.mapping[columnIndex] === field.value;
      select.append(option);
    }
    select.addEventListener("change", () => {
      data.mapping[columnIndex] = select.value;
      renderImportMapping();
    });
    column.append(select);
    appendText(column, "strong", header, "mapping-source-name");
    for (const row of data.rows.slice(0, 4)) appendText(column, "span", row[columnIndex] instanceof Date ? row[columnIndex].toLocaleString() : String(row[columnIndex] ?? "") || "Empty", "mapping-sample");
    fragment.append(column);
  });
  elements.mappingGrid.replaceChildren(fragment);
  elements.mappingSummary.textContent = `${data.rows.length.toLocaleString()} row${data.rows.length === 1 ? "" : "s"} on ${data.sheetName}. Review the automatic mapping before import.`;
  elements.mappingStage.hidden = false;
  elements.dropZone.hidden = true;
  elements.importButton.disabled = !mappingValid();
}

async function loadImportFile(file) {
  if (!file) return;
  try {
    elements.importButton.disabled = true;
    elements.importFileName.textContent = `Reading ${file.name}…`;
    const parsed = readSpreadsheet(await file.arrayBuffer());
    state.importData = { ...parsed, fileName: file.name };
    elements.importFileName.textContent = file.name;
    renderImportMapping();
  } catch (error) {
    state.importData = null;
    elements.importFileName.textContent = "Drop a spreadsheet here";
    elements.mappingStage.hidden = true;
    elements.dropZone.hidden = false;
    showToast(error instanceof Error ? error.message : "Could not read that spreadsheet.");
  }
}

function resetImportDialog() {
  state.importData = null;
  elements.importFileInput.value = "";
  elements.importFileName.textContent = "Drop a spreadsheet here";
  elements.mappingStage.hidden = true;
  elements.dropZone.hidden = false;
  elements.mappingGrid.replaceChildren();
  elements.mappingIssues.hidden = true;
  setImportSource("spreadsheet");
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
  state.searchPlan = plan;
  elements.searchStrategy.textContent = plan.strategy;
  const fragment = document.createDocumentFragment();
  const providerNames = configuredSearchProviders(state.settings).map(providerLabel);
  const providerActionLabel = providerNames.length
    ? `Search ${providerNames.join(" → ")}`
    : "Connect Apollo or ContactOut";
  for (const search of plan.searches || []) {
    const option = document.createElement("div");
    option.className = "search-option";
    appendText(option, "strong", search.label);
    appendText(option, "p", `${search.query} — ${search.rationale}`);

    const actions = document.createElement("div");
    actions.className = "search-option-actions";
    const providerButton = appendText(actions, "button", providerActionLabel, "search-provider-button");
    providerButton.type = "button";
    providerButton.addEventListener("click", () => runPlannedSearch(search));
    const linkedInButton = appendText(actions, "button", "LinkedIn ↗", "search-linkedin-button");
    linkedInButton.type = "button";
    linkedInButton.title = "Open this strategy in LinkedIn as a manual fallback";
    linkedInButton.addEventListener("click", () => openLinkedInSearch(search.query));
    option.append(actions);
    fragment.append(option);
  }
  elements.searchOptions.replaceChildren(fragment);
  elements.searchPlan.hidden = false;
}

async function runPlannedSearch(search) {
  if (!configuredSearchProviders(state.settings).length) {
    showToast("Connect ContactOut or Apollo in Settings to search people directly.");
    if (isExtension) chrome.runtime.openOptionsPage();
    else window.open("options.html", "_blank");
    return;
  }
  try {
    const providers = configuredSearchProviders(state.settings).map(providerLabel);
    setBusy(true, `Finding people with ${providers.join(" and ")}`);
    updateAgentActivity("source", `Searching ${providers.join(" → ")}`, "Matching titles, seniority, and profile keywords");
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_PEOPLE_SEARCH", filters: search.filters });
    if (!response?.ok) throw new Error(response?.error || "Provider People Search failed.");
    const prospects = response.data?.prospects || [];
    if (!prospects.length) throw new Error(`${providers.join(" and ")} found no people for this strategy. Try a broader plan.`);
    const source = response.data.providerLabel || "provider search";
    await addProspects(prospects, `Added ${prospects.length} of ${response.data.total || prospects.length} people from ${source}.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "People search failed.");
  } finally {
    setBusy(false);
    renderQueue();
  }
}

async function planSearch(brief) {
  elements.agentActivity.hidden = false;
  updateAgentActivity("plan", "Planning your search", "Turning the brief into focused people searches");
  if (!isExtension) {
    renderSearchPlan({
      strategy: "Split the brief into operating ownership, power responsibility, and mission-critical infrastructure so each search stays specific.",
      searches: [
        { label: "Critical operations", query: "critical operations data center power", rationale: "Targets operators responsible for uptime and electrical systems.", filters: { job_title: ["Critical Operations", "Data Center Operations"], seniority: ["Manager", "Director"], skills: ["Critical Facilities"], location: [], industry: [], company: [], keyword: "power infrastructure" } },
        { label: "Energy strategy", query: "data center energy infrastructure power procurement", rationale: "Targets leaders involved in power availability and procurement.", filters: { job_title: ["Energy Strategy", "Power Procurement"], seniority: ["Director", "VP"], skills: [], location: [], industry: [], company: [], keyword: "power procurement" } },
      ],
    });
    elements.agentActivity.hidden = true;
    return;
  }
  if (state.settings.openAIApiKey) {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_PLAN_SEARCH", brief });
    if (!response?.ok) throw new Error(response?.error || "Vela search planning failed.");
    renderSearchPlan(response.data);
    elements.agentActivity.hidden = true;
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
  elements.agentActivity.hidden = true;
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

async function callEnrichment(profile, { approveSessionReveal = false } = {}) {
  const providers = configuredEnrichmentProviders(state.settings);
  if (providers.length) {
    let lastError;
    for (const provider of providers) {
      try {
        const response = await chrome.runtime.sendMessage({ type: `VELA_GTM_PROVIDER_${provider}`, profile });
        if (!response?.ok) throw new Error(response?.error || `${provider} lookup failed.`);
        let providerData = response.data;
        if (provider === PROVIDER.CONTACTOUT_SESSION && providerData?.requiresReveal) {
          if (!approveSessionReveal) throw new Error("ContactOut found contact information, but its credit reveal was not approved.");
          const reveal = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_CONTACTOUT_SESSION_REVEAL", revealToken: providerData.revealToken });
          if (!reveal?.ok) throw new Error(reveal?.error || "ContactOut reveal failed.");
          providerData = reveal.data;
        }
        const result = normalizeEnrichmentResponse({ ...providerData, emailSource: providerData.source });
        const status = String(result.emailStatuses?.[result.email] || result.emailStatus || "").toLowerCase();
        if (result.email && ["verified", "valid"].includes(status)) return result;
        lastError = new Error(`${providerLabel(provider)} did not return an explicitly verified email.`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(`${provider} lookup failed.`);
      }
    }
    throw lastError || new Error("No configured provider returned a verified email.");
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
  const template = outreachTemplate(state.settings);
  return applyTemplate(template, templateVariables(profile, state.settings, workNote, template));
}

async function callWriter(profile, workNote, draft) {
  const template = outreachTemplate(state.settings);
  const templateSettings = {
    ...state.settings,
    senderName: template.senderName || state.settings.senderName,
    calendarUrl: template.calendarUrl || state.settings.calendarUrl,
  };
  if (state.settings.openAIApiKey) {
    const input = buildWriterRequest(profile, templateSettings, workNote, draft, { generationMode: "personalization", template });
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_WRITE", input });
    if (!response?.ok) throw new Error(response?.error || "OpenAI writing failed.");
    const result = normalizeWriterResponse({ data: response.data, model: state.settings.openAIModel || "gpt-5.4-mini" }, profile);
    const openerIssues = openerQualityIssues(result.workNote);
    if (openerIssues.length) throw new Error(`The AI writer returned a generic opener. ${openerIssues.join(" ")}`);
    return result;
  }
  if (!state.settings.writerEndpointUrl) throw new Error("Add an OpenAI key in Settings before researching prospects.");
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (state.settings.writerToken) headers.Authorization = `Bearer ${state.settings.writerToken}`;
  const response = await fetch(state.settings.writerEndpointUrl, {
    method: "POST", headers, body: JSON.stringify(buildWriterRequest(profile, templateSettings, workNote, draft, { generationMode: "personalization", template })),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `AI writer returned ${response.status}.`);
  const result = normalizeWriterResponse(payload, profile);
  if (!result.workNote) throw new Error("The AI writer returned no personalization.");
  const openerIssues = openerQualityIssues(result.workNote);
  if (openerIssues.length) throw new Error(`The AI writer returned a generic opener. ${openerIssues.join(" ")}`);
  return result;
}

async function researchProspect(prospect, { approveSessionReveal = false } = {}) {
  let tab;
  try {
    const providerSourced = /^(ContactOut|Apollo) People Search$/i.test(prospect.source || "") && prospect.profile;
    let profile;
    if (providerSourced) {
      profile = {
        ...prospect.profile,
        url: prospect.url,
        name: prospect.profile.name || prospect.name,
        headline: prospect.profile.headline || prospect.headline,
        location: prospect.profile.location || prospect.location,
        workNote: prospect.background || prospect.workNote,
      };
    } else {
      tab = await chrome.tabs.create({ url: prospect.url, active: false });
      await waitForTab(tab.id);
      const profileResponse = await sendLinkedInMessage(tab.id, { type: "VELA_GTM_EXTRACT_PROFILE" });
      if (!profileResponse?.ok) throw new Error(profileResponse?.error || "Could not read the LinkedIn profile.");
      profile = { ...profileResponse.profile, workNote: prospect.background || prospect.workNote };
    }

    const priorProviderEmail = /^(ContactOut|Apollo)\b/i.test(prospect.emailSource || "")
      || (prospect.contactDetails?.emails || []).includes(prospect.email);
    const preservedEmail = priorProviderEmail ? "" : prospect.email || "";
    let email = profile.visibleEmail || preservedEmail;
    let emailSource = profile.visibleEmail ? "Visible on profile" : preservedEmail ? prospect.emailSource || "Saved contact" : "";
    let contactDetails = { emails: [], workEmails: [], personalEmails: [], phones: [], emailStatus: "", emailStatuses: {}, error: "" };
    let contactOutError = "";
    let workNote = prospect.background || buildWorkNote(profile);
    if (state.settings.contactOutSessionEnabled || state.settings.contactOutApiKey || state.settings.apolloApiKey || state.settings.endpointUrl) {
      try {
        const enriched = await callEnrichment(profile, { approveSessionReveal });
        if (enriched.email) { email = enriched.email; emailSource = enriched.emailSource || "Enrichment service"; }
        contactDetails = {
          emails: enriched.emails || [], workEmails: enriched.workEmails || [], personalEmails: enriched.personalEmails || [],
          phones: enriched.phones || [], emailStatus: enriched.emailStatus || "", emailStatuses: enriched.emailStatuses || {}, source: enriched.emailSource || "", error: "",
        };
        if (enriched.note) workNote = enriched.note;
        if (enriched.profile) {
          profile = mergeEnrichedProfile(profile, enriched);
        }
      } catch (error) {
        const provider = providerLabel(preferredProvider(state.settings));
        contactOutError = error instanceof Error ? error.message : `${provider} lookup failed.`;
        contactDetails = { ...contactDetails, source: `${provider} API error`, error: contactOutError };
      }
    }
    if (!email && tab?.id) {
      try {
        const contact = await chrome.tabs.sendMessage(tab.id, { type: "VELA_GTM_FIND_LINKEDIN_EMAIL" });
        if (contact?.email) { email = contact.email; emailSource = "LinkedIn contact info"; }
      } catch {
        // LinkedIn Contact info is the final fallback after ContactOut.
      }
    }

    const fallback = templateDraft(profile, workNote);
    const written = await callWriter(profile, workNote, fallback);
    const personalizedDraft = templateDraft(profile, written.workNote || workNote);

    const researchedAt = new Date().toISOString();
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
      subject: personalizedDraft.subject,
      body: personalizedDraft.body,
      status: isEmail(email) ? QUEUE_STATUS.READY : QUEUE_STATUS.NEEDS_EMAIL,
      error: isEmail(email) ? "" : contactOutError || (providerSourced
        ? "No verified email was returned by the configured contact-data providers."
        : "No email was available in LinkedIn Contact Info or the configured enrichment service."),
      researchedAt,
      activity: [...(prospect.activity || []), { type: "researched", detail: "Profile researched and template personalization generated", at: researchedAt }].slice(-80),
      updatedAt: researchedAt,
    };
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function processQueue(ids = null) {
  if (state.busy) return;
  if (!isExtension) {
    const targets = new Set(ids || scopedQueue().filter((item) => [QUEUE_STATUS.NEW, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status)).map((item) => item.id));
    const researchedAt = new Date().toISOString();
    state.queue = state.queue.map((item) => targets.has(item.id) ? {
      ...withActivity(item, "researched", "Preview profile researched", researchedAt),
      email: item.email || `${(item.name || "prospect").toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@example.com`,
      subject: item.subject || `A quick Vela introduction for ${item.name || "you"}`,
      body: item.body || `Hi ${(item.name || "there").split(" ")[0]},\n\nI came across your work and would love to learn from your perspective.\n\nBest,\n${state.settings.senderName}`,
      workNote: item.workNote || item.background || `your work in ${item.headline || "energy infrastructure"}`,
      status: QUEUE_STATUS.READY,
      error: "",
      researchedAt,
    } : item);
    await persistQueue();
    renderQueue();
    showToast("Preview queue researched.");
    return;
  }

  const candidates = scopedQueue().filter((item) => ids ? ids.includes(item.id) : [QUEUE_STATUS.NEW, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status));
  if (!candidates.length) { showToast("There are no prospects waiting for research."); return; }
  if (!state.settings.openAIApiKey && !state.settings.writerEndpointUrl) {
    showToast("Configure an OpenAI key or AI writer endpoint before researching prospects.");
    return;
  }
  try {
    let approveSessionReveal = false;
    if (state.settings.contactOutSessionEnabled) {
      approveSessionReveal = globalThis.confirm(`ContactOut will preview ${candidates.length} profile${candidates.length === 1 ? "" : "s"} and may use up to ${candidates.length} email credit${candidates.length === 1 ? "" : "s"} if contacts are found. Continue?`);
      if (!approveSessionReveal) { showToast("ContactOut reveal cancelled. No credits were used."); return; }
    }
    if (!state.settings.contactOutApiKey && !state.settings.apolloApiKey && state.settings.endpointUrl && !(await ensureOriginPermission(state.settings.endpointUrl))) throw new Error("Email enrichment access was declined.");
    if (!state.settings.openAIApiKey && state.settings.writerEndpointUrl && !(await ensureOriginPermission(state.settings.writerEndpointUrl))) throw new Error("AI writer access was declined.");
    setBusy(true);
    for (let index = 0; index < candidates.length; index += 1) {
      const current = candidates[index];
      elements.progressText.textContent = `Researching ${index + 1} of ${candidates.length}`;
      const sourceDetail = /^(ContactOut|Apollo) People Search$/i.test(current.source || "")
        ? "provider profile, contact enrichment, and draft context"
        : "LinkedIn, enrichment providers, and draft context";
      updateAgentActivity("research", `Researching ${current.name || `prospect ${index + 1}`}`, `Profile ${index + 1} of ${candidates.length} - ${sourceDetail}`);
      state.queue = state.queue.map((item) => item.id === current.id ? { ...item, status: QUEUE_STATUS.PROCESSING, error: "" } : item);
      renderQueue();
      try {
        const result = await researchProspect(current, { approveSessionReveal });
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

async function exportReadyMailMerge(ids = null) {
  if (state.busy) return;
  const exportableStatuses = ids ? [QUEUE_STATUS.READY, QUEUE_STATUS.DRAFTED] : [QUEUE_STATUS.READY];
  const ready = scopedQueue().filter((item) => exportableStatuses.includes(item.status) && (!ids || ids.includes(item.id)));
  if (!ready.length) { showToast("No reviewed messages are ready for mail merge."); return; }
  await exportMailMergeItems(ready);
}

const VIEW_COPY = {
  overview: { eyebrow: "Overview", title: "Overview", description: "What needs a decision, what is scheduled, and what already went out.", queueTitle: "All prospects", queueDescription: "Every prospect across research, review, and delivery." },
  research: { eyebrow: "AI research", title: "AI research", description: "Describe who you want to reach. Vela plans the searches, verifies contact details, and prepares drafts.", queueTitle: "Research queue", queueDescription: "Prospects waiting for enrichment, context, or a first draft." },
  review: { eyebrow: "Review queue", title: "Review queue", description: "Approve the recipient, personalization, and message before anything can send.", queueTitle: "Review queue", queueDescription: "Drafts that need a human decision before delivery." },
  analytics: { eyebrow: "Analytics", title: "Analytics", description: "Daily outreach volume, delivery outcomes, replies, and meetings from this Chrome workspace.", queueTitle: "Analytics", queueDescription: "Local outreach performance." },
  scheduled: { eyebrow: "Scheduled sends", title: "Scheduled sends", description: "Queued Gmail sends in delivery order. Cancel any of them until delivery starts.", queueTitle: "Scheduled sends", queueDescription: "Queued Gmail delivery." },
  history: { eyebrow: "Sent history", title: "Sent history", description: "Every delivery with its recipient, subject, sender, and result.", queueTitle: "Delivery history", queueDescription: "Local delivery log." },
  all: { eyebrow: "All prospects", title: "All prospects", description: "Everyone in this workspace, across research, review, and delivery.", queueTitle: "All prospects", queueDescription: "Every prospect across research, review, and delivery." },
  drafted: { eyebrow: "Mail merge exports", title: "Mail merge exports", description: "Approved messages exported for bulk sending, with personalization and sent dates intact.", queueTitle: "Mail merge exports", queueDescription: "Approved messages exported for review and sending in your mail-merge tool." },
  tracking: { eyebrow: "Activity", title: "Activity", description: "Stored import, research, draft, export, and sent events for every prospect.", queueTitle: "Tracking", queueDescription: "Stored workflow activity for every prospect." },
};

function setView(view, { preserveFilters = false, persist = true } = {}) {
  setCampaignMenu(false);
  state.view = view;
  state.activeCampaignId = "";
  if (!preserveFilters) state.attentionOnly = false;
  state.selected.clear();
  elements.statusFilterButton.classList.toggle("is-active", state.attentionOnly);
  for (const button of document.querySelectorAll("[data-view]")) button.classList.toggle("is-active", button.dataset.view === view);
  const copy = VIEW_COPY[view] || VIEW_COPY.all;
  elements.workspaceCrumb.textContent = copy.title;
  elements.heroEyebrow.lastChild.textContent = copy.eyebrow;
  elements.pageTitle.textContent = copy.title;
  elements.pageSubtitle.textContent = copy.description;
  elements.queueHeading.textContent = copy.queueTitle;
  elements.queueDescription.textContent = copy.queueDescription;
  renderQueue();
  if (persist) persistWorkspaceStateSoon();
}

function setCampaignView(campaignId, { preserveFilters = false, persist = true } = {}) {
  const campaign = state.campaigns.find((item) => item.id === campaignId);
  if (!campaign) return;
  setCampaignMenu(false);
  state.view = "campaign";
  state.activeCampaignId = campaign.id;
  if (!preserveFilters) state.attentionOnly = false;
  state.selected.clear();
  elements.statusFilterButton.classList.toggle("is-active", state.attentionOnly);
  for (const button of document.querySelectorAll("[data-view]")) button.classList.remove("is-active");
  elements.workspaceCrumb.textContent = campaign.name;
  elements.heroEyebrow.lastChild.textContent = "Campaign workspace";
  elements.pageTitle.textContent = campaign.name;
  elements.pageSubtitle.textContent = campaign.description || "A focused outreach list with its research, review state, and delivery history intact.";
  elements.queueHeading.textContent = campaign.name;
  elements.queueDescription.textContent = campaign.description || "Prospects saved to this campaign, with their latest personalization notes.";
  renderQueue();
  if (persist) persistWorkspaceStateSoon();
}

function setCampaignMenu(open) {
  elements.campaignActionsMenu.hidden = !open;
  elements.campaignActionsButton.setAttribute("aria-expanded", String(open));
}

function openCampaignCreator() {
  state.editingCampaignId = "";
  elements.campaignDialogKicker.textContent = "Organize outreach";
  elements.campaignDialogTitle.textContent = "Create campaign";
  elements.campaignDialogDescription.textContent = "Campaigns collect prospects without duplicating their research or personalization notes.";
  elements.campaignSubmitButton.textContent = "Create campaign";
  elements.campaignName.value = "";
  elements.campaignDescription.value = "";
  elements.campaignDialog.showModal();
  setTimeout(() => elements.campaignName.focus(), 0);
}

function openCampaignEditor() {
  const campaign = activeCampaign();
  if (!campaign) return;
  setCampaignMenu(false);
  state.editingCampaignId = campaign.id;
  elements.campaignDialogKicker.textContent = "Campaign settings";
  elements.campaignDialogTitle.textContent = "Edit campaign";
  elements.campaignDialogDescription.textContent = "The campaign keeps its prospects when you change its name or description.";
  elements.campaignSubmitButton.textContent = "Save changes";
  elements.campaignName.value = campaign.name;
  elements.campaignDescription.value = campaign.description || "";
  elements.campaignDialog.showModal();
  setTimeout(() => elements.campaignName.select(), 0);
}

function emailCandidates(prospect) {
  const details = prospect.contactDetails || {};
  const work = new Set(details.workEmails || []);
  const personal = new Set(details.personalEmails || []);
  return [...new Set([prospect.email, ...(details.emails || []), ...work, ...personal].filter(isEmail))].map((email) => ({
    email,
    type: work.has(email) ? "work" : personal.has(email) ? "personal" : "email",
    status: details.emailStatuses?.[email] || (email === prospect.email ? details.emailStatus : ""),
  }));
}

function renderEmailChoices(prospect) {
  const candidates = emailCandidates(prospect);
  const fragment = document.createDocumentFragment();
  for (const candidate of candidates) {
    const label = document.createElement("label");
    label.className = "email-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "drawer-email-candidate";
    input.value = candidate.email;
    input.checked = candidate.email === prospect.email;
    input.addEventListener("change", () => { elements.drawerEmail.value = candidate.email; });
    const copy = document.createElement("span");
    copy.className = "email-choice-copy";
    appendText(copy, "strong", candidate.email);
    const detail = [candidate.email === prospect.email ? "Currently selected" : "Select for this draft", candidate.status].filter(Boolean).join(" · ");
    appendText(copy, "small", detail);
    const type = appendText(label, "span", candidate.type, "email-choice-type");
    label.prepend(input, copy);
    label.append(type);
    fragment.append(label);
  }
  if (!candidates.length) appendText(fragment, "div", "No email candidates yet. Retry the lookup or enter one below.", "email-empty-state");
  elements.drawerEmailChoices.replaceChildren(fragment);
  elements.drawerEmailSource.textContent = prospect.contactDetails?.error || prospect.emailSource || prospect.contactDetails?.source || "Contact details found during research";
  elements.drawerEmailStatus.textContent = prospect.contactDetails?.error ? "API error" : prospect.contactDetails?.emailStatus || (candidates.length ? "Found" : "Missing");
  elements.drawerEmailStatus.title = prospect.contactDetails?.error || "";
}

function renderExperience(prospect) {
  const experiences = prospect.profile?.experiences || [];
  elements.drawerExperienceCount.textContent = `${experiences.length} found`;
  const fragment = document.createDocumentFragment();
  for (const experience of experiences) {
    const item = document.createElement("div");
    item.className = "experience-item";
    appendText(item, "strong", experience.title || "Role");
    appendText(item, "span", experience.company || "Company not listed");
    appendText(item, "time", experience.dates || "");
    fragment.append(item);
  }
  if (!experiences.length) appendText(fragment, "p", "No work history was captured from this profile.", "experience-empty");
  elements.drawerExperienceList.replaceChildren(fragment);
}

function renderDrawerActivity(prospect) {
  const fragment = document.createDocumentFragment();
  const activity = [...(prospect.activity || [])].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  for (const event of activity) {
    const item = document.createElement("div");
    item.className = "drawer-activity-item";
    appendText(item, "i", "", `activity-dot activity-${event.type}`);
    const copy = document.createElement("div");
    appendText(copy, "strong", event.detail || event.type);
    appendText(copy, "time", new Date(event.at).toLocaleString());
    item.append(copy);
    fragment.append(item);
  }
  if (!activity.length) appendText(fragment, "p", "No stored activity yet.", "experience-empty");
  elements.drawerActivity.replaceChildren(fragment);
}

function openReviewDrawer(id, trigger = document.activeElement) {
  const prospect = state.queue.find((item) => item.id === id);
  if (!prospect) return;
  state.activeProspectId = id;
  state.drawerReturnFocus = trigger instanceof HTMLElement ? trigger : null;
  elements.drawerAvatar.textContent = initialsFor(prospect.name);
  elements.drawerName.textContent = prospect.name || "LinkedIn prospect";
  elements.drawerHeadline.textContent = prospect.headline || companyAndRole(prospect).role;
  elements.drawerLocation.textContent = prospect.location || "";
  elements.drawerLinkedIn.href = prospect.url;
  elements.drawerLinkedIn.hidden = !prospect.url;
  elements.drawerWorkNote.value = prospect.workNote || prospect.background || "";
  elements.drawerEmail.value = prospect.email || "";
  renderEmailChoices(prospect);
  renderExperience(prospect);
  renderDrawerActivity(prospect);
  elements.drawerSubject.value = prospect.subject || "";
  elements.drawerBody.value = prospect.body || "";
  elements.approveDraftButton.disabled = false;
  elements.approveDraftButton.hidden = prospect.status === QUEUE_STATUS.SENT;
  elements.approveDraftButton.textContent = prospect.status === QUEUE_STATUS.DRAFTED ? "Export again" : "Approve & export";
  elements.markSentButton.textContent = prospect.status === QUEUE_STATUS.SENT || prospect.emailSentAt ? "Mark as not sent" : "Mark email sent";
  elements.reviewDrawer.inert = false;
  elements.reviewDrawer.setAttribute("aria-hidden", "false");
  elements.drawerBackdrop.hidden = false;
  elements.reviewDrawer.classList.add("is-open");
  const drawerContent = elements.reviewDrawer.querySelector(".drawer-content");
  if (drawerContent) drawerContent.scrollTop = 0;
  requestAnimationFrame(() => {
    if (drawerContent) drawerContent.scrollTop = 0;
    elements.closeDrawerButton.focus({ preventScroll: true });
  });
}

function closeReviewDrawer() {
  const returnFocus = state.drawerReturnFocus;
  const focusTarget = returnFocus?.isConnected ? returnFocus : elements.tableSearch?.isConnected ? elements.tableSearch : null;
  if (elements.reviewDrawer.contains(document.activeElement)) document.activeElement.blur();
  elements.reviewDrawer.inert = true;
  elements.reviewDrawer.classList.remove("is-open");
  elements.reviewDrawer.setAttribute("aria-hidden", "true");
  elements.drawerBackdrop.hidden = true;
  state.activeProspectId = null;
  state.drawerReturnFocus = null;
  if (focusTarget) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
}

async function saveReview() {
  const id = state.activeProspectId;
  if (!id) return false;
  const email = elements.drawerEmail.value.trim();
  const subject = elements.drawerSubject.value.trim();
  const body = elements.drawerBody.value.trim();
  if (!isEmail(email)) { showToast("Add a valid email before approving this draft."); elements.drawerEmail.focus(); return false; }
  if (!subject || !body) { showToast("The subject and message both need content."); return false; }
  const reviewedAt = new Date().toISOString();
  state.queue = state.queue.map((item) => item.id === id ? { ...withActivity(item, "reviewed", "Draft reviewed and saved", reviewedAt), email, subject, body, workNote: elements.drawerWorkNote.value.trim(), reviewedAt } : item);
  await persistQueue();
  renderQueue();
  showToast("Review changes saved.");
  return true;
}

function exportItems() {
  const visible = visibleProspects();
  return state.selected.size ? visible.filter((item) => state.selected.has(item.id)) : visible;
}

function exportFilename() {
  const campaign = activeCampaign();
  const scopeName = campaign ? campaign.name : "Vela Mail Merge";
  const slug = scopeName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${slug || "Vela-MailMerge"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

async function markExported(items, destination) {
  const ids = new Set(items.map((item) => item.id));
  const now = new Date().toISOString();
  state.queue = state.queue.map((item) => ids.has(item.id) ? {
    ...withActivity(item, "exported", destination, now),
    status: item.status === QUEUE_STATUS.SENT ? QUEUE_STATUS.SENT : QUEUE_STATUS.DRAFTED,
    exportedAt: now,
  } : item);
  await persistQueue();
}

async function exportMailMergeItems(items) {
  const eligible = items.filter((item) => isEmail(item.email) && item.workNote);
  const skipped = items.length - eligible.length;
  if (!eligible.length) { showToast("No prospects have both a recipient email and personalization note yet."); return; }
  exportMailMergeWorkbook(eligible, exportFilename());
  await markExported(eligible, "MailMerge workbook exported");
  renderQueue();
  showToast(`Exported ${eligible.length} prospect${eligible.length === 1 ? "" : "s"} for MailMerge${skipped ? ` · ${skipped} not ready` : ""}.`);
}

async function exportXlsx() {
  const items = exportItems();
  if (!items.length) { showToast("There are no prospects to export in this view."); return; }
  await exportMailMergeItems(items);
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
      if (!state.busy) elements.agentActivity.hidden = true;
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
  for (const jump of document.querySelectorAll("[data-jump-view]")) jump.addEventListener("click", () => setView(jump.dataset.jumpView));
  elements.newCampaignButton.addEventListener("click", openCampaignCreator);
  elements.newCampaignButtonTop.addEventListener("click", openCampaignCreator);
  elements.campaignActionsButton.addEventListener("click", () => setCampaignMenu(elements.campaignActionsMenu.hidden));
  elements.editCampaignButton.addEventListener("click", openCampaignEditor);
  elements.duplicateCampaignButton.addEventListener("click", async () => {
    const campaign = activeCampaign();
    if (!campaign) return;
    setCampaignMenu(false);
    const existingIds = new Set(state.campaigns.map((item) => item.id));
    state.campaigns = duplicateCampaign(state.campaigns, campaign.id);
    const copy = state.campaigns.find((item) => !existingIds.has(item.id));
    await persistCampaigns();
    if (copy) setCampaignView(copy.id); else renderQueue();
    showToast(`${copy?.name || "Campaign copy"} created with the same prospects.`);
  });
  elements.deleteCampaignButton.addEventListener("click", () => {
    const campaign = activeCampaign();
    if (!campaign) return;
    setCampaignMenu(false);
    elements.deleteCampaignDescription.textContent = `Delete “${campaign.name}”? Its ${campaign.prospectIds.length} prospect${campaign.prospectIds.length === 1 ? "" : "s"} and research will stay in the workspace.`;
    elements.deleteCampaignDialog.showModal();
  });
  elements.confirmDeleteCampaignButton.addEventListener("click", async () => {
    const campaign = activeCampaign();
    if (!campaign) return;
    state.campaigns = deleteCampaign(state.campaigns, campaign.id);
    await persistCampaigns();
    setView("all");
    showToast(`${campaign.name} deleted. Its prospects are still in the workspace.`);
  });
  const closeCampaignDialog = () => { state.editingCampaignId = ""; elements.campaignDialog.close(); };
  elements.closeCampaignDialog.addEventListener("click", closeCampaignDialog);
  elements.cancelCampaignButton.addEventListener("click", closeCampaignDialog);
  elements.campaignForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = elements.campaignName.value.trim();
    if (!name) { elements.campaignName.focus(); return; }
    const existing = state.campaigns.find((campaign) => campaign.id !== state.editingCampaignId && campaign.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      showToast(`${existing.name} already exists.`);
      elements.campaignName.select();
      return;
    }
    if (state.editingCampaignId) {
      const campaignId = state.editingCampaignId;
      state.campaigns = updateCampaign(state.campaigns, campaignId, { name, description: elements.campaignDescription.value.trim() });
      await persistCampaigns();
      state.editingCampaignId = "";
      elements.campaignDialog.close();
      setCampaignView(campaignId);
      showToast(`${name} updated.`);
      return;
    }
    const campaign = createCampaign({ name, description: elements.campaignDescription.value.trim() });
    state.campaigns = [...state.campaigns, campaign];
    await persistCampaigns();
    elements.campaignName.value = "";
    elements.campaignDescription.value = "";
    elements.campaignDialog.close();
    setCampaignView(campaign.id);
    showToast(`${campaign.name} is ready. Add prospects from LinkedIn or import a list.`);
  });
  elements.captureSearchButton.addEventListener("click", captureVisibleSearch);
  const openImport = () => { resetImportDialog(); elements.importDialog.showModal(); };
  elements.openImportButton.addEventListener("click", openImport);
  elements.openImportButtonTop.addEventListener("click", openImport);
  for (const button of document.querySelectorAll("[data-import-source]")) button.addEventListener("click", () => setImportSource(button.dataset.importSource));
  elements.bulkInput.addEventListener("input", () => {
    if (state.importSource === "linkedin") elements.importButton.disabled = !parseBulkProspects(elements.bulkInput.value).length;
  });
  elements.importFileInput.addEventListener("change", () => loadImportFile(elements.importFileInput.files?.[0]));
  elements.replaceImportFile.addEventListener("click", () => elements.importFileInput.click());
  for (const eventName of ["dragenter", "dragover"]) elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
  for (const eventName of ["dragleave", "drop"]) elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
  elements.dropZone.addEventListener("drop", (event) => loadImportFile(event.dataTransfer?.files?.[0]));
  elements.importButton.addEventListener("click", async () => {
    if (state.importSource === "linkedin") {
      const prospects = parseBulkProspects(elements.bulkInput.value);
      if (!prospects.length) { showToast("Paste at least one valid LinkedIn profile URL."); return; }
      const now = new Date().toISOString();
      const tracked = prospects.map((prospect) => ({ ...prospect, source: "LinkedIn URL import", importedAt: now, activity: [{ type: "imported", detail: "LinkedIn URL import", at: now }] }));
      await addProspects(tracked, `Added ${tracked.length} unique prospect${tracked.length === 1 ? "" : "s"}.`);
      elements.bulkInput.value = "";
      elements.importDialog.close();
      return;
    }
    if (!state.importData || !mappingValid()) return;
    const result = mappedRowsToProspects({ rows: state.importData.rows, mapping: state.importData.mapping, settings: state.settings, source: state.importData.fileName });
    if (!result.prospects.length) { showToast(result.rejected[0]?.reason || "No importable spreadsheet rows were found."); return; }
    await addProspects(result.prospects, `Imported ${result.prospects.length} prospect${result.prospects.length === 1 ? "" : "s"}${result.rejected.length ? ` · ${result.rejected.length} skipped` : ""}.`);
    elements.importDialog.close();
  });
  elements.processButton.addEventListener("click", () => processQueue());
  elements.mailMergeReadyButton.addEventListener("click", () => exportReadyMailMerge().catch((error) => showToast(error instanceof Error ? error.message : "Could not export MailMerge.")));
  elements.tableSearch.addEventListener("input", () => {
    state.query = elements.tableSearch.value.trim();
    renderQueue();
    persistWorkspaceStateSoon();
  });
  elements.statusFilterButton.addEventListener("click", () => {
    state.attentionOnly = !state.attentionOnly;
    elements.statusFilterButton.classList.toggle("is-active", state.attentionOnly);
    renderQueue();
    persistWorkspaceStateSoon();
  });
  elements.selectAll.addEventListener("change", () => {
    for (const item of visibleProspects()) {
      if (elements.selectAll.checked) state.selected.add(item.id); else state.selected.delete(item.id);
    }
    renderQueue();
  });
  elements.clearSelectionButton.addEventListener("click", () => { state.selected.clear(); renderQueue(); });
  elements.bulkResearchButton.addEventListener("click", () => processQueue([...state.selected]));
  elements.bulkMailMergeButton.addEventListener("click", () => exportReadyMailMerge([...state.selected]).catch((error) => showToast(error instanceof Error ? error.message : "Could not export MailMerge.")));
  elements.collapseSidebar.addEventListener("click", () => setSidebarCollapsed(!document.querySelector(".sidebar").classList.contains("is-collapsed")));
  elements.refreshResponsesButton.addEventListener("click", () => {
    if (isExtension) chrome.runtime.openOptionsPage();
    else window.open("options.html", "_blank");
  });
  elements.closeDrawerButton.addEventListener("click", closeReviewDrawer);
  elements.drawerBackdrop.addEventListener("click", closeReviewDrawer);
  elements.saveReviewButton.addEventListener("click", saveReview);
  elements.copyDrawerEmail.addEventListener("click", async () => {
    const email = elements.drawerEmail.value.trim();
    if (!isEmail(email)) { showToast("Select a valid email first."); return; }
    try { await navigator.clipboard.writeText(email); showToast("Selected email copied."); }
    catch { showToast("Clipboard access was blocked."); }
  });
  elements.retryDrawerLookup.addEventListener("click", async () => {
    const id = state.activeProspectId;
    if (!id) return;
    closeReviewDrawer();
    await processQueue([id]);
  });
  elements.markSentButton.addEventListener("click", async () => {
    const id = state.activeProspectId;
    const prospect = state.queue.find((item) => item.id === id);
    if (!prospect) return;
    const isSent = prospect.status === QUEUE_STATUS.SENT || Boolean(prospect.emailSentAt);
    const at = new Date().toISOString();
    state.queue = state.queue.map((item) => item.id === id ? {
      ...withActivity(item, isSent ? "sent_removed" : "sent", isSent ? "Email sent mark removed" : "Email marked sent manually", at),
      status: isSent ? (item.exportedAt ? QUEUE_STATUS.DRAFTED : QUEUE_STATUS.READY) : QUEUE_STATUS.SENT,
      emailSentAt: isSent ? "" : at,
    } : item);
    await persistQueue();
    renderQueue();
    closeReviewDrawer();
    showToast(isSent ? "Email returned to the review workflow." : "Email marked sent and stored in tracking.");
  });
  elements.approveDraftButton.addEventListener("click", async () => {
    const id = state.activeProspectId;
    if (await saveReview()) {
      await exportReadyMailMerge([id]);
      closeReviewDrawer();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.activeProspectId) closeReviewDrawer();
    if (event.key === "Escape") { setCampaignMenu(false); closeProspectMenu(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e" && activeCampaign() && !elements.campaignDialog.open) { event.preventDefault(); openCampaignEditor(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); elements.tableSearch.focus(); }
  });
  document.addEventListener("click", (event) => {
    if (!elements.campaignActions.contains(event.target)) setCampaignMenu(false);
    if (!event.target.closest(".prospect-popover") && !event.target.closest(".row-menu")) closeProspectMenu();
  });
  document.addEventListener("scroll", closeProspectMenu, true);
}

async function initialize() {
  const stored = await storage.get([QUEUE_STORAGE_KEY, CAMPAIGNS_STORAGE_KEY, WORKSPACE_BACKUP_STORAGE_KEY, SCHEDULED_SENDS_STORAGE_KEY, DELIVERY_LOG_STORAGE_KEY, WORKSPACE_STATE_STORAGE_KEY, "velaGtmSettings"]);
  const recovery = workspaceRecoveryPatch(stored);
  if (Object.keys(recovery).length) await storage.set(recovery);
  const saved = { ...stored, ...recovery };
  const savedWorkspace = saved[WORKSPACE_STATE_STORAGE_KEY] || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(saved.velaGtmSettings || {}) };
  if (["light", "dark"].includes(previewTheme)) state.settings.theme = previewTheme;
  applyTheme(state.settings.theme);
  const legacySidebarCollapsed = !isExtension && localStorage.getItem("velaGtmSidebarCollapsed") === "true";
  const sidebarCollapsed = previewSidebar === "collapsed" || (previewSidebar !== "expanded" && (savedWorkspace.sidebarCollapsed ?? legacySidebarCollapsed));
  setSidebarCollapsed(Boolean(sidebarCollapsed), { persist: false });
  state.queue = saved[QUEUE_STORAGE_KEY] || (!isExtension ? upsertProspects([], DEMO_QUEUE) : []);
  state.campaigns = normalizeCampaigns(saved[CAMPAIGNS_STORAGE_KEY] || (!isExtension ? DEMO_CAMPAIGNS : []));
  state.scheduledJobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY] || (!isExtension ? DEMO_SCHEDULED_SENDS : []));
  state.deliveryLog = normalizeDeliveryLog(saved[DELIVERY_LOG_STORAGE_KEY] || (!isExtension ? [...DEMO_SCHEDULED_SENDS, ...DEMO_DELIVERY_LOG] : []));
  state.query = typeof savedWorkspace.query === "string" ? savedWorkspace.query : "";
  state.attentionOnly = savedWorkspace.attentionOnly === true;
  elements.tableSearch.value = state.query;
  bindEvents();
  const hasRequestedCampaign = requestedCampaignId && state.campaigns.some((campaign) => campaign.id === requestedCampaignId);
  const hasSavedCampaign = savedWorkspace.campaignId && state.campaigns.some((campaign) => campaign.id === savedWorkspace.campaignId);
  if (hasRequestedCampaign) setCampaignView(requestedCampaignId, { preserveFilters: true, persist: false });
  else if (VIEW_COPY[requestedView]) setView(requestedView, { preserveFilters: true, persist: false });
  else if (hasSavedCampaign) setCampaignView(savedWorkspace.campaignId, { preserveFilters: true, persist: false });
  else setView(VIEW_COPY[savedWorkspace.view] ? savedWorkspace.view : "overview", { preserveFilters: true, persist: false });
  if (isExtension && chrome.storage?.onChanged) chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[QUEUE_STORAGE_KEY]) state.queue = changes[QUEUE_STORAGE_KEY].newValue || [];
    if (changes[CAMPAIGNS_STORAGE_KEY]) state.campaigns = normalizeCampaigns(changes[CAMPAIGNS_STORAGE_KEY].newValue || []);
    if (changes[SCHEDULED_SENDS_STORAGE_KEY]) state.scheduledJobs = normalizeScheduledSends(changes[SCHEDULED_SENDS_STORAGE_KEY].newValue || []);
    if (changes[DELIVERY_LOG_STORAGE_KEY]) state.deliveryLog = normalizeDeliveryLog(changes[DELIVERY_LOG_STORAGE_KEY].newValue || []);
    if (changes.velaGtmSettings) {
      state.settings = { ...DEFAULT_SETTINGS, ...(changes.velaGtmSettings.newValue || {}) };
      applyTheme(state.settings.theme);
      if (state.searchPlan) renderSearchPlan(state.searchPlan);
    }
    if (state.activeCampaignId && !state.campaigns.some((campaign) => campaign.id === state.activeCampaignId)) setView("all");
    else if (changes[QUEUE_STORAGE_KEY] || changes[CAMPAIGNS_STORAGE_KEY] || changes[SCHEDULED_SENDS_STORAGE_KEY] || changes[DELIVERY_LOG_STORAGE_KEY]) renderQueue();
  });
}

applyTheme();
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.settings.theme === "system") applyTheme("system");
});
initialize().catch((error) => showToast(error instanceof Error ? error.message : "Could not open the queue."));
