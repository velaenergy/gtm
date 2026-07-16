import { buildWriterRequest, fullDraftQualityIssues, mergeEnrichedProfile, normalizeWriterResponse } from "./lib/ai-writer.js";
import {
  IMPORT_FIELDS,
  historicalDeliveryRecords,
  mappedRowsToProspects,
  readSpreadsheet,
} from "./lib/spreadsheet-import.js";
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
  deliveryModeLabel,
  normalizeDeliveryLog,
} from "./lib/delivery-ledger.js";
import {
  buildDailySendSeries,
  collectSentEvents,
  mailboxCapacityUsage,
  mergeDeliveryRecords,
  summarizeDailySends,
  teamMemberKey,
  teamPerformance,
} from "./lib/analytics.js";
import {
  WORKSPACE_BACKUP_STORAGE_KEY,
  workspaceRecoveryPatch,
} from "./lib/workspace-persistence.js";
import { buildTargetFitRequest, normalizeTargetFit } from "./lib/target-fit.js";
import {
  GOOGLE_ACCOUNT_AUTH_MODE,
  GOOGLE_ACCOUNT_STORAGE_KEY,
  GOOGLE_ACCOUNTS_STORAGE_KEY,
  GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY,
  normalizeGoogleAccounts,
  selectedGoogleAccount,
} from "./lib/google-auth.js";
import { buildContacts, filterContacts } from "./lib/contacts.js";
import { auditResearchBatch, gmailLearningContext, researchRunCounts } from "./lib/research-batch.js";
import { searchApolloPeopleWithRecovery, titlesOnlyApolloPeopleFilters } from "./lib/apollo.js";
import { DATA_PAGE_SIZE, paginate, paginationTokens } from "./lib/pagination.js";
import {
  PROVIDER_ACTION,
  RUNTIME_CAPABILITIES_MESSAGE,
  RUNTIME_RELOAD_MESSAGE,
  runtimeMismatchMessage,
} from "./lib/runtime-protocol.js";

const isExtension = Boolean(globalThis.chrome?.runtime?.id);
const pageParams = new URLSearchParams(location.search);
const previewTheme = !isExtension ? pageParams.get("theme") : null;
const previewSidebar = !isExtension ? pageParams.get("sidebar") : null;
const requestedCampaignId = pageParams.get("campaign") || "";
const requestedView = pageParams.get("view") || "";
const WORKSPACE_STATE_STORAGE_KEY = "velaGtmWorkspaceState";
const elements = Object.fromEntries([
  "settingsButton", "searchForm", "searchBrief", "planSearchButton", "researchMessages", "researchRunCard", "researchRunStatus", "researchRunProgress", "researchRunCounts", "researchRunBar",
  "openImportButton", "openImportButtonTop", "importDialog", "bulkInput", "importButton", "importHint",
  "spreadsheetImportPanel", "linkedinImportPanel", "importFileInput", "dropZone", "importFileName", "mappingStage", "mappingGrid", "mappingSummary", "mappingIssues", "replaceImportFile",
  "processButton", "sendAllButton", "queueBody", "emptyState", "totalStat", "readyStat", "draftedStat",
  "sentStat", "attentionStat", "totalDelta", "progressBar", "progressText", "toast", "navResearch", "navReview", "navTracking",
  "navScheduled", "heroEyebrow", "pageTitle", "pageSubtitle", "workspaceCrumb", "agentPanel", "metricsPanel", "analyticsPanel", "overviewPanel", "overviewReviewCount", "overviewResponseCount", "overviewScheduledCount", "overviewSentTodayCount", "overviewScheduleList", "overviewActivityList", "overviewReviewList", "overviewResponseList", "refreshResponsesButton", "pipelineBar",
  "engagementReplies", "engagementRateDetail", "analyticsSentToday", "analyticsSentTodayDetail", "analyticsSendRate", "analyticsSendRateDetail", "analyticsProspectsContacted", "analyticsProspectsDetail", "analyticsActiveSequences", "analyticsActiveSequencesDetail", "analyticsFollowUpsSent", "analyticsFollowUpsDetail", "analyticsReplyRate", "sequenceInitialCount", "sequenceStepOneCount", "sequenceStepTwoCount", "sequenceStepThreeCount", "sequenceReplyCount",
  "mailboxCapacityTotal", "mailboxCapacityList", "dailySendChart", "analyticsWeekSent", "analyticsDailyAverage", "analyticsBestDay", "analyticsPeriodReplyRate", "analyticsRange", "analyticsMemberFilter", "analyticsScopeTitle", "analyticsScopeDetail", "analyticsActiveSenders", "analyticsLeaderboard", "analyticsTeamBody", "analyticsTeamDescription", "analyticsActivityList",
  "overviewTeamPulse", "overviewTeamPulseMeta", "operationsPanel", "operationsKicker", "operationsTitle", "operationsDescription", "operationsPrimaryAction", "deliveryList", "historyWorkspace", "historyTotal", "historyPeople", "historyTeammates", "historyDelivered", "historySearch", "historySenderFilter", "historyResultCount", "historyBody", "historyEmpty", "historyPagination", "queueSection",
  "contactsPanel", "contactsSearch", "contactsStatusFilter", "contactsImportButton", "contactsBody", "contactsEmpty", "contactsCount", "contactsPagination", "navContacts", "contactsTotalMetric", "contactsReachedMetric", "contactsRepliedMetric", "contactsBouncedMetric", "contactsInboxSyncButton", "contactsInboxState",
  "queueHeading", "queueDescription", "tableSearch", "statusFilterButton", "resultCount", "nextResearchBatchButton", "selectAll", "bulkBar",
  "selectedCount", "bulkResearchButton", "bulkApproveButton", "bulkSendButton", "clearSelectionButton",
  "collapseSidebar", "drawerBackdrop", "reviewDrawer", "closeDrawerButton", "drawerAvatar", "drawerName", "drawerHeadline",
  "drawerLocation", "drawerLinkedIn", "drawerWorkNote", "drawerEmail", "drawerSubject", "drawerBody", "saveReviewButton", "approveDraftButton",
  "drawerEmailChoices", "drawerEmailSource", "drawerEmailStatus", "copyDrawerEmail", "retryDrawerLookup", "drawerExperienceCount", "drawerExperienceList", "drawerActivity", "markSentButton",
  "agentActivity", "agentActivityTitle", "agentActivityDetail", "campaignNav", "newCampaignButton", "newCampaignButtonTop",
  "campaignActions", "campaignActionsButton", "campaignActionsMenu", "editCampaignButton", "duplicateCampaignButton", "deleteCampaignButton",
  "campaignDialog", "campaignForm", "campaignName", "campaignDescription", "campaignDialogKicker", "campaignDialogTitle", "campaignDialogDescription", "campaignSubmitButton", "closeCampaignDialog", "cancelCampaignButton",
  "deleteCampaignDialog", "deleteCampaignDescription", "confirmDeleteCampaignButton", "authGate", "authSignInButton", "authGateStatus",
  "drawerFitReason", "drawerFitBadge", "drawerFitEvidence", "sendDialog", "sendDialogCount", "sendDialogDescription", "confirmBulkSendButton",
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
    senderEmail: "tarun@velaenergy.ai",
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
    senderEmail: "tarun@velaenergy.ai",
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
    senderEmail: "tarun@velaenergy.ai",
    operatorId: "preview-riddhiman",
    operatorEmail: "riddhiman.rana@velaenergy.ai",
    operatorName: "Riddhiman Rana",
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
    senderEmail: "tarun@velaenergy.ai",
    operatorId: "preview-tarun",
    operatorEmail: "tarun@velaenergy.ai",
    operatorName: "Tarun Batchu",
    recipients: ["liam@helioscolo.com"],
    subject: "Development at Helios + Vela",
    prospectId: DEMO_QUEUE[6].url,
    scheduledAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
    createdAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
    completedAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
  },
]);

const DEMO_TEAM_MEMBERS = [
  { id: "preview-tarun", email: "tarun@velaenergy.ai", full_name: "Tarun Batchu", created_at: "2026-05-18T16:00:00.000Z" },
  { id: "preview-riddhiman", email: "riddhiman.rana@velaenergy.ai", full_name: "Riddhiman Rana", created_at: "2026-06-03T16:00:00.000Z" },
  { id: "preview-tony", email: "tony@velaenergy.ai", full_name: "Tony Li", created_at: "2026-06-21T16:00:00.000Z" },
];

const state = { queue: [], campaigns: [], scheduledJobs: [], deliveryLog: [], googleAccounts: [], approvedSenders: [], selectedGoogleAccountId: "", teamMembers: [], currentTeamUser: null, teamActivity: [], backendStatus: "signed-out", activeCampaignId: "", editingCampaignId: "", settings: { ...DEFAULT_SETTINGS }, searchPlan: null, pendingResearchPlan: null, researchConversation: [], researchRun: null, busy: false, searching: false, toastTimer: null, workspacePersistTimer: null, teamSyncTimer: null, view: "overview", analyticsDays: 7, analyticsMember: "all", historyQuery: "", historySender: "all", historyPage: 1, query: "", contactQuery: "", contactStatus: "all", contactPage: 1, contactsInboxChecking: false, selected: new Set(), activeProspectId: null, keyboardProspectId: null, drawerReturnFocus: null, attentionOnly: false, sidebarCollapsed: false, importSource: "spreadsheet", importData: null, pendingSendIds: [] };

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
    contactQuery: state.contactQuery,
    contactStatus: state.contactStatus,
    attentionOnly: state.attentionOnly,
    sidebarCollapsed: state.sidebarCollapsed,
    analyticsDays: state.analyticsDays,
    analyticsMember: state.analyticsMember,
    searchPlan: state.searchPlan,
  };
}

async function workspaceAuthReady() {
  if (!isExtension) {
    elements.authGate.hidden = true;
    document.body.classList.remove("auth-pending");
    return true;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_AUTH_STATUS" });
    const signedIn = Boolean(response?.ok && response.data?.signedIn);
    elements.authGate.hidden = signedIn;
    document.body.classList.remove("auth-pending");
    return signedIn;
  } catch (error) {
    elements.authGate.hidden = false;
    elements.authGateStatus.textContent = error instanceof Error ? error.message : "Could not check your Vela session.";
    document.body.classList.remove("auth-pending");
    return false;
  }
}

async function signInFromGate() {
  elements.authSignInButton.disabled = true;
  elements.authGateStatus.textContent = "Opening Google sign-in…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_INTERACTIVE_SIGN_IN" });
    if (!response?.ok || !response.data?.signedIn) throw new Error(response?.error || "Vela sign-in failed.");
    location.reload();
  } catch (error) {
    elements.authGateStatus.textContent = error instanceof Error ? error.message : "Vela sign-in failed.";
    elements.authSignInButton.disabled = false;
  }
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
  elements.agentActivity.hidden = !busy;
  if (busy) updateAgentActivity(label.toLowerCase().includes("finding") ? "source" : label.toLowerCase().includes("draft") ? "draft" : "research", label);
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
  if (isExtension) chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_PROSPECTS_SYNC", prospects: state.queue }).catch(() => {});
}

async function persistCampaigns() {
  await storage.set({ [CAMPAIGNS_STORAGE_KEY]: state.campaigns });
}

function statusLabel(status) {
  return ({
    [QUEUE_STATUS.NEW]: "Found",
    [QUEUE_STATUS.PROCESSING]: "Verifying",
    [QUEUE_STATUS.NEEDS_EMAIL]: "Needs email",
    [QUEUE_STATUS.READY]: "Draft ready",
    [QUEUE_STATUS.DRAFTED]: "Approved",
    [QUEUE_STATUS.SENT]: "Sent",
    [QUEUE_STATUS.ERROR]: "Try again",
  })[status] || "Queued";
}

function fitLabel(targetFit) {
  if (!targetFit) return { label: "Not checked", className: "fit-pending" };
  if (targetFit.verdict === "strong") return { label: `${targetFit.score} · Strong`, className: "fit-strong" };
  if (targetFit.verdict === "skip") return { label: `${targetFit.score} · Skip`, className: "fit-skip" };
  return { label: `${targetFit.score} · Review`, className: "fit-review" };
}

function currentOperator() {
  const profile = state.teamMembers.find((member) => member.id === state.currentTeamUser?.id || member.email === state.currentTeamUser?.email);
  return {
    id: state.currentTeamUser?.id || "preview-user",
    email: state.currentTeamUser?.email || "preview@velaenergy.ai",
    name: profile?.full_name || profile?.email || state.currentTeamUser?.email || "You",
  };
}

function deliveryOperator(record = {}) {
  const member = state.teamMembers.find((candidate) =>
    candidate.id === record.operatorId
    || String(candidate.email || "").toLowerCase() === String(record.operatorEmail || "").toLowerCase()
    || (record.operatorName && candidate.full_name === record.operatorName));
  const localOperator = record.source === "supabase" ? null : currentOperator();
  return {
    id: record.operatorId || member?.id || localOperator?.id || "",
    name: record.operatorName || member?.full_name || member?.email || localOperator?.name || "Local activity",
    email: record.operatorEmail || member?.email || localOperator?.email || "",
    avatarUrl: record.operatorAvatarUrl || member?.avatar_url || "",
  };
}

let floatingTooltip = null;
let tooltipOwner = null;

function ensureFloatingTooltip() {
  if (floatingTooltip) return floatingTooltip;
  floatingTooltip = document.createElement("div");
  floatingTooltip.id = "velaFloatingTooltip";
  floatingTooltip.className = "floating-tooltip";
  floatingTooltip.setAttribute("role", "tooltip");
  document.body.append(floatingTooltip);
  return floatingTooltip;
}

