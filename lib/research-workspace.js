const MINUTE = 60_000;
export const RESEARCH_AUTOMATION_DUE_STORAGE_KEY = "velaGtmResearchAutomationDue";
export const RESEARCH_AUTOMATION_ALARM_PREFIX = "vela-gtm-research:";
export const RESEARCH_THREADS_STORAGE_KEY = "velaGtmResearchThreads";
export const RESEARCH_MESSAGES_STORAGE_KEY = "velaGtmResearchMessages";
export const RESEARCH_RUNS_STORAGE_KEY = "velaGtmResearchRuns";
export const RESEARCH_AUTOMATIONS_STORAGE_KEY = "velaGtmResearchAutomations";
export const DEFAULT_RESEARCH_PROMPTS = Object.freeze([
  { label: "Data center operators", prompt: "Find VP and director-level data center operators in the United States focused on power and critical infrastructure" },
  { label: "Energy buyers", prompt: "Find energy procurement and utility strategy leaders at large industrial loads in the United States" },
  { label: "Site selection", prompt: "Find site selection leaders at AI infrastructure and colocation companies in the United States" },
]);

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function researchThreadTitle(message = "") {
  const title = clean(message).replace(/^(?:please\s+)?(?:find|research|source|identify|discover)\s+/i, "");
  return (title || "New research chat").slice(0, 72);
}

export function isNextResearchBatchRequest(message = "") {
  const request = clean(message).toLowerCase();
  return /\b(?:next|another)\s+(?:100|hundred|batch|page)\b/.test(request)
    || /\b(?:research|pull|load|find|get)\s+(?:the\s+)?next\s+(?:100|hundred|batch|page)\b/.test(request);
}

export function researchBatchPagination(run = {}) {
  if (!run || typeof run !== "object") run = {};
  const page = Math.max(1, Number(run.page) || 1);
  const perPage = Math.min(300, Math.max(1, Number(run.requestedCount || run.requested_count) || 300));
  const total = Math.max(0, Number(run.totalFound || run.total_found) || 0);
  const pulled = Math.max(0, Number(run.foundCount || run.found_count) || 0);
  return {
    page,
    perPage,
    total,
    pulled,
    nextPage: page + 1,
    hasNext: pulled > 0 && page * perPage < total,
  };
}

export function normalizeResearchThread(thread = {}) {
  return {
    id: String(thread.id || ""),
    title: clean(thread.title) || "New research chat",
    context: thread.context && typeof thread.context === "object" ? thread.context : {},
    createdAt: thread.createdAt || thread.created_at || new Date().toISOString(),
    updatedAt: thread.updatedAt || thread.updated_at || thread.createdAt || thread.created_at || new Date().toISOString(),
  };
}

export function normalizeLocalResearchMessages(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([threadId, messages]) => {
    if (!threadId || !Array.isArray(messages)) return [];
    return [[threadId, messages.map(normalizeResearchMessage).filter((message) => message.content).slice(-200)]];
  }));
}

export function normalizeResearchMessage(message = {}) {
  return {
    id: String(message.id || ""),
    threadId: String(message.threadId || message.thread_id || ""),
    role: ["user", "assistant", "system"].includes(message.role) ? message.role : "assistant",
    content: String(message.content || "").trim(),
    detail: String(message.detail || "").trim(),
    plan: message.plan && typeof message.plan === "object" ? message.plan : null,
    createdAt: message.createdAt || message.created_at || new Date().toISOString(),
  };
}

export function normalizeResearchAutomation(value = {}) {
  const cadenceMinutes = Math.min(10_080, Math.max(15, Number(value.cadenceMinutes || value.cadence_minutes) || 1_440));
  return {
    id: String(value.id || ""),
    name: clean(value.name) || "Research automation",
    threadId: String(value.threadId || value.thread_id || ""),
    prompt: String(value.prompt || "").trim(),
    plan: value.plan && typeof value.plan === "object" ? value.plan : {},
    cadenceMinutes,
    mode: value.mode === "yolo" ? "yolo" : "review",
    contactOutDefault: value.contactOutDefault ?? value.contactout_default ?? true,
    maxResults: Math.min(300, Math.max(1, Number(value.maxResults || value.max_results) || 300)),
    dailySendCap: Math.min(500, Math.max(1, Number(value.dailySendCap || value.daily_send_cap) || 25)),
    senderEmail: clean(value.senderEmail || value.sender_email).toLowerCase(),
    templateId: String(value.templateId || value.template_id || ""),
    isActive: Boolean(value.isActive ?? value.is_active),
    nextRunAt: value.nextRunAt || value.next_run_at || "",
    lastRunAt: value.lastRunAt || value.last_run_at || "",
    createdAt: value.createdAt || value.created_at || "",
    updatedAt: value.updatedAt || value.updated_at || "",
  };
}

export function nextAutomationRun(cadenceMinutes = 1_440, now = new Date()) {
  const cadence = Math.min(10_080, Math.max(15, Number(cadenceMinutes) || 1_440));
  return new Date(now.getTime() + cadence * MINUTE).toISOString();
}

export function researchAutomationAlarmName(id = "") {
  return `${RESEARCH_AUTOMATION_ALARM_PREFIX}${String(id || "")}`;
}

export function researchAutomationIdFromAlarm(name = "") {
  return String(name).startsWith(RESEARCH_AUTOMATION_ALARM_PREFIX) ? String(name).slice(RESEARCH_AUTOMATION_ALARM_PREFIX.length) : "";
}

export function researchRunMetrics(run = {}, now = new Date()) {
  const started = Date.parse(run.startedAt || run.started_at || run.createdAt || run.created_at || "");
  const completed = Date.parse(run.completedAt || run.completed_at || "");
  const durationMs = Number(run.durationMs || run.duration_ms) || (Number.isFinite(started) ? Math.max(0, (Number.isFinite(completed) ? completed : now.getTime()) - started) : 0);
  const pulled = Math.max(0, Number(run.foundCount || run.found_count) || 0);
  const audited = Math.max(0, Number(run.auditedCount || run.audited_count) || 0);
  const ready = Math.max(0, Number(run.readyCount || run.ready_count) || 0);
  const enriched = Math.max(0, Number(run.enrichedCount || run.enriched_count) || 0);
  return {
    durationMs,
    qualificationRate: pulled ? audited / pulled : 0,
    readyRate: pulled ? ready / pulled : 0,
    enrichmentRate: pulled ? enriched / pulled : 0,
    secondsPerProspect: pulled ? durationMs / 1_000 / pulled : 0,
  };
}

export function formatRunDuration(milliseconds = 0) {
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function researchFunnel(run = {}) {
  return [
    { key: "matched", label: "Matched", value: Math.max(0, Number(run.totalFound || run.total_found) || 0) },
    { key: "pulled", label: "Pulled", value: Math.max(0, Number(run.foundCount || run.found_count) || 0) },
    { key: "audited", label: "Fit checked", value: Math.max(0, Number(run.auditedCount || run.audited_count) || 0) },
    { key: "ready", label: "Ready", value: Math.max(0, Number(run.readyCount || run.ready_count) || 0) },
  ];
}

export function researchApprovalStack(prospects = []) {
  const items = (Array.isArray(prospects) ? prospects : [])
    .filter((prospect) => prospect?.researchRunId && ["ready", "drafted"].includes(prospect.status));
  return {
    total: items.length,
    ready: items.filter((prospect) => prospect.status === "ready").length,
    approved: items.filter((prospect) => prospect.status === "drafted").length,
    runs: new Set(items.map((prospect) => prospect.researchRunId)).size,
  };
}