function showFloatingTooltip(node) {
  const tooltip = ensureFloatingTooltip();
  tooltipOwner = node;
  tooltip.textContent = node.dataset.tooltip || "";
  tooltip.classList.add("is-visible");
  const anchor = node.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const gap = 8;
  const left = Math.min(window.innerWidth - tip.width / 2 - 10, Math.max(tip.width / 2 + 10, anchor.left + anchor.width / 2));
  const above = anchor.top - tip.height - gap;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${above >= 8 ? above : anchor.bottom + gap}px`;
}

function hideFloatingTooltip(node) {
  if (tooltipOwner !== node) return;
  floatingTooltip?.classList.remove("is-visible");
  tooltipOwner = null;
}

function addTooltip(node, text) {
  if (!text) return node;
  node.classList.add("has-tooltip");
  node.dataset.tooltip = text;
  node.setAttribute("aria-describedby", "velaFloatingTooltip");
  node.tabIndex = 0;
  node.addEventListener("pointerenter", () => showFloatingTooltip(node));
  node.addEventListener("pointerleave", () => hideFloatingTooltip(node));
  node.addEventListener("focus", () => showFloatingTooltip(node));
  node.addEventListener("blur", () => hideFloatingTooltip(node));
  node.addEventListener("keydown", (event) => { if (event.key === "Escape") hideFloatingTooltip(node); });
  return node;
}

function renderResearchRun() {
  const run = state.researchRun;
  elements.researchRunCard.hidden = !run;
  if (!run) return;
  const statusLabels = { planning: "Preparing research", searching: "Searching sources", auditing: "Evaluating people", complete: "Ready for approval", error: "Needs attention" };
  elements.researchRunStatus.textContent = run.status === "complete" && !run.foundCount ? "No matches yet" : statusLabels[run.status] || "Research run";
  const totalMatches = Math.max(0, Number(run.totalFound) || 0);
  const pulled = Math.max(0, Number(run.foundCount) || 0);
  const formattedTotal = totalMatches.toLocaleString();
  elements.researchRunProgress.textContent = run.status === "complete"
    ? pulled ? `${pulled.toLocaleString()} pulled${totalMatches ? ` from ${formattedTotal} matches` : ""}` : "Apollo checked the scoped audience and a safe broader pass."
    : run.status === "error" ? run.error || "The run stopped before completion."
      : run.status === "auditing" && pulled ? `${pulled.toLocaleString()} pulled${totalMatches ? ` from ${formattedTotal} matches` : ""} · preparing results`
      : totalMatches ? `Preparing review batch ${Math.max(1, Number(run.page) || 1)} from ${formattedTotal} matches`
        : "Counting matches…";
  const counts = [
    [totalMatches ? formattedTotal : "—", "Matches"],
    [pulled.toLocaleString(), "Pulled"],
  ];
  const fragment = document.createDocumentFragment();
  for (const [value, label] of counts) {
    const item = document.createElement("span");
    appendText(item, "strong", String(value));
    appendText(item, "small", label);
    fragment.append(item);
  }
  elements.researchRunCounts.replaceChildren(fragment);
  const denominator = Math.max(1, run.foundCount || run.requestedCount || 100);
  elements.researchRunBar.style.width = `${Math.min(100, Math.round(((run.auditedCount || 0) / denominator) * 100))}%`;
}

function appendText(parent, tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function renderDataPagination(container, pageInfo, label, onPage) {
  if (!container) return;
  container.hidden = pageInfo.pageCount <= 1;
  if (container.hidden) { container.replaceChildren(); return; }
  const nav = document.createElement("nav");
  nav.className = "data-pagination-nav";
  nav.dataset.slot = "pagination";
  nav.setAttribute("aria-label", `${label} pages`);
  const list = document.createElement("ul");
  list.className = "data-pagination-list";
  list.dataset.slot = "pagination-content";
  const addButton = (text, target, { active = false, disabled = false, className = "", ariaLabel = "" } = {}) => {
    const item = document.createElement("li");
    item.dataset.slot = "pagination-item";
    const button = appendText(item, "button", text, `data-pagination-button ${className}`.trim());
    button.type = "button";
    button.disabled = disabled;
    button.dataset.slot = "pagination-link";
    button.setAttribute("aria-label", ariaLabel || (typeof target === "number" ? `Go to page ${target}` : text));
    if (active) button.setAttribute("aria-current", "page");
    if (!disabled) button.addEventListener("click", () => onPage(target));
    list.append(item);
  };
  addButton("Previous", pageInfo.page - 1, { disabled: pageInfo.page === 1, className: "data-pagination-previous", ariaLabel: "Go to previous page" });
  for (const token of paginationTokens(pageInfo.page, pageInfo.pageCount)) {
    if (typeof token === "string") {
      const item = appendText(list, "li", "…", "data-pagination-ellipsis");
      item.dataset.slot = "pagination-ellipsis";
      item.setAttribute("aria-hidden", "true");
    } else addButton(String(token), token, { active: token === pageInfo.page });
  }
  addButton("Next", pageInfo.page + 1, { disabled: pageInfo.page === pageInfo.pageCount, className: "data-pagination-next", ariaLabel: "Go to next page" });
  nav.append(list);
  container.replaceChildren(nav);
}

function scrollResearchToLatest() {
  requestAnimationFrame(() => elements.researchMessages?.scrollTo({ top: elements.researchMessages.scrollHeight, behavior: "smooth" }));
}

function appendResearchMessage(role, text, detail = "", { record = true } = {}) {
  const message = document.createElement("article");
  message.className = `research-message research-message-${role}`;
  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "research-message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    const image = document.createElement("img");
    image.src = "assets/icon-32.png";
    image.alt = "";
    avatar.append(image);
    message.append(avatar);
  }
  const content = document.createElement("div");
  content.className = "research-message-content";
  appendText(content, "p", text);
  if (detail) appendText(content, "span", detail);
  message.append(content);
  elements.researchMessages.append(message);
  if (record && ["user", "assistant"].includes(role) && String(text || "").trim()) {
    state.researchConversation.push({ role, content: String(text).trim() });
    state.researchConversation = state.researchConversation.slice(-16);
  }
  scrollResearchToLatest();
  return content;
}

function searchPlanTags(plan = {}) {
  const tags = [];
  for (const search of plan.searches || []) {
    const filters = search.filters || {};
    for (const key of ["job_title", "seniority", "company", "industry", "location"]) {
      const values = Array.isArray(filters[key]) ? filters[key] : filters[key] ? [filters[key]] : [];
      for (const value of values) if (value && !tags.includes(value)) tags.push(value);
    }
    if (filters.keyword && !tags.includes(filters.keyword)) tags.push(filters.keyword);
  }
  return tags.slice(0, 10);
}

function appendResearchPlan(brief, plan, reply = "I’ve shaped that into a research plan.") {
  for (const button of elements.researchMessages.querySelectorAll(".research-plan-run")) button.disabled = true;
  const content = appendResearchMessage("assistant", reply, "Refine it in the composer, or run it when the audience looks right.");
  const card = document.createElement("div");
  card.className = "research-plan";
  const head = document.createElement("div");
  head.className = "research-plan-head";
  appendText(head, "strong", "Audience plan");
  appendText(head, "span", plan.strategy || "Search for people whose operating responsibility matches your brief.");
  card.append(head);
  const tags = searchPlanTags(plan);
  if (tags.length) {
    const tagList = document.createElement("div");
    tagList.className = "research-plan-tags";
    for (const tag of tags) appendText(tagList, "span", tag);
    card.append(tagList);
  }
  const actions = document.createElement("div");
  actions.className = "research-plan-actions";
  const run = appendText(actions, "button", "Run research", "button button-primary research-plan-run");
  run.type = "button";
  run.addEventListener("click", () => executeResearchPlan(plan, brief));
  const refine = appendText(actions, "button", "Refine", "button button-outline");
  refine.type = "button";
  refine.addEventListener("click", () => elements.searchBrief.focus());
  card.append(actions);
  appendText(card, "small", "Results are prepared as one review batch and sent to Approvals.", "research-plan-note");
  content.append(card);
  state.pendingResearchPlan = { brief, plan };
  scrollResearchToLatest();
}

function titlesOnlyResearchPlan(plan = {}) {
  return {
    ...plan,
    strategy: "Search the requested role family with similar titles and no optional audience filters.",
    searches: (plan.searches || []).map((search) => ({
      ...search,
      label: "Broader title search",
      rationale: "A user-approved fallback after the scoped Apollo search returned no matches.",
      filters: titlesOnlyApolloPeopleFilters({ ...search.filters, limit: 100, page: 1 }),
    })),
  };
}

function appendResearchEmptyState(brief, plan, { broadened = false } = {}) {
  const content = appendResearchMessage(
    "assistant",
    "No close matches yet — nothing was added to Contacts.",
    broadened
      ? "I checked the planned filters, then made one safer broader pass by allowing similar titles and removing optional keyword and industry filters. Company and location constraints stayed intact."
      : "Apollo completed the search, but the current audience did not return any people.",
  );
  const card = document.createElement("div");
  card.className = "research-empty-actions";
  card.dataset.slot = "empty";
  appendText(card, "strong", "Choose the next move");
  appendText(card, "span", "Edit the audience yourself, or explicitly widen it to the role titles only.");
  const actions = document.createElement("div");
  const edit = appendText(actions, "button", "Edit search", "button button-outline");
  edit.type = "button";
  edit.addEventListener("click", () => {
    elements.searchBrief.value = brief;
    elements.searchBrief.focus();
    elements.searchBrief.setSelectionRange(0, elements.searchBrief.value.length);
  });
  const retry = appendText(actions, "button", "Try titles only", "button button-primary");
  retry.type = "button";
  retry.addEventListener("click", () => executeResearchPlan(titlesOnlyResearchPlan(plan), brief));
  card.append(actions);
  content.append(card);
  scrollResearchToLatest();
}

function setResearchComposerBusy(busy) {
  elements.planSearchButton.disabled = busy;
  elements.searchBrief.disabled = busy;
  for (const button of elements.researchMessages.querySelectorAll(".research-plan-run")) button.disabled = busy;
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

function belongsToResearch(prospect) {
  return Boolean(prospect.researchRunId);
}

function belongsToCurrentResearchBatch(prospect) {
  return belongsToResearch(prospect) && (!state.researchRun?.id || prospect.researchRunId === state.researchRun.id);
}

function prospectMatchesView(prospect) {
  const campaign = activeCampaign();
  if (campaign && !campaign.prospectIds.includes(prospect.id)) return false;
  if (state.view === "research" && prospect.researchRunId !== state.researchRun?.id && ![QUEUE_STATUS.NEW, QUEUE_STATUS.PROCESSING, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(prospect.status)) return false;
  if (state.view === "review" && (!belongsToCurrentResearchBatch(prospect) || ![QUEUE_STATUS.READY, QUEUE_STATUS.DRAFTED].includes(prospect.status))) return false;
  if (state.attentionOnly && ![QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(prospect.status)) return false;
  if (!state.query) return true;
  const details = companyAndRole(prospect);
  return [prospect.name, prospect.email, prospect.headline, prospect.location, details.company, details.role, prospect.subject].join(" ").toLowerCase().includes(state.query.toLowerCase());
}

function visibleProspects() {
  const visible = state.queue.filter(prospectMatchesView);
  if (state.view !== "research") return visible;
  return visible.sort((a, b) => {
    const aActive = a.researchRunId === state.researchRun?.id ? 1 : 0;
    const bActive = b.researchRunId === state.researchRun?.id ? 1 : 0;
    return bActive - aActive || Number(b.targetFit?.score || -1) - Number(a.targetFit?.score || -1) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
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

function unifiedDeliveryLog() {
  return mergeDeliveryRecords(state.teamActivity, state.deliveryLog);
}

function formatContactDate(value = "") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function contactInitials(value = "") {
  const parts = String(value || "").trim().split(/\s+|[._-]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || "?").toUpperCase();
}

function renderContacts() {
  const contacts = buildContacts({ prospects: state.queue, deliveryLog: unifiedDeliveryLog() });
  const visible = filterContacts(contacts, { query: state.contactQuery, status: state.contactStatus });
  const pageInfo = paginate(visible, state.contactPage, DATA_PAGE_SIZE);
  state.contactPage = pageInfo.page;
  elements.navContacts.textContent = contacts.length;
  elements.contactsCount.textContent = visible.length
    ? `Showing ${pageInfo.start.toLocaleString()}–${pageInfo.end.toLocaleString()} of ${visible.length.toLocaleString()} contacts`
    : "0 contacts";
  elements.contactsTotalMetric.textContent = contacts.length.toLocaleString();
  elements.contactsReachedMetric.textContent = contacts.filter((contact) => contact.touches > 0).length.toLocaleString();
  elements.contactsRepliedMetric.textContent = contacts.filter((contact) => contact.status === "Replied").length.toLocaleString();
  elements.contactsBouncedMetric.textContent = contacts.filter((contact) => contact.status === "Bounced").length.toLocaleString();
  for (const button of document.querySelectorAll("[data-contact-filter]")) {
    const active = button.dataset.contactFilter === state.contactStatus;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  elements.contactsEmpty.hidden = visible.length > 0;
  elements.contactsBody.hidden = visible.length === 0;
  const fragment = document.createDocumentFragment();
  for (const contact of pageInfo.items) {
    const row = document.createElement("tr");
    row.className = "contact-row";
    const person = document.createElement("td");
    const personCopy = appendText(person, "div", "", "contact-person");
    appendText(personCopy, "span", contactInitials(contact.name || contact.email), "contact-avatar");
    const personDetails = appendText(personCopy, "div", "", "contact-person-copy");
    appendText(personDetails, "strong", contact.name || "—");
    appendText(personDetails, "span", contact.email || "No email yet");
    const company = document.createElement("td");
    const companyCopy = appendText(company, "div", "", "contact-company");
    appendText(companyCopy, "strong", contact.company || "—");
    appendText(companyCopy, "span", contact.source);
    const status = document.createElement("td");
    const relationship = appendText(status, "div", "", "contact-relationship");
    appendText(relationship, "span", contact.status, `contact-state contact-state-${contact.status.toLowerCase()}`);
    appendText(relationship, "small", contact.touches ? `${contact.touches} touch${contact.touches === 1 ? "" : "es"}` : contact.source);
    const delivery = document.createElement("td");
    const healthClass = contact.deliveryHealth.toLowerCase().replaceAll(" ", "-");
    const deliveryCopy = appendText(delivery, "div", "", `contact-delivery contact-delivery-${healthClass}`);
    appendText(deliveryCopy, "strong", contact.deliveryHealth);
    appendText(deliveryCopy, "small", contact.status === "Bounced" ? contact.bounceReason : contact.deliveryHealth === "Delivered" ? "No bounce detected" : "No inbox signal yet");
    if (contact.bounceDiagnostic) deliveryCopy.title = contact.bounceDiagnostic;
    const lastContact = appendText(document.createDocumentFragment(), "td", formatContactDate(contact.lastActivityAt), "contact-last");
    const ownerCell = document.createElement("td");
    const ownerName = contact.operators[0] || "Unassigned";
    const owner = appendText(ownerCell, "div", "", "contact-owner");
    appendText(owner, "span", contactInitials(ownerName), "contact-owner-avatar");
    appendText(owner, "span", contact.operators.length > 1 ? `${ownerName} +${contact.operators.length - 1}` : ownerName);
    const actionCell = document.createElement("td");
    actionCell.className = "contact-open-cell";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "contact-open-button";
    action.setAttribute("aria-label", `Open ${contact.name || contact.email}`);
    action.title = "Open contact";
    const actionIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    actionIcon.setAttribute("viewBox", "0 0 20 20");
    const actionPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    actionPath.setAttribute("d", "M7 4.5 12.5 10 7 15.5");
    actionIcon.append(actionPath);
    action.append(actionIcon);
    actionCell.append(action);
    row.append(person, company, status, delivery, lastContact, ownerCell, actionCell);
    const open = () => {
      const prospect = state.queue.find((item) => item.id === contact.prospectId || item.id === contact.prospect?.id || item.email?.toLowerCase() === contact.email);
      if (prospect) openReviewDrawer(prospect.id, row);
    };
    row.addEventListener("click", open);
    fragment.append(row);
  }
  elements.contactsBody.replaceChildren(fragment);
  renderDataPagination(elements.contactsPagination, pageInfo, "Contacts", (page) => {
    state.contactPage = page;
    renderContacts();
    elements.contactsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function syncInboxBounces({ interactive = false, quiet = false } = {}) {
  if (!isExtension || state.contactsInboxChecking) return;
  state.contactsInboxChecking = true;
  elements.contactsInboxSyncButton.disabled = true;
  elements.contactsInboxSyncButton.classList.add("is-loading");
  elements.contactsInboxState.textContent = "Checking connected Gmail inboxes…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_GMAIL_BOUNCES_SYNC", interactive });
    if (!response?.ok) throw new Error(response?.error || "Could not check Gmail delivery health.");
    await Promise.all([refreshSharedActivity({ quiet: true }), refreshTeamProspects({ quiet: true })]);
    const result = response.data || {};
    const checkedAt = result.checkedAt ? new Date(result.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "just now";
    elements.contactsInboxState.textContent = result.errors?.length
      ? `Checked ${result.checkedAccounts} inboxes at ${checkedAt}; ${result.errors.length} needs reconnection.`
      : `Checked ${result.checkedAccounts} inbox${result.checkedAccounts === 1 ? "" : "es"} at ${checkedAt}.`;
    if (!quiet) showToast(result.newBounces
      ? `${result.newBounces} new bounce${result.newBounces === 1 ? "" : "s"} found${result.followUpsStopped ? ` · ${result.followUpsStopped} follow-up${result.followUpsStopped === 1 ? "" : "s"} stopped` : ""}.`
      : "Inbox checked — no new bounces found.");
  } catch (error) {
    elements.contactsInboxState.textContent = error instanceof Error ? error.message : "Gmail delivery health is unavailable.";
    if (!quiet) showToast(elements.contactsInboxState.textContent);
  } finally {
    state.contactsInboxChecking = false;
    elements.contactsInboxSyncButton.disabled = false;
    elements.contactsInboxSyncButton.classList.remove("is-loading");
    renderContacts();
  }
}

async function refreshSharedActivity({ quiet = false } = {}) {
  if (!isExtension) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_ACTIVITY_READ" });
    if (!response?.ok) throw new Error(response?.error || "Could not read the Vela team activity log.");
    state.teamActivity = (response.data?.records || []).filter((record) => record.source === "supabase");
    state.backendStatus = response.data?.backendStatus || "signed-out";
    renderQueue();
    if (!quiet && state.backendStatus === "synced") showToast("Sent history refreshed from the Vela team workspace.");
    if (!quiet && state.backendStatus === "error") showToast(response.data?.error || "Using local sent history because team sync is unavailable.");
  } catch (error) {
    state.backendStatus = "error";
    if (!quiet) showToast(error instanceof Error ? error.message : "Could not refresh sent history.");
  }
}

async function refreshTeamProspects({ quiet = false } = {}) {
  if (!isExtension) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_PROSPECTS_READ" });
    if (!response?.ok) throw new Error(response?.error || "Could not read shared prospects.");
    const shared = Array.isArray(response.data) ? response.data : [];
    if (shared.length) {
      state.queue = upsertProspects(state.queue, shared);
      await persistQueue();
      renderQueue();
    }
  } catch (error) {
    if (!quiet) showToast(error instanceof Error ? error.message : "Could not refresh shared prospects.");
  }
}

async function refreshResearchRuns({ quiet = false } = {}) {
  if (!isExtension) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_RESEARCH_RUNS_READ" });
    if (!response?.ok) throw new Error(response?.error || "Could not read shared research runs.");
    const latest = Array.isArray(response.data) ? response.data[0] : null;
    if (latest && (!state.busy || latest.id !== state.researchRun?.id)) {
      state.researchRun = latest;
      renderResearchRun();
    }
  } catch (error) {
    if (!quiet) showToast(error instanceof Error ? error.message : "Could not refresh research activity.");
  }
}

async function refreshTeamWorkspace() {
  if (!isExtension || document.hidden || state.busy) return;
  await Promise.all([
    refreshSharedActivity({ quiet: true }),
    refreshTeamProspects({ quiet: true }),
    refreshResearchRuns({ quiet: true }),
  ]);
}

async function refreshTeamGmailAccounts() {
  if (!isExtension) return;
  const [accountsResponse, sendersResponse] = await Promise.all([
    chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_GMAIL_READ" }),
    chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_SENDERS_READ" }),
  ]);
  if (sendersResponse?.ok) state.approvedSenders = sendersResponse.data || [];
  if (!accountsResponse?.ok) return;
  const allowed = new Set(state.approvedSenders.map((sender) => String(sender.email).toLowerCase()));
  const shared = (accountsResponse.data || []).filter((account) => allowed.has(String(account.email).toLowerCase())).map((account) => ({ id: account.id, email: account.email, authMode: GOOGLE_ACCOUNT_AUTH_MODE }));
  state.googleAccounts = normalizeGoogleAccounts([...state.googleAccounts, ...shared]).filter((account) => allowed.has(String(account.email).toLowerCase()));
  await storage.set({ [GOOGLE_ACCOUNTS_STORAGE_KEY]: state.googleAccounts });
  renderQueue();
}

function openAdvancedSettings() {
  if (isExtension) chrome.runtime.openOptionsPage();
  else window.open("options.html", "_blank");
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
    [DELIVERY_STATUS.BOUNCED]: "Bounced",
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

function renderMailboxCapacity(usage) {
  const sent = usage.reduce((sum, mailbox) => sum + mailbox.sent, 0);
  const capacity = usage.reduce((sum, mailbox) => sum + mailbox.capacity, 0);
  elements.mailboxCapacityTotal.textContent = `${sent.toLocaleString()} / ${capacity.toLocaleString()} sent`;

  const capacityFragment = document.createDocumentFragment();
  for (const mailbox of usage) {
    const row = document.createElement("article");
    row.className = `mailbox-capacity-row${mailbox.percent >= 100 ? " is-exhausted" : mailbox.percent >= 80 ? " is-warning" : ""}`;
    const heading = document.createElement("div");
    const identity = document.createElement("span");
    appendText(identity, "strong", mailbox.email);
    appendText(identity, "small", mailbox.type, "mailbox-type");
    heading.append(identity);
    appendText(heading, "span", `${mailbox.sent.toLocaleString()} / ${mailbox.capacity.toLocaleString()}`, "mailbox-usage-value");
    const progress = document.createElement("div");
    progress.className = "capacity-progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", `${mailbox.email} daily sending capacity`);
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(mailbox.capacity));
    progress.setAttribute("aria-valuenow", String(mailbox.sent));
    const indicator = document.createElement("i");
    indicator.style.setProperty("--capacity-width", `${mailbox.percent}%`);
    if (mailbox.sent) indicator.style.setProperty("--capacity-min", "6px");
    progress.append(indicator);
    row.append(heading, progress);
    capacityFragment.append(row);
  }

  if (!usage.length) {
    const empty = document.createElement("p");
    empty.className = "analytics-empty-copy";
    empty.textContent = "Connect a Gmail sender in Settings to track daily mailbox capacity.";
    capacityFragment.append(empty);
  }
  elements.mailboxCapacityList.replaceChildren(capacityFragment);
}

const SVG_NS = "http://www.w3.org/2000/svg";
function analyticsSvgNode(name, attributes = {}, text = "") {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text) node.textContent = text;
  return node;
}

function renderDailyChart(sentSeries, replySeries) {
  const width = 900;
  const height = 280;
  const frame = { left: 42, right: 18, top: 22, bottom: 36 };
  const plotWidth = width - frame.left - frame.right;
  const plotHeight = height - frame.top - frame.bottom;
  const max = Math.max(4, ...sentSeries.map((day) => day.count), ...replySeries.map((day) => day.count));
  const point = (count, index) => ({
    x: frame.left + (index / Math.max(1, sentSeries.length - 1)) * plotWidth,
    y: frame.top + (1 - count / max) * plotHeight,
  });
  const sentPoints = sentSeries.map((day, index) => point(day.count, index));
  const replyPoints = replySeries.map((day, index) => point(day.count, index));
  const pathFor = (points) => points.map(({ x, y }, index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const sentPath = pathFor(sentPoints);
  const svg = analyticsSvgNode("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
  svg.append(analyticsSvgNode("title", {}, `Daily sends and replies over the last ${sentSeries.length} days`));

  for (let index = 0; index <= 4; index += 1) {
    const y = frame.top + (index / 4) * plotHeight;
    const value = Math.round(max - (index / 4) * max);
    svg.append(analyticsSvgNode("line", { x1: frame.left, x2: width - frame.right, y1: y, y2: y, class: "chart-grid-line" }));
    svg.append(analyticsSvgNode("text", { x: frame.left - 10, y: y + 4, class: "chart-axis-label", "text-anchor": "end" }, value));
  }

  const labelStride = Math.max(1, Math.ceil(sentSeries.length / 7));
  sentSeries.forEach((day, index) => {
    if (index % labelStride !== 0 && index !== sentSeries.length - 1) return;
    svg.append(analyticsSvgNode("text", { x: sentPoints[index].x, y: height - 10, class: "chart-axis-label", "text-anchor": index === 0 ? "start" : index === sentSeries.length - 1 ? "end" : "middle" }, day.shortDate));
  });

  if (sentPoints.length) {
    const baseline = frame.top + plotHeight;
    svg.append(analyticsSvgNode("path", { d: `${sentPath} L${sentPoints.at(-1).x.toFixed(1)} ${baseline} L${sentPoints[0].x.toFixed(1)} ${baseline} Z`, class: "chart-area-sent" }));
    svg.append(analyticsSvgNode("path", { d: sentPath, class: "chart-line chart-line-sent" }));
    svg.append(analyticsSvgNode("path", { d: pathFor(replyPoints), class: "chart-line chart-line-replies" }));
  }

  sentSeries.forEach((day, index) => {
    const hit = analyticsSvgNode("circle", { cx: sentPoints[index].x, cy: sentPoints[index].y, r: 10, class: "chart-hit" });
    hit.append(analyticsSvgNode("title", {}, `${day.shortDate}: ${day.count} sent, ${replySeries[index]?.count || 0} replied`));
    svg.append(hit);
  });
  elements.dailySendChart.replaceChildren(svg);
}

function renderTeamPulse(events = collectSentEvents({ deliveryLog: unifiedDeliveryLog(), queue: state.queue })) {
  const cutoff = Date.now() - 7 * 86_400_000;
  const rows = teamPerformance(events.filter((event) => Date.parse(event.at) >= cutoff));
  const total = rows.reduce((sum, member) => sum + member.sent, 0);
  elements.overviewTeamPulseMeta.textContent = total
    ? `${total.toLocaleString()} message${total === 1 ? "" : "s"} sent by ${rows.length} teammate${rows.length === 1 ? "" : "s"} in the last 7 days.`
    : "Who is moving outreach forward this week.";
  const fragment = document.createDocumentFragment();
  if (rows.length) {
    const rail = document.createElement("div");
    rail.className = "team-pulse-rail";
    rail.setAttribute("aria-label", `${total} team sends in the last 7 days`);
    for (const member of rows) {
      const share = total ? (member.sent / total) * 100 : 0;
      const segment = document.createElement("i");
      segment.style.setProperty("--team-share", `${share}%`);
      addTooltip(segment, `${member.name}: ${member.sent} sent to ${member.recipients} people`);
      rail.append(segment);
    }
    fragment.append(rail);
  }
  const list = document.createElement("div");
  list.className = "team-pulse-list";
  for (const member of rows.slice(0, 5)) {
    const item = document.createElement("article");
    item.className = "team-pulse-member";
    const avatar = appendText(item, "span", initialsFor(member.name), "settings-member-avatar");
    avatar.setAttribute("aria-hidden", "true");
    const copy = appendText(item, "div", "", "team-pulse-copy");
    appendText(copy, "strong", member.name);
    appendText(copy, "small", `${member.recipients} people · ${member.senders.length || (member.senderEmail ? 1 : 0)} mailbox${(member.senders.length || (member.senderEmail ? 1 : 0)) === 1 ? "" : "es"}`);
    appendText(item, "b", member.sent.toLocaleString());
    addTooltip(item, `${member.name} sent ${member.sent} message${member.sent === 1 ? "" : "s"} in the last 7 days${member.senders.length ? ` through ${member.senders.join(", ")}` : ""}.`);
    list.append(item);
  }
  if (!rows.length) appendText(list, "p", "Team sends will appear here as soon as a reviewed email is delivered.", "overview-empty");
  fragment.append(list);
  elements.overviewTeamPulse.replaceChildren(fragment);
}

function renderAnalytics() {
  const deliveryLog = unifiedDeliveryLog();
  const events = collectSentEvents({ deliveryLog, queue: state.queue });
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (state.analyticsDays - 1));
  const rangedEvents = events.filter((event) => Date.parse(event.at) >= cutoff.getTime());
  const replyEvents = state.queue.map((prospect) => {
    const event = latestProspectEvent(prospect, REPLY_ACTIVITY_TYPES);
    return { recipient: String(prospect.email || "").toLowerCase(), at: prospect.replyReceivedAt || event?.at || "" };
  }).filter((event) => event.at);
  const replyRecipients = replyEvents.map((event) => event.recipient).filter(Boolean);
  const latestRangedSendByRecipient = new Map();
  for (const event of rangedEvents) {
    const recipient = String(event.recipient || "").toLowerCase();
    if (recipient && !latestRangedSendByRecipient.has(recipient)) latestRangedSendByRecipient.set(recipient, event);
  }
  const replyOwnerByRecipient = new Map([...latestRangedSendByRecipient].map(([recipient, event]) => [recipient, teamMemberKey(event)]));
  const teamByActivity = teamPerformance(rangedEvents, { replyRecipients, replyOwnerByRecipient });
  const knownKeys = new Set(teamByActivity.map((member) => member.key));
  const teamRows = [...teamByActivity];
  for (const teammate of state.teamMembers) {
    const key = String(teammate.id || teammate.email || "").toLowerCase();
    if (!key || knownKeys.has(key)) continue;
    teamRows.push({
      key,
      name: teammate.full_name || teammate.email || "Vela teammate",
      operatorId: teammate.id || "",
      operatorEmail: teammate.email || "",
      avatarUrl: teammate.avatar_url || "",
      senderEmail: "",
      senders: [],
      sent: 0,
      recipients: 0,
      replies: 0,
      replyRate: 0,
      lastSentAt: "",
    });
  }
  teamRows.sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
  if (state.analyticsMember !== "all" && !teamRows.some((member) => member.key === state.analyticsMember)) state.analyticsMember = "all";
  const selectedMember = teamRows.find((member) => member.key === state.analyticsMember) || null;
  const visibleEvents = selectedMember ? rangedEvents.filter((event) => teamMemberKey(event) === selectedMember.key) : rangedEvents;
  const latestSendByRecipient = new Map();
  for (const event of events) {
    const recipient = String(event.recipient || "").toLowerCase();
    if (recipient && !latestSendByRecipient.has(recipient)) latestSendByRecipient.set(recipient, event);
  }
  const rangedReplies = replyEvents.filter((event) => Date.parse(event.at) >= cutoff.getTime() && (!selectedMember || teamMemberKey(latestSendByRecipient.get(event.recipient) || {}) === selectedMember.key));
  const scopeName = selectedMember?.name || "All team";
  const usage = mailboxCapacityUsage({ deliveryLog, accounts: state.googleAccounts });
  const contacted = new Set(visibleEvents.map((event) => event.recipient || event.identity).filter(Boolean)).size;
  const cohortReplies = selectedMember ? selectedMember.replies : teamByActivity.reduce((sum, member) => sum + member.replies, 0);
  const replyRate = contacted ? Math.round((cohortReplies / contacted) * 100) : 0;

  elements.analyticsScopeTitle.textContent = selectedMember ? `${selectedMember.name}’s output` : "All team output";
  elements.analyticsScopeDetail.textContent = `${scopeName} · last ${state.analyticsDays} days`;
  elements.analyticsSentToday.textContent = visibleEvents.length.toLocaleString();
  elements.analyticsSentTodayDetail.textContent = selectedMember ? `Sent by ${selectedMember.name}` : `Across ${teamByActivity.filter((member) => member.sent).length} active teammate${teamByActivity.filter((member) => member.sent).length === 1 ? "" : "s"}`;
  elements.engagementReplies.textContent = rangedReplies.length.toLocaleString();
  elements.engagementRateDetail.textContent = rangedReplies.length ? "Human replies received in this period" : "No replies received in this period";
  elements.analyticsSendRate.textContent = `${replyRate}%`;
  elements.analyticsSendRateDetail.textContent = contacted ? `${cohortReplies} replied of ${contacted} people reached` : "No delivered outreach in this period";
  elements.analyticsProspectsContacted.textContent = contacted.toLocaleString();
  elements.analyticsProspectsDetail.textContent = `Unique recipients in the last ${state.analyticsDays} days`;
  elements.analyticsPeriodReplyRate.textContent = `${replyRate}%`;
  elements.analyticsActiveSenders.textContent = `${teamByActivity.filter((member) => member.sent).length} active`;

  for (const button of elements.analyticsRange.querySelectorAll("[data-days]")) {
    const active = Number(button.dataset.days) === state.analyticsDays;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  const filterFragment = document.createDocumentFragment();
  const addFilter = (key, name, count, initials = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = key === state.analyticsMember ? "is-active" : "";
    button.dataset.analyticsMember = key;
    button.setAttribute("aria-pressed", String(key === state.analyticsMember));
    if (initials) appendText(button, "span", initials, "analytics-filter-avatar");
    appendText(button, "strong", name);
    appendText(button, "small", count.toLocaleString());
    button.addEventListener("click", () => {
      state.analyticsMember = key;
      renderAnalytics();
      persistWorkspaceStateSoon();
    });
    filterFragment.append(button);
  };
  addFilter("all", "All team", rangedEvents.length);
  for (const member of teamRows) addFilter(member.key, member.name, member.sent, initialsFor(member.name));
  elements.analyticsMemberFilter.replaceChildren(filterFragment);

  const series = buildDailySendSeries(visibleEvents, { days: state.analyticsDays });
  const replySeries = buildDailySendSeries(rangedReplies, { days: state.analyticsDays });
  const summary = summarizeDailySends(series);
  renderDailyChart(series, replySeries);
  elements.dailySendChart.setAttribute("aria-label", `${scopeName} sent ${summary.total} emails and received ${rangedReplies.length} replies in the last ${state.analyticsDays} days.`);
  elements.analyticsWeekSent.textContent = summary.total.toLocaleString();
  elements.analyticsDailyAverage.textContent = summary.average ? summary.average.toFixed(1) : "0";
  elements.analyticsBestDay.textContent = summary.best ? `${summary.best.shortDate} · ${summary.best.count}` : "—";

  const leaderboard = document.createDocumentFragment();
  const teamSentTotal = teamRows.reduce((sum, member) => sum + member.sent, 0);
  for (const [index, member] of teamRows.slice(0, 6).entries()) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `analytics-leader${member.key === state.analyticsMember ? " is-selected" : ""}`;
    item.addEventListener("click", () => {
      state.analyticsMember = member.key;
      renderAnalytics();
      persistWorkspaceStateSoon();
    });
    appendText(item, "b", String(index + 1).padStart(2, "0"), "analytics-leader-rank");
    appendText(item, "span", initialsFor(member.name), "settings-member-avatar");
    const copy = appendText(item, "span", "", "analytics-leader-copy");
    appendText(copy, "strong", member.name);
    appendText(copy, "small", member.sent ? `${member.recipients} people · ${member.replyRate}% reply rate` : "No sends in this period");
    appendText(item, "em", member.sent.toLocaleString());
    leaderboard.append(item);
  }
  if (!teamRows.length) appendText(leaderboard, "p", "Team performance appears after the first delivery.", "analytics-empty-copy");
  elements.analyticsLeaderboard.replaceChildren(leaderboard);

  elements.analyticsTeamDescription.textContent = `Sent volume and reply outcomes for the last ${state.analyticsDays} days.`;
  const teamFragment = document.createDocumentFragment();
  for (const member of teamRows) {
    const row = document.createElement("tr");
    row.className = member.key === state.analyticsMember ? "is-selected" : "";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Filter analytics to ${member.name}`);
    const selectMember = () => {
      state.analyticsMember = member.key;
      renderAnalytics();
      persistWorkspaceStateSoon();
    };
    row.addEventListener("click", selectMember);
    row.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); selectMember(); } });
    const person = document.createElement("td");
    const identity = appendText(person, "div", "", "analytics-member");
    appendText(identity, "span", initialsFor(member.name), "settings-member-avatar");
    const personCopy = appendText(identity, "div", "", "analytics-member-copy");
    appendText(personCopy, "strong", member.name);
    appendText(personCopy, "small", member.senders.length ? member.senders.join(", ") : member.operatorEmail || "No mailbox activity");
    row.append(person);
    appendText(row, "td", member.sent.toLocaleString(), "analytics-number-cell");
    appendText(row, "td", member.recipients.toLocaleString());
    appendText(row, "td", member.replies.toLocaleString());
    const rateCell = appendText(row, "td", `${member.replyRate}%`, `analytics-rate-cell${member.replyRate ? " has-replies" : ""}`);
    rateCell.dataset.rate = String(member.replyRate);
    const shareCell = document.createElement("td");
    const share = teamSentTotal ? Math.round((member.sent / teamSentTotal) * 100) : 0;
    const shareCopy = appendText(shareCell, "div", "", "team-share-cell");
    const shareTrack = appendText(shareCopy, "span", "", "team-share-track");
    const shareIndicator = document.createElement("i");
    shareIndicator.style.setProperty("--team-share", `${share}%`);
    shareTrack.append(shareIndicator);
    appendText(shareCopy, "strong", `${share}%`);
    row.append(shareCell);
    appendText(row, "td", member.lastSentAt ? relativeTime(member.lastSentAt) : "—");
    teamFragment.append(row);
  }
  if (!teamRows.length) {
    const row = document.createElement("tr");
    const cell = appendText(row, "td", "No teammate activity in this period.", "analytics-table-empty");
    cell.colSpan = 7;
    teamFragment.append(row);
  }
  elements.analyticsTeamBody.replaceChildren(teamFragment);

  const inScopeRecord = (record) => !selectedMember || teamMemberKey(record) === selectedMember.key;
  const followUpRecords = deliveryLog.filter((record) => record.kind === "follow-up" && inScopeRecord(record));
  const sentFollowUps = followUpRecords.filter((record) => [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status));
  const activeSequenceIds = new Set(state.scheduledJobs.filter((job) => job.status === DELIVERY_STATUS.SCHEDULED && job.kind === "follow-up" && inScopeRecord(job)).map((job) => job.sequenceId).filter(Boolean));
  elements.analyticsActiveSequences.textContent = activeSequenceIds.size.toLocaleString();
  elements.analyticsActiveSequencesDetail.textContent = activeSequenceIds.size ? "Waiting" : "None waiting";
  elements.analyticsFollowUpsSent.textContent = sentFollowUps.length.toLocaleString();
  elements.analyticsFollowUpsDetail.textContent = "Sent automatically";
  elements.analyticsReplyRate.textContent = `${replyRate}% reply rate`;
  elements.sequenceInitialCount.textContent = deliveryLog.filter((record) => record.kind !== "follow-up" && [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status) && inScopeRecord(record)).length.toLocaleString();
  elements.sequenceStepOneCount.textContent = sentFollowUps.filter((record) => record.sequenceStep === 1).length.toLocaleString();
  elements.sequenceStepTwoCount.textContent = sentFollowUps.filter((record) => record.sequenceStep === 2).length.toLocaleString();
  elements.sequenceStepThreeCount.textContent = sentFollowUps.filter((record) => record.sequenceStep === 3).length.toLocaleString();
  elements.sequenceReplyCount.textContent = rangedReplies.length.toLocaleString();
  renderMailboxCapacity(usage);

  const activityFragment = document.createDocumentFragment();
  for (const event of visibleEvents.filter((item) => item.senderEmail || item.recipient).slice(0, 7)) {
    const row = document.createElement("article");
    row.className = "analytics-activity-row";
    row.title = [event.subject || "No subject", event.recipient ? `To ${event.recipient}` : "", event.senderEmail ? `From ${event.senderEmail}` : ""].filter(Boolean).join(" · ");
    appendText(row, "span", initialsFor(event.operatorName || event.senderEmail), "settings-member-avatar");
    const copy = appendText(row, "div", "", "analytics-activity-copy");
    appendText(copy, "strong", event.operatorName || event.senderEmail || "Vela teammate");
    appendText(copy, "span", event.subject || event.recipient || "Outreach email");
    const meta = appendText(row, "div", "", "analytics-activity-meta");
    appendText(meta, "strong", event.recipient || "—");
    appendText(meta, "time", relativeTime(event.at));
    activityFragment.append(row);
  }
  if (!activityFragment.childNodes.length) appendText(activityFragment, "p", "No sends in this period.", "analytics-empty-copy");
  elements.analyticsActivityList.replaceChildren(activityFragment);
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
  const deliveryLog = unifiedDeliveryLog();
  const deliveredToday = deliveryLog.filter((record) => [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status) && Date.parse(record.completedAt || record.updatedAt) >= startOfDay);
  elements.overviewReviewCount.textContent = state.queue.filter((item) => belongsToResearch(item) && item.status === QUEUE_STATUS.READY).length;
  elements.overviewScheduledCount.textContent = scheduled.filter((job) => Date.parse(job.scheduledAt) <= nextDay).length;
  elements.overviewSentTodayCount.textContent = deliveredToday.length;
  renderTeamPulse();
  renderResponseQueue();

  const scheduleFragment = document.createDocumentFragment();
  for (const record of scheduled.slice(0, 3)) scheduleFragment.append(createDeliveryRow(record, { compact: true }));
  if (!scheduled.length) appendText(scheduleFragment, "p", "No sends are queued. Review a verified draft in the side panel to schedule one.", "overview-empty");
  elements.overviewScheduleList.replaceChildren(scheduleFragment);

  const activityFragment = document.createDocumentFragment();
  const recent = deliveryLog.filter((record) => record.status !== DELIVERY_STATUS.SCHEDULED).slice(0, 3);
  for (const record of recent) activityFragment.append(createDeliveryRow(record, { compact: true }));
  if (!recent.length) appendText(activityFragment, "p", "Delivered, failed, and cancelled sends will build a permanent local log here.", "overview-empty");
  elements.overviewActivityList.replaceChildren(activityFragment);

  const readyProspects = state.queue
    .filter((item) => belongsToResearch(item) && item.status === QUEUE_STATUS.READY)
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

function historySenderKey(operator = {}) {
  return String(operator.id || operator.email || operator.name || "local").trim().toLowerCase();
}

function renderHistoryWorkspace(records = []) {
  const enriched = records.map((record) => ({ record, operator: deliveryOperator(record) }));
  const recipients = new Set(records.flatMap((record) => record.recipients || []).filter(Boolean));
  const senders = new Map();
  for (const item of enriched) senders.set(historySenderKey(item.operator), item.operator);
  const delivered = records.filter((record) => [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status)).length;
  elements.historyTotal.textContent = records.length.toLocaleString();
  elements.historyPeople.textContent = recipients.size.toLocaleString();
  elements.historyTeammates.textContent = senders.size.toLocaleString();
  elements.historyDelivered.textContent = delivered.toLocaleString();

  const senderOptions = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All teammates";
  senderOptions.append(allOption);
  for (const [key, operator] of [...senders.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = operator.name;
    senderOptions.append(option);
  }
  elements.historySenderFilter.replaceChildren(senderOptions);
  if (state.historySender !== "all" && !senders.has(state.historySender)) state.historySender = "all";
  elements.historySenderFilter.value = state.historySender;

  const query = state.historyQuery.trim().toLowerCase();
  const visible = enriched.filter(({ record, operator }) => {
    if (state.historySender !== "all" && historySenderKey(operator) !== state.historySender) return false;
    if (!query) return true;
    return [operator.name, operator.email, record.senderEmail, record.subject, ...(record.recipients || [])]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  const pageInfo = paginate(visible, state.historyPage, DATA_PAGE_SIZE);
  state.historyPage = pageInfo.page;
  elements.historyResultCount.textContent = visible.length
    ? `${pageInfo.start.toLocaleString()}–${pageInfo.end.toLocaleString()} of ${visible.length.toLocaleString()} messages`
    : "0 messages";
  elements.historyEmpty.hidden = visible.length > 0;
  elements.historyBody.closest("table").hidden = visible.length === 0;

  const fragment = document.createDocumentFragment();
  pageInfo.items.forEach(({ record, operator }, index) => {
    const row = document.createElement("tr");
    row.dataset.slot = "table-row";
    row.style.setProperty("--row-index", String(Math.min(index, 10)));

    const operatorCell = document.createElement("td");
    operatorCell.dataset.slot = "table-cell";
    const operatorIdentity = appendText(operatorCell, "div", "", "history-person");
    appendText(operatorIdentity, "span", initialsFor(operator.name), "settings-member-avatar");
    const operatorCopy = appendText(operatorIdentity, "div", "", "history-person-copy");
    appendText(operatorCopy, "strong", operator.name);
    appendText(operatorCopy, "small", operator.email || "Current browser");
    addTooltip(operatorIdentity, `${operator.name}${operator.email ? ` · ${operator.email}` : ""}`);
    row.append(operatorCell);

    const recipientCell = document.createElement("td");
    recipientCell.dataset.slot = "table-cell";
    const recipient = record.recipients?.join(", ") || "Recipient unavailable";
    const prospect = deliveryProspect(record);
    const recipientCopy = appendText(recipientCell, "div", "", "history-recipient");
    appendText(recipientCopy, "strong", prospect?.name || recipient);
    if (prospect?.name) appendText(recipientCopy, "small", recipient);
    addTooltip(recipientCopy, recipient);
    row.append(recipientCell);

    const messageCell = document.createElement("td");
    messageCell.dataset.slot = "table-cell";
    const messageCopy = appendText(messageCell, "div", "", "history-message");
    appendText(messageCopy, "strong", record.subject || "Untitled message");
    appendText(messageCopy, "small", deliveryModeLabel(record));
    addTooltip(messageCopy, record.subject || "Untitled message");
    row.append(messageCell);

    const mailboxCell = appendText(row, "td", record.senderEmail || "—", "history-mailbox");
    mailboxCell.dataset.slot = "table-cell";
    addTooltip(mailboxCell, record.senderEmail ? `Delivered through ${record.senderEmail}` : "Sending mailbox unavailable");

    const statusCell = document.createElement("td");
    statusCell.dataset.slot = "table-cell";
    const badge = appendText(statusCell, "span", deliveryStatusLabel(record.status), `delivery-state delivery-state-${record.status}`);
    if (record.error) addTooltip(badge, record.error);
    row.append(statusCell);

    const dateCell = document.createElement("td");
    dateCell.dataset.slot = "table-cell";
    const occurredAt = record.completedAt || record.scheduledAt || record.updatedAt || record.createdAt;
    const time = appendText(dateCell, "time", deliveryDate(occurredAt));
    time.dateTime = occurredAt || "";
    addTooltip(time, occurredAt ? new Date(occurredAt).toLocaleString() : "Unknown time");
    row.append(dateCell);
    fragment.append(row);
  });
  elements.historyBody.replaceChildren(fragment);
  renderDataPagination(elements.historyPagination, pageInfo, "Sent history", (page) => {
    state.historyPage = page;
    renderHistoryWorkspace(records);
    elements.historyWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function renderDeliveryOperations() {
  if (!["scheduled", "history"].includes(state.view)) return;
  const scheduledView = state.view === "scheduled";
  const records = scheduledView
    ? state.scheduledJobs.filter((job) => job.status === DELIVERY_STATUS.SCHEDULED).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
    : unifiedDeliveryLog().filter((record) => record.status !== DELIVERY_STATUS.SCHEDULED);
  elements.operationsKicker.textContent = scheduledView ? "Delivery queue" : "Delivery ledger";
  elements.operationsTitle.textContent = scheduledView ? "Scheduled sends" : "Every delivery, in one place";
  elements.operationsDescription.textContent = scheduledView
    ? "These reviewed messages are persisted in Chrome and will run through Gmail at the listed time."
    : state.backendStatus === "synced"
      ? "Vela team activity plus this browser's local ledger, deduplicated into one sent history."
      : "Local sent history is active. Sign in to the Vela workspace in Settings for team-wide activity.";
  elements.operationsPrimaryAction.textContent = scheduledView ? "Review more drafts" : "Open review queue";
  elements.deliveryList.hidden = !scheduledView;
  elements.historyWorkspace.hidden = scheduledView;
  if (!scheduledView) {
    renderHistoryWorkspace(records);
    return;
  }
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
  } else if (prospect.emailSentAt || prospect.status === QUEUE_STATUS.SENT || unifiedDeliveryLog().some((record) => record.prospectId === prospect.id && [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status))) {
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
      ? `Remove ${prospect.name || "this prospect"} from “${campaign.name}”? The shared contact and research will stay in Contacts.`
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
  const deliveredCount = collectSentEvents({ deliveryLog: unifiedDeliveryLog(), queue: state.queue }).length;
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
  elements.navResearch.textContent = state.queue.filter((item) => belongsToResearch(item) && [QUEUE_STATUS.NEW, QUEUE_STATUS.PROCESSING, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status)).length;
  elements.navReview.textContent = state.queue.filter((item) => belongsToResearch(item) && item.status === QUEUE_STATUS.READY).length;
  elements.navScheduled.textContent = scheduledCount;
  elements.navTracking.textContent = deliveredCount;
  elements.agentPanel.hidden = state.view !== "research";
  renderResearchRun();
  elements.metricsPanel.hidden = state.view !== "overview";
  elements.analyticsPanel.hidden = state.view !== "analytics";
  elements.overviewPanel.hidden = state.view !== "overview";
  elements.contactsPanel.hidden = state.view !== "contacts";
  elements.operationsPanel.hidden = !["scheduled", "history"].includes(state.view);
  elements.queueSection.hidden = ["overview", "research", "analytics", "scheduled", "history", "contacts"].includes(state.view);
  renderOverview();
  renderAnalytics();
  renderDeliveryOperations();
  renderContacts();
  const visible = visibleProspects();
  elements.emptyState.hidden = state.searching || visible.length > 0;
  elements.queueBody.hidden = !state.searching && visible.length === 0;
  elements.resultCount.textContent = state.searching ? "Researching…" : state.view === "review" ? `${visible.length} in this approval batch` : `${visible.length} ${visible.length === 1 ? "person" : "people"}`;
  elements.selectAll.checked = visible.length > 0 && visible.every((item) => state.selected.has(item.id));
  elements.selectAll.indeterminate = visible.some((item) => state.selected.has(item.id)) && !elements.selectAll.checked;
  elements.selectedCount.textContent = state.selected.size;
  elements.bulkBar.hidden = state.selected.size === 0;
  elements.bulkResearchButton.hidden = state.view === "review";
  elements.openImportButtonTop.hidden = state.view === "review";
  elements.statusFilterButton.hidden = state.view === "review";
  elements.newCampaignButtonTop.hidden = state.view === "review";
  const readyToApprove = visible.filter((item) => item.status === QUEUE_STATUS.READY && isEmail(item.email) && item.subject && item.body);
  const approvedToRun = visible.filter((item) => item.status === QUEUE_STATUS.DRAFTED && isEmail(item.email) && item.subject && item.body);
  elements.sendAllButton.textContent = state.view === "review" ? "Run approved" : "Send approved";
  elements.sendAllButton.disabled = approvedToRun.length === 0;
  const qualifiedCount = visible.filter((item) => item.targetFit?.verdict === "strong" && [QUEUE_STATUS.NEW, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status)).length;
  elements.processButton.textContent = state.view === "review" ? `Approve & run${readyToApprove.length ? ` ${readyToApprove.length}` : ""}` : qualifiedCount ? `Draft ${qualifiedCount} qualified` : "Draft qualified";
  elements.processButton.disabled = state.busy || (state.view === "review" ? readyToApprove.length === 0 : qualifiedCount === 0);
  const completedBatchSize = Math.max(0, Number(state.researchRun?.foundCount) || 0);
  const batchPage = Math.max(1, Number(state.researchRun?.page) || 1);
  const totalMatches = Math.max(0, Number(state.researchRun?.totalFound) || 0);
  elements.nextResearchBatchButton.hidden = state.view !== "review" || state.busy || !state.searchPlan || completedBatchSize === 0 || batchPage * (state.researchRun?.requestedCount || 100) >= totalMatches;
  if (!elements.nextResearchBatchButton.hidden) elements.nextResearchBatchButton.firstChild.textContent = `Research next batch (${batchPage + 1}) `;
  const emptyTitle = elements.emptyState.querySelector("h3");
  const emptyDescription = elements.emptyState.querySelector("p");
  emptyTitle.textContent = campaign ? `No prospects in ${campaign.name}` : state.view === "review" ? "No drafts are waiting" : "No prospects in this view";
  emptyDescription.textContent = campaign ? "Add Apollo people or import a list while this campaign is selected." : state.view === "review" ? "Research a new audience with Vela. Qualified people and personalized drafts will arrive here for approval." : "Start a Research conversation to build a new audience.";

  const fragment = document.createDocumentFragment();
  if (state.searching) {
    for (let index = 0; index < 8; index += 1) {
      const row = document.createElement("tr");
      row.className = "queue-row skeleton-row";
      for (let cell = 0; cell < 9; cell += 1) appendText(row, "td", "", "skeleton-cell");
      fragment.append(row);
    }
    elements.queueBody.replaceChildren(fragment);
    return;
  }
  for (const prospect of visible) {
    const row = document.createElement("tr");
    row.className = `queue-row${state.selected.has(prospect.id) ? " is-selected" : ""}${state.keyboardProspectId === prospect.id ? " is-keyboard-active" : ""}`;
    row.dataset.prospectId = prospect.id;
    row.addEventListener("dblclick", (event) => openReviewDrawer(prospect.id, event.currentTarget));
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

    const fitCell = document.createElement("td");
    fitCell.className = "fit-cell";
    const fit = prospect.auditStatus === "error"
      ? { label: "Audit failed", className: "fit-skip" }
      : !prospect.targetFit && ["queued", "processing"].includes(prospect.auditStatus)
        ? { label: prospect.auditStatus === "processing" ? "Auditing…" : "Queued", className: "fit-pending" }
        : fitLabel(prospect.targetFit);
    const fitPill = appendText(fitCell, "span", fit.label, `fit-pill ${fit.className}`);
    fitPill.title = prospect.targetFit?.reason || prospect.auditError || (prospect.auditedBy?.name ? `${prospect.auditedBy.name} is auditing this person.` : "Vela has not checked this person yet.");

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

    row.append(checkCell, personCell, roleCell, fitCell, emailCell, statusCell, draftCell, updatedCell, actions);
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
  if (isExtension) {
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_PROSPECTS_SYNC", prospects });
    if (!response?.ok) showToast(response?.error || "Prospects were saved locally, but team sync needs attention.");
  }
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
}

async function syncCurrentResearchRun({ quiet = true } = {}) {
  if (!state.researchRun || !isExtension) return state.researchRun;
  const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_RESEARCH_RUN_SYNC", run: state.researchRun });
  if (!response?.ok) {
    if (!quiet) showToast(response?.error || "The research run is local while team sync reconnects.");
    return state.researchRun;
  }
  state.researchRun = { ...state.researchRun, ...response.data, operatorName: state.researchRun.operatorName };
  renderResearchRun();
  return state.researchRun;
}

function newResearchRun(brief, { page = 1 } = {}) {
  const operator = currentOperator();
  state.researchRun = {
    id: crypto.randomUUID(), brief, status: "planning", requestedCount: 100, page: Math.max(1, Number(page) || 1),
    totalFound: 0, foundCount: 0, auditedCount: 0, strongCount: 0, reviewCount: 0, skipCount: 0,
    createdBy: operator.id, operatorName: operator.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: "",
  };
  renderResearchRun();
  return state.researchRun;
}

async function verifyAuditTarget(request, prospect) {
  if (!isExtension) {
    await new Promise((resolve) => setTimeout(resolve, 55));
    const relevant = /power|energy|critical|site|infrastructure|utility|data center/i.test(`${prospect.headline || ""} ${prospect.background || ""}`);
    return normalizeTargetFit({ verdict: relevant ? "strong" : "review", score: relevant ? 88 : 58, reason: relevant ? "Direct responsibility for energy-intensive infrastructure decisions." : "Plausible adjacency, but direct power responsibility needs review.", evidence: [prospect.headline || "Infrastructure leadership"], model: "preview" });
  }
  const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_VERIFY_TARGET", input: request });
  if (!response?.ok) throw new Error(response?.error || "OpenAI fit audit failed.");
  return normalizeTargetFit(response.data);
}

async function auditDiscoveredProspects(run) {
  const runProspects = state.queue.filter((prospect) => prospect.researchRunId === run.id);
  if (!runProspects.length) return;
  state.researchRun = { ...state.researchRun, status: "auditing", foundCount: runProspects.length, updatedAt: new Date().toISOString() };
  await syncCurrentResearchRun();
  const gmailContext = gmailLearningContext({ activity: unifiedDeliveryLog(), prospects: state.queue });
  const operator = currentOperator();
  updateAgentActivity("research", "Preparing your results", `0 of ${runProspects.length} processed`);
  const audited = await auditResearchBatch(runProspects, {
    concurrency: 4,
    gmailContext,
    operator,
    verify: verifyAuditTarget,
    onProgress: async ({ prospect, completed, total }) => {
      state.queue = state.queue.map((item) => item.id === prospect.id ? { ...prospect, updatedAt: new Date().toISOString() } : item);
      const counts = researchRunCounts(state.queue.filter((item) => item.researchRunId === run.id));
      state.researchRun = { ...state.researchRun, ...counts, status: "auditing", updatedAt: new Date().toISOString() };
      updateAgentActivity("research", `Processing ${prospect.name || "person"}`, `${completed} of ${total}`);
      renderQueue();
      if (completed % 10 === 0 || completed === total) {
        await persistQueue();
        await syncCurrentResearchRun();
      }
    },
  });
  const auditedById = new Map(audited.map((prospect) => [prospect.id, prospect]));
  state.queue = state.queue.map((item) => auditedById.get(item.id) || item);
  const counts = researchRunCounts(audited);
  state.researchRun = { ...state.researchRun, ...counts, status: "complete", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await persistQueue();
  await syncCurrentResearchRun({ quiet: false });
  updateAgentActivity("draft", "Results ready", `${counts.foundCount} people pulled`);
  renderQueue();
}

async function runDiscoveryPlan(plan, run) {
  if (!isExtension) {
    state.searching = true;
    state.researchRun = { ...state.researchRun, status: "searching", totalFound: 8_342 };
    renderQueue();
    await new Promise((resolve) => setTimeout(resolve, 650));
    state.searching = false;
    const prospects = DEMO_QUEUE.map((person, index) => ({ ...person, targetFit: null, status: QUEUE_STATUS.NEW, providerId: `preview-${index}`, source: "Apollo People Search", researchRunId: run.id, auditStatus: "queued", auditedBy: currentOperator() }));
    await addProspects(prospects, `Pulled ${prospects.length} of 8,342 matching people.`);
    await auditDiscoveredProspects(run);
    return;
  }
  if (!state.settings.apolloApiKey) {
    showToast("Connect Apollo in Settings before discovering people.");
    chrome.runtime.openOptionsPage();
    return;
  }
  const found = new Map();
  let totalFound = 0;
  let broadened = false;
  try {
    setBusy(true, "Researching people with Apollo");
    state.researchRun = { ...state.researchRun, status: "searching", updatedAt: new Date().toISOString() };
    await syncCurrentResearchRun();
    state.searching = true;
    renderQueue();
    for (const [index, search] of (plan.searches || []).entries()) {
      const remaining = 100 - found.size;
      if (remaining <= 0) break;
      updateAgentActivity("source", `Searching Apollo · ${index + 1}/${plan.searches.length}`, search.label || search.query);
      const recovery = await searchApolloPeopleWithRecovery({ ...search.filters, page: run.page || 1, limit: remaining }, {
        search: async (filters) => {
          const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_PEOPLE_SEARCH", filters });
          if (!response?.ok) throw new Error(response?.error || "Apollo People Search failed.");
          return response.data || { prospects: [], total: 0 };
        },
        onRetry: () => updateAgentActivity("source", "Broadening within your brief", "Allowing similar titles and removing optional keyword and industry filters"),
      });
      broadened ||= recovery.broadened;
      totalFound = Math.max(totalFound, Math.max(0, Number(recovery.data?.total) || 0));
      state.researchRun = { ...state.researchRun, totalFound, status: "searching", updatedAt: new Date().toISOString() };
      renderResearchRun();
      for (const person of recovery.data?.prospects || []) {
        const key = person.providerId || person.url || person.email;
        if (key && !found.has(key)) found.set(key, person);
        if (found.size >= 100) break;
      }
    }
    state.searching = false;
    if (!found.size) {
      state.researchRun = { ...state.researchRun, totalFound, foundCount: 0, status: "complete", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: "" };
      await syncCurrentResearchRun();
      renderResearchRun();
      appendResearchEmptyState(run.brief, plan, { broadened });
      return { empty: true, broadened };
    }
    const prospects = [...found.values()].map((person) => ({ ...person, researchRunId: run.id, auditStatus: "queued", auditedBy: currentOperator(), updatedAt: new Date().toISOString() }));
    await addProspects(prospects, `Prepared research batch ${run.page || 1} with ${found.size} people from ${totalFound.toLocaleString()} matches.`);
    state.researchRun = { ...state.researchRun, totalFound, foundCount: prospects.length, status: "auditing", updatedAt: new Date().toISOString() };
    state.keyboardProspectId = state.queue.find((item) => item.researchRunId === run.id)?.id || null;
    await auditDiscoveredProspects(run);
    return { empty: false, broadened };
  } finally {
    state.searching = false;
    setBusy(false);
    renderQueue();
  }
}

async function researchAgentTurn(message) {
  elements.agentActivity.hidden = false;
  updateAgentActivity("plan", "Thinking", "Deciding whether to answer, plan, or run confirmed research");
  const pendingPlan = state.pendingResearchPlan?.plan || null;
  const history = state.researchConversation.slice(0, -1);
  if (!isExtension) {
    const execute = pendingPlan && /^(?:yes[, ]*)?(?:run it|start it|go ahead|execute it|looks good|do it)\.?$/i.test(message.trim());
    if (execute) return { mode: "execute", reply: "I’ll start the confirmed research plan now.", plan: null };
    const plansResearch = /\b(find|research|source|identify|discover|look for|build (?:me )?(?:a )?list)\b/i.test(message);
    if (!plansResearch) {
      elements.agentActivity.hidden = true;
      return { mode: "chat", reply: "Absolutely — I can chat through GTM ideas, audiences, messaging, or how this workspace works. I’ll only create a research plan when you clearly ask me to find people.", plan: null };
    }
    const plan = {
      strategy: "Search for direct operating and power responsibility.",
      searches: [
        { label: "People search", query: message, rationale: "Matches the requested audience.", facets: ["operations"], filters: { job_title: ["Critical Operations", "Data Center Operations", "Energy Strategy", "Power Procurement"], seniority: ["manager", "director", "vp"], skills: [], location: [], industry: [], company: [], keyword: "power infrastructure" } },
      ],
    };
    renderSearchPlan(plan);
    elements.agentActivity.hidden = true;
    return { mode: "plan", reply: "That sounds like a people-research request, so I prepared an audience plan for you to review.", plan };
  }
  if (state.settings.openAIApiKey) {
    let capabilities;
    try {
      capabilities = await chrome.runtime.sendMessage({ type: RUNTIME_CAPABILITIES_MESSAGE });
    } catch {
      throw new Error(RUNTIME_RELOAD_MESSAGE);
    }
    if (!capabilities?.ok || !capabilities.data?.providerActions?.includes(PROVIDER_ACTION.RESEARCH_MESSAGE)) {
      throw new Error(runtimeMismatchMessage(capabilities?.error || "Unknown Vela provider action."));
    }
    const response = await chrome.runtime.sendMessage({ type: PROVIDER_ACTION.RESEARCH_MESSAGE, message, history, pendingPlan });
    if (!response?.ok) throw new Error(runtimeMismatchMessage(response?.error || "Vela assistant failed."));
    if (response.data?.plan) renderSearchPlan(response.data.plan);
    elements.agentActivity.hidden = true;
    return response.data;
  }
  if (!state.settings.writerEndpointUrl) throw new Error("Add an OpenAI API key in Settings to use the Vela assistant.");
  const endpoint = agentEndpoint("/research-message");
  if (!(await ensureOriginPermission(endpoint))) throw new Error("Vela agent server access was declined.");
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (state.settings.writerToken) headers.Authorization = `Bearer ${state.settings.writerToken}`;
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ message, history, pendingPlan }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Vela assistant returned ${response.status}.`);
  if (payload.data?.plan) renderSearchPlan(payload.data.plan);
  elements.agentActivity.hidden = true;
  return payload.data;
}

async function executeResearchPlan(plan, brief, { page = 1 } = {}) {
  if (state.busy || state.searching) return;
  state.searchPlan = plan;
  state.pendingResearchPlan = null;
  persistWorkspaceStateSoon();
  for (const button of elements.researchMessages.querySelectorAll(".research-plan-run")) button.disabled = true;
  appendResearchMessage("assistant", page > 1 ? `I’m researching batch ${page} now.` : "I’m starting the research now.", "I’ll evaluate the people, prepare qualified drafts, and move the finished batch into Approvals.");
  const run = newResearchRun(brief, { page });
  setResearchComposerBusy(true);
  try {
    await syncCurrentResearchRun();
    const discovery = await runDiscoveryPlan(plan, run);
    if (discovery?.empty) return;
    const strongIds = state.queue
      .filter((prospect) => prospect.researchRunId === run.id && prospect.targetFit?.verdict === "strong" && [QUEUE_STATUS.NEW, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(prospect.status))
      .map((prospect) => prospect.id);
    if (strongIds.length) await processQueue(strongIds);
    const ready = state.queue.filter((prospect) => prospect.researchRunId === run.id && prospect.status === QUEUE_STATUS.READY);
    const needsAttention = state.queue.filter((prospect) => prospect.researchRunId === run.id && [QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(prospect.status));
    state.researchRun = { ...state.researchRun, readyCount: ready.length, needsAttentionCount: needsAttention.length, updatedAt: new Date().toISOString() };
    await syncCurrentResearchRun();
    renderResearchRun();
    if (ready.length) {
      appendResearchMessage("assistant", `${ready.length} ${ready.length === 1 ? "person is" : "people are"} ready in Approvals.`, needsAttention.length ? `${needsAttention.length} more need contact or research attention and were kept out of the approval batch.` : "Review the audience and drafts, then use Approve & run when you’re ready.");
      setView("review");
    } else {
      appendResearchMessage("assistant", "The research finished, but nothing is ready for approval yet.", needsAttention.length ? `${needsAttention.length} people need contact or research attention. Refine the audience or check the connected providers and try again.` : "Try broadening the audience or removing one of the filters.");
    }
  } catch (error) {
    state.researchRun = { ...state.researchRun, status: "error", error: error instanceof Error ? error.message : "Research failed.", updatedAt: new Date().toISOString() };
    await syncCurrentResearchRun().catch(() => {});
    renderResearchRun();
    appendResearchMessage("assistant", "I couldn’t finish that research run.", state.researchRun.error);
    showToast(state.researchRun.error);
  } finally {
    setResearchComposerBusy(false);
    if (!state.busy) elements.agentActivity.hidden = true;
  }
}

async function runNextResearchBatch() {
  if (!state.searchPlan || !state.researchRun || state.busy) return;
  const nextPage = Math.max(1, Number(state.researchRun.page) || 1) + 1;
  const brief = state.researchRun.brief;
  setView("research");
  appendResearchMessage("user", "Research the next batch.");
  await executeResearchPlan(state.searchPlan, brief, { page: nextPage });
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
    const input = buildWriterRequest(profile, templateSettings, workNote, draft, { generationMode: "full", template });
    const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_WRITE", input });
    if (!response?.ok) throw new Error(response?.error || "OpenAI writing failed.");
    const result = normalizeWriterResponse({ data: response.data, model: state.settings.openAIModel || "gpt-5.4-mini" }, profile);
    const draftIssues = fullDraftQualityIssues(result, input);
    if (draftIssues.length) throw new Error(`The AI writer returned an incomplete email. ${draftIssues.join(" ")}`);
    return result;
  }
  if (!state.settings.writerEndpointUrl) throw new Error("Add an OpenAI key in Settings before researching prospects.");
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (state.settings.writerToken) headers.Authorization = `Bearer ${state.settings.writerToken}`;
  const input = buildWriterRequest(profile, templateSettings, workNote, draft, { generationMode: "full", template });
  const response = await fetch(state.settings.writerEndpointUrl, {
    method: "POST", headers, body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `AI writer returned ${response.status}.`);
  const result = normalizeWriterResponse(payload, profile);
  const draftIssues = fullDraftQualityIssues(result, input);
  if (draftIssues.length) throw new Error(`The AI writer returned an incomplete email. ${draftIssues.join(" ")}`);
  return result;
}

async function callTargetFit(profile) {
  if (!state.settings.openAIApiKey) throw new Error("Add an OpenAI key in Settings to verify Vela target fit.");
  const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_PROVIDER_VERIFY_TARGET", input: buildTargetFitRequest(profile) });
  if (!response?.ok) throw new Error(response?.error || "Vela target verification failed.");
  return normalizeTargetFit({ data: response.data, model: state.settings.openAIModel || "gpt-5.4-mini" });
}

async function researchProspect(prospect, { approveSessionReveal = false } = {}) {
  let tab;
  try {
    const providerSourced = /^(ContactOut|Apollo) People Search$/i.test(prospect.source || "") && prospect.profile;
    let profile;
    if (providerSourced) {
      profile = {
        ...prospect.profile,
        providerId: prospect.providerId,
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
    let contactDetails = { emails: [], workEmails: [], personalEmails: [], phones: [], emailStatus: "", emailStatuses: {}, emailSources: {}, error: "" };
    let contactOutError = "";
    let workNote = prospect.background || buildWorkNote(profile);
    if (state.settings.contactOutSessionEnabled || state.settings.contactOutApiKey || state.settings.apolloApiKey || state.settings.endpointUrl) {
      try {
        const enriched = await callEnrichment(profile, { approveSessionReveal });
        if (enriched.email) { email = enriched.email; emailSource = enriched.emailSource || "Enrichment service"; }
        contactDetails = {
          emails: enriched.emails || [], workEmails: enriched.workEmails || [], personalEmails: enriched.personalEmails || [],
          unverifiedEmails: enriched.unverifiedEmails || [], unverifiedWorkEmails: enriched.unverifiedWorkEmails || [], unverifiedPersonalEmails: enriched.unverifiedPersonalEmails || [],
          phones: enriched.phones || [], emailStatus: enriched.emailStatus || "", emailStatuses: enriched.emailStatuses || {}, emailSources: enriched.emailSources || {}, source: enriched.emailSource || "", error: "",
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

    updateAgentActivity("research", `Verifying ${profile.name || prospect.name || "target"}`, "Checking operating responsibility against Vela’s target context");
    const targetFit = await callTargetFit(profile);
    const fallback = templateDraft(profile, workNote);
    const written = await callWriter(profile, workNote, fallback);

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
      targetFit,
      workNote: written.workNote || workNote,
      subject: written.subject,
      body: written.body,
      status: isEmail(email) ? QUEUE_STATUS.READY : QUEUE_STATUS.NEEDS_EMAIL,
      error: isEmail(email) ? "" : contactOutError || (providerSourced
        ? "No verified email was returned by the configured contact-data providers."
        : "No email was available in LinkedIn Contact Info or the configured enrichment service."),
      researchedAt,
      activity: [...(prospect.activity || []), { type: "target_verified", detail: `Vela fit: ${targetFit.verdict} (${targetFit.score})`, at: researchedAt }, { type: "researched", detail: "Apollo profile enriched and complete email drafted", at: researchedAt }].slice(-80),
      updatedAt: researchedAt,
    };
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function processQueue(ids = null) {
  if (state.busy) return;
  if (!isExtension) {
    const targets = new Set(ids || scopedQueue().filter((item) => [QUEUE_STATUS.NEW, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status) && item.targetFit?.verdict === "strong").map((item) => item.id));
    const researchedAt = new Date().toISOString();
    state.queue = state.queue.map((item) => targets.has(item.id) ? {
      ...withActivity(item, "researched", "Preview profile researched", researchedAt),
      email: item.email || `${(item.name || "prospect").toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@example.com`,
      subject: item.subject || `A quick Vela introduction for ${item.name || "you"}`,
      body: item.body || `Hi ${(item.name || "there").split(" ")[0]},\n\nI came across your work and would love to learn from your perspective.\n\nBest,\n${state.settings.senderName}`,
      workNote: item.workNote || item.background || `your work in ${item.headline || "energy infrastructure"}`,
      targetFit: item.targetFit || { verdict: "strong", score: 88, reason: "Direct responsibility for energy-intensive infrastructure operations.", evidence: [item.headline || "Infrastructure leadership"], checkedAt: researchedAt, model: "preview" },
      status: QUEUE_STATUS.READY,
      error: "",
      researchedAt,
    } : item);
    await persistQueue();
    renderQueue();
    showToast("Preview people verified and drafted.");
    return;
  }

  const candidates = scopedQueue().filter((item) => ids ? ids.includes(item.id) : [QUEUE_STATUS.NEW, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status) && item.targetFit?.verdict === "strong");
  if (!candidates.length) { showToast("No strong, undrafted fits are waiting in this view."); return; }
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
    showToast("Target checks and drafts are ready for approval.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not research the queue.");
  } finally {
    setBusy(false);
    renderQueue();
  }
}

const VIEW_COPY = {
  overview: { eyebrow: "Overview", title: "Overview", description: "What needs a decision, what is scheduled, and what already went out.", queueTitle: "People", queueDescription: "People in the active workflow." },
  research: { eyebrow: "AI people research", title: "Research", description: "Tell Vela who you need, refine the audience together, and run the research when the plan is right.", queueTitle: "Research", queueDescription: "Conversational people research." },
  review: { eyebrow: "Research approval", title: "Approvals", description: "Review the current AI research batch, then approve and run personalized outreach.", queueTitle: "Research approvals", queueDescription: "Qualified people and drafts prepared by the Research agent." },
  analytics: { eyebrow: "Analytics", title: "Analytics", description: "See exactly who sent what, who replied, and how every mailbox is performing.", queueTitle: "Analytics", queueDescription: "Shared outreach performance." },
  scheduled: { eyebrow: "Scheduled sends", title: "Scheduled sends", description: "Queued Gmail sends in delivery order. Cancel any of them until delivery starts.", queueTitle: "Scheduled sends", queueDescription: "Queued Gmail delivery." },
  history: { eyebrow: "Sent history", title: "Sent history", description: "Every shared team and local delivery with its recipient, subject, sender, and result.", queueTitle: "Delivery history", queueDescription: "Unified delivery activity." },
  contacts: { eyebrow: "Team records", title: "Contacts", description: "Search, review, and manage every person your team has worked with.", queueTitle: "Contacts", queueDescription: "Team contacts." },
};

function setView(view, { preserveFilters = false, persist = true } = {}) {
  setCampaignMenu(false);
  state.view = view;
  state.activeCampaignId = "";
  if (!preserveFilters) state.attentionOnly = false;
  state.selected.clear();
  elements.statusFilterButton.classList.toggle("is-active", state.attentionOnly);
  for (const button of document.querySelectorAll("[data-view]")) button.classList.toggle("is-active", button.dataset.view === view);
  const copy = VIEW_COPY[view] || VIEW_COPY.overview;
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
  const sourceValues = (email) => {
    const value = details.emailSources?.[email] || (email === prospect.email ? prospect.emailSource : "");
    return Array.isArray(value) ? value : [value];
  };
  return [...new Set([prospect.email, ...(details.emails || []), ...work, ...personal].filter(isEmail))].map((email) => ({
    email,
    type: work.has(email) ? "work" : personal.has(email) ? "personal" : "email",
    status: details.emailStatuses?.[email] || (email === prospect.email ? details.emailStatus : ""),
    source: sourceValues(email)
      .map((value) => String(value || "").match(/Apollo|ContactOut|LinkedIn/i)?.[0] || String(value || "").trim())
      .filter(Boolean)
      .join(" + "),
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
    const detail = [candidate.email === prospect.email ? "Currently selected" : "Select for this draft", candidate.status, candidate.source ? `Source: ${candidate.source}` : ""].filter(Boolean).join(" · ");
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
  const fit = fitLabel(prospect.targetFit);
  elements.drawerFitBadge.textContent = fit.label;
  elements.drawerFitBadge.className = `fit-pill ${fit.className}`;
  elements.drawerFitReason.textContent = prospect.targetFit?.reason || "Run verification to score this person against Vela’s target context.";
  const evidence = document.createDocumentFragment();
  for (const item of prospect.targetFit?.evidence || []) appendText(evidence, "span", item);
  elements.drawerFitEvidence.replaceChildren(evidence);
  elements.drawerWorkNote.value = prospect.workNote || prospect.background || "";
  elements.drawerEmail.value = prospect.email || "";
  renderEmailChoices(prospect);
  renderExperience(prospect);
  renderDrawerActivity(prospect);
  elements.drawerSubject.value = prospect.subject || "";
  elements.drawerBody.value = prospect.body || "";
  elements.approveDraftButton.disabled = false;
  elements.approveDraftButton.hidden = prospect.status === QUEUE_STATUS.SENT;
  elements.approveDraftButton.textContent = prospect.status === QUEUE_STATUS.DRAFTED ? "Save approved draft" : "Approve draft";
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

async function approveProspects(ids = []) {
  const selected = new Set(ids);
  const approvedAt = new Date().toISOString();
  let approved = 0;
  state.queue = state.queue.map((item) => {
    if (!selected.has(item.id) || item.status !== QUEUE_STATUS.READY || !isEmail(item.email) || !item.subject || !item.body) return item;
    approved += 1;
    return { ...withActivity(item, "approved", "Draft approved for Gmail delivery", approvedAt), status: QUEUE_STATUS.DRAFTED, reviewedAt: approvedAt };
  });
  if (!approved) { showToast("No complete drafts in this selection are ready to approve."); return 0; }
  await persistQueue();
  renderQueue();
  showToast(`${approved} draft${approved === 1 ? "" : "s"} approved.`);
  return approved;
}

function approvedForSend(ids = []) {
  const requested = new Set(ids);
  return state.queue.filter((item) => requested.has(item.id) && item.status === QUEUE_STATUS.DRAFTED && isEmail(item.email) && item.subject && item.body);
}

function openBulkSend(ids = []) {
  const eligible = approvedForSend(ids);
  if (!eligible.length) { showToast("Approve at least one complete draft before sending."); return; }
  state.pendingSendIds = eligible.map((item) => item.id);
  elements.sendDialogCount.textContent = eligible.length;
  elements.sendDialogDescription.textContent = `${eligible.length} approved, personalized message${eligible.length === 1 ? "" : "s"} will send through the selected Gmail account.`;
  elements.sendDialog.showModal();
}

async function sendApproved(ids = []) {
  const eligible = approvedForSend(ids);
  if (!eligible.length) return;
  if (!isExtension) {
    const sentAt = new Date().toISOString();
    const sentIds = new Set(eligible.map((item) => item.id));
    state.queue = state.queue.map((item) => sentIds.has(item.id) ? { ...withActivity(item, "sent", "Preview Gmail delivery", sentAt), status: QUEUE_STATUS.SENT, emailSentAt: sentAt } : item);
    await persistQueue();
    renderQueue();
    showToast(`${eligible.length} preview message${eligible.length === 1 ? "" : "s"} sent.`);
    return;
  }
  const saved = await storage.get([GOOGLE_ACCOUNTS_STORAGE_KEY, GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY, GOOGLE_ACCOUNT_STORAGE_KEY]);
  const account = selectedGoogleAccount(saved[GOOGLE_ACCOUNTS_STORAGE_KEY], saved[GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY], saved[GOOGLE_ACCOUNT_STORAGE_KEY]);
  if (!account) throw new Error("Connect and choose a Gmail sender in Settings before sending.");
  let sent = 0;
  const failures = [];
  setBusy(true, `Sending 0 of ${eligible.length}`);
  for (const [index, person] of eligible.entries()) {
    elements.progressText.textContent = `Sending ${index + 1} of ${eligible.length}`;
    const response = await chrome.runtime.sendMessage({
      type: "VELA_GTM_EMAIL_SEND",
      delivery: { accountId: account.id, senderEmail: account.email, recipients: [person.email], subject: person.subject, body: person.body, prospectId: person.id },
    });
    if (response?.ok && response.data?.sent?.length) sent += 1;
    else failures.push(`${person.name || person.email}: ${response?.error || "send failed"}`);
  }
  setBusy(false);
  state.selected.clear();
  renderQueue();
  showToast(failures.length ? `${sent} sent · ${failures.length} need attention` : `${sent} message${sent === 1 ? "" : "s"} sent through ${account.email}.`);
}

function bindEvents() {
  elements.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = elements.searchBrief.value.trim();
    if (!message) { showToast("Write a message first."); return; }
    appendResearchMessage("user", message);
    try {
      setResearchComposerBusy(true);
      const turn = await researchAgentTurn(message);
      elements.searchBrief.value = "";
      if (turn?.mode === "plan" && turn.plan) appendResearchPlan(message, turn.plan, turn.reply);
      else if (turn?.mode === "execute" && state.pendingResearchPlan) {
        const pending = state.pendingResearchPlan;
        await executeResearchPlan(pending.plan, pending.brief);
      } else appendResearchMessage("assistant", turn?.reply || "How can I help?");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Vela could not respond right now.";
      appendResearchMessage("assistant", "I couldn’t finish that response.", detail);
      showToast(detail);
    } finally {
      setResearchComposerBusy(false);
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
  for (const button of elements.analyticsRange.querySelectorAll("[data-days]")) button.addEventListener("click", () => {
    state.analyticsDays = Number(button.dataset.days) || 7;
    renderAnalytics();
    persistWorkspaceStateSoon();
  });
  elements.historySearch.addEventListener("input", () => {
    state.historyQuery = elements.historySearch.value;
    state.historyPage = 1;
    renderDeliveryOperations();
  });
  elements.historySenderFilter.addEventListener("change", () => {
    state.historySender = elements.historySenderFilter.value;
    state.historyPage = 1;
    renderDeliveryOperations();
  });
  elements.settingsButton.addEventListener("click", openAdvancedSettings);
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
    setView("overview");
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
  const openImport = () => { resetImportDialog(); elements.importDialog.showModal(); };
  elements.openImportButton.addEventListener("click", openImport);
  elements.openImportButtonTop.addEventListener("click", openImport);
  elements.contactsImportButton.addEventListener("click", openImport);
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
    const historical = historicalDeliveryRecords(result.prospects);
    if (isExtension && historical.length) {
      const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_TEAM_ACTIVITY_IMPORT", records: historical });
      if (!response?.ok) showToast(response?.error || "Prospects imported, but sent history could not be added.");
      else if (response.data?.teamSync?.status === "error" || response.data?.teamSync?.status === "local-only") showToast(response.data.teamSync.error);
      await refreshSharedActivity({ quiet: true });
    }
    elements.importDialog.close();
  });
  elements.processButton.addEventListener("click", () => processQueue());
  elements.sendAllButton.addEventListener("click", () => openBulkSend(visibleProspects().map((item) => item.id)));
  elements.tableSearch.addEventListener("input", () => {
    state.query = elements.tableSearch.value.trim();
    renderQueue();
    persistWorkspaceStateSoon();
  });
  elements.contactsSearch.addEventListener("input", () => {
    state.contactQuery = elements.contactsSearch.value.trim();
    state.contactPage = 1;
    renderContacts();
    persistWorkspaceStateSoon();
  });
  elements.contactsStatusFilter.addEventListener("change", () => {
    state.contactStatus = elements.contactsStatusFilter.value || "all";
    state.contactPage = 1;
    renderContacts();
    persistWorkspaceStateSoon();
  });
  elements.contactsInboxSyncButton.addEventListener("click", () => syncInboxBounces({ interactive: true }));
  for (const button of document.querySelectorAll("[data-contact-filter]")) button.addEventListener("click", () => {
    state.contactStatus = button.dataset.contactFilter || "all";
    state.contactPage = 1;
    elements.contactsStatusFilter.value = state.contactStatus;
    renderContacts();
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
  elements.bulkApproveButton.addEventListener("click", () => approveProspects([...state.selected]));
  elements.bulkSendButton.addEventListener("click", () => openBulkSend([...state.selected]));
  elements.confirmBulkSendButton.addEventListener("click", async () => {
    const ids = [...state.pendingSendIds];
    elements.sendDialog.close();
    elements.confirmBulkSendButton.disabled = true;
    try { await sendApproved(ids); }
    catch (error) { showToast(error instanceof Error ? error.message : "Bulk send failed."); }
    finally { elements.confirmBulkSendButton.disabled = false; state.pendingSendIds = []; setBusy(false); }
  });
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
    if (!isSent && isExtension && isEmail(prospect.email)) {
      const response = await chrome.runtime.sendMessage({
        type: "VELA_GTM_TEAM_ACTIVITY_IMPORT",
        records: [{ id: `manual-${id}-${at}`, status: "sent", mode: "manual", recipients: [prospect.email], subject: prospect.subject || "", completedAt: at, updatedAt: at, prospectId: id }],
      });
      if (!response?.ok || ["error", "local-only"].includes(response.data?.teamSync?.status)) showToast(response?.error || response.data?.teamSync?.error || "Marked sent locally; Vela team sync needs attention.");
      await refreshSharedActivity({ quiet: true });
    }
    renderQueue();
    closeReviewDrawer();
    showToast(isSent ? "Email returned to the review workflow." : "Email marked sent and added to team activity.");
  });
  elements.approveDraftButton.addEventListener("click", async () => {
    if (await saveReview()) {
      await approveProspects([state.activeProspectId]);
      closeReviewDrawer();
      showToast("Draft approved and ready to send.");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.activeProspectId) closeReviewDrawer();
    if (event.key === "Escape") { setCampaignMenu(false); closeProspectMenu(); }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && state.activeProspectId) {
      event.preventDefault();
      elements.approveDraftButton.click();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e" && activeCampaign() && !elements.campaignDialog.open) { event.preventDefault(); openCampaignEditor(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); elements.tableSearch.focus(); }
    if (state.activeProspectId || event.target.closest("input, textarea, select, dialog")) return;
    const visible = visibleProspects();
    if (!visible.length) return;
    const currentIndex = Math.max(0, visible.findIndex((item) => item.id === state.keyboardProspectId));
    if (["ArrowDown", "j", "ArrowUp", "k"].includes(event.key)) {
      event.preventDefault();
      const direction = ["ArrowUp", "k"].includes(event.key) ? -1 : 1;
      const next = visible[(currentIndex + direction + visible.length) % visible.length];
      state.keyboardProspectId = next.id;
      renderQueue();
      document.querySelector(`[data-prospect-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter") {
      const person = visible.find((item) => item.id === state.keyboardProspectId) || visible[0];
      openReviewDrawer(person.id, document.querySelector(`[data-prospect-id="${CSS.escape(person.id)}"]`));
    }
    if (event.key.toLowerCase() === "a") {
      const person = visible.find((item) => item.id === state.keyboardProspectId) || visible[0];
      approveProspects([person.id]);
    }
    if (event.key.toLowerCase() === "d") processQueue(state.selected.size ? [...state.selected] : visible.map((item) => item.id));
    if (event.key.toLowerCase() === "s") openBulkSend(state.selected.size ? [...state.selected] : visible.map((item) => item.id));
  });
  document.addEventListener("click", (event) => {
    if (!elements.campaignActions.contains(event.target)) setCampaignMenu(false);
    if (!event.target.closest(".prospect-popover") && !event.target.closest(".row-menu")) closeProspectMenu();
  });
  document.addEventListener("scroll", closeProspectMenu, true);
}

async function initialize() {
  elements.authSignInButton.addEventListener("click", signInFromGate);
  if (!await workspaceAuthReady()) return;
  const stored = await storage.get([QUEUE_STORAGE_KEY, CAMPAIGNS_STORAGE_KEY, WORKSPACE_BACKUP_STORAGE_KEY, SCHEDULED_SENDS_STORAGE_KEY, DELIVERY_LOG_STORAGE_KEY, WORKSPACE_STATE_STORAGE_KEY, GOOGLE_ACCOUNTS_STORAGE_KEY, GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY, GOOGLE_ACCOUNT_STORAGE_KEY, "velaGtmSettings"]);
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
  state.googleAccounts = normalizeGoogleAccounts(saved[GOOGLE_ACCOUNTS_STORAGE_KEY] || [], saved[GOOGLE_ACCOUNT_STORAGE_KEY]);
  state.approvedSenders = [];
  state.selectedGoogleAccountId = saved[GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY] || state.googleAccounts[0]?.id || "";
  state.teamMembers = !isExtension ? DEMO_TEAM_MEMBERS : [];
  state.currentTeamUser = !isExtension ? { id: "preview-tarun", email: "tarun@velaenergy.ai", role: "admin" } : null;
  state.query = typeof savedWorkspace.query === "string" ? savedWorkspace.query : "";
  state.contactQuery = typeof savedWorkspace.contactQuery === "string" ? savedWorkspace.contactQuery : "";
  state.contactStatus = ["all", "bounced", "contacted", "replied", "scheduled", "imported", "ready", "researching"].includes(savedWorkspace.contactStatus) ? savedWorkspace.contactStatus : "all";
  state.attentionOnly = savedWorkspace.attentionOnly === true;
  state.analyticsDays = [7, 30, 90].includes(Number(savedWorkspace.analyticsDays)) ? Number(savedWorkspace.analyticsDays) : 7;
  state.analyticsMember = typeof savedWorkspace.analyticsMember === "string" ? savedWorkspace.analyticsMember : "all";
  state.searchPlan = savedWorkspace.searchPlan && Array.isArray(savedWorkspace.searchPlan.searches) ? savedWorkspace.searchPlan : null;
  elements.tableSearch.value = state.query;
  elements.contactsSearch.value = state.contactQuery;
  elements.contactsStatusFilter.value = state.contactStatus;
  bindEvents();
  const hasRequestedCampaign = requestedCampaignId && state.campaigns.some((campaign) => campaign.id === requestedCampaignId);
  const hasSavedCampaign = savedWorkspace.campaignId && state.campaigns.some((campaign) => campaign.id === savedWorkspace.campaignId);
  if (hasRequestedCampaign) setCampaignView(requestedCampaignId, { preserveFilters: true, persist: false });
  else if (VIEW_COPY[requestedView]) setView(requestedView, { preserveFilters: true, persist: false });
  else if (hasSavedCampaign) setCampaignView(savedWorkspace.campaignId, { preserveFilters: true, persist: false });
  else setView(VIEW_COPY[savedWorkspace.view] ? savedWorkspace.view : "overview", { preserveFilters: true, persist: false });
  if (isExtension) Promise.all([refreshSharedActivity({ quiet: true }), refreshTeamProspects({ quiet: true }), refreshResearchRuns({ quiet: true }), refreshTeamGmailAccounts()]).then(() => syncInboxBounces({ quiet: true })).catch(() => {});
  if (isExtension) state.teamSyncTimer = setInterval(refreshTeamWorkspace, 12_000);
  if (isExtension && chrome.storage?.onChanged) chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[QUEUE_STORAGE_KEY]) state.queue = changes[QUEUE_STORAGE_KEY].newValue || [];
    if (changes[CAMPAIGNS_STORAGE_KEY]) state.campaigns = normalizeCampaigns(changes[CAMPAIGNS_STORAGE_KEY].newValue || []);
    if (changes[SCHEDULED_SENDS_STORAGE_KEY]) state.scheduledJobs = normalizeScheduledSends(changes[SCHEDULED_SENDS_STORAGE_KEY].newValue || []);
    if (changes[DELIVERY_LOG_STORAGE_KEY]) state.deliveryLog = normalizeDeliveryLog(changes[DELIVERY_LOG_STORAGE_KEY].newValue || []);
    if (changes[GOOGLE_ACCOUNTS_STORAGE_KEY] || changes[GOOGLE_ACCOUNT_STORAGE_KEY]) {
      const accounts = changes[GOOGLE_ACCOUNTS_STORAGE_KEY]?.newValue ?? state.googleAccounts;
      const legacy = changes[GOOGLE_ACCOUNT_STORAGE_KEY]?.newValue;
      state.googleAccounts = normalizeGoogleAccounts(accounts, legacy);
    }
    if (changes[GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY]) state.selectedGoogleAccountId = changes[GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY].newValue || "";
    if (changes.velaGtmSettings) {
      state.settings = { ...DEFAULT_SETTINGS, ...(changes.velaGtmSettings.newValue || {}) };
      applyTheme(state.settings.theme);
      if (state.searchPlan) renderSearchPlan(state.searchPlan);
    }
    if (state.activeCampaignId && !state.campaigns.some((campaign) => campaign.id === state.activeCampaignId)) setView("overview");
    else if (changes[QUEUE_STORAGE_KEY] || changes[CAMPAIGNS_STORAGE_KEY] || changes[SCHEDULED_SENDS_STORAGE_KEY] || changes[DELIVERY_LOG_STORAGE_KEY] || changes[GOOGLE_ACCOUNTS_STORAGE_KEY] || changes[GOOGLE_ACCOUNT_STORAGE_KEY] || changes[GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY]) renderQueue();
  });
}

applyTheme();
globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.settings.theme === "system") applyTheme("system");
});
initialize().catch((error) => {
  console.error("Could not initialize Vela GTM dashboard.", error);
  elements.toast.title = error instanceof Error ? error.stack || "" : "";
  showToast(error instanceof Error ? error.message : "Could not open the queue.");
});
