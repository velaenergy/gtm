export const SUPABASE_URL = "https://qkqtsrfbdrvcstwtcanx.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1FMwd_dMOtIOX4_8B3rz9A_8bPsVyqy";
export const SUPABASE_SESSION_STORAGE_KEY = "velaGtmSupabaseSession";

const VELA_EMAIL = /@velaenergy\.ai$/i;

export class SupabaseApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.name = "SupabaseApiError";
    this.status = status;
    this.code = code;
  }
}

export function isVelaEmail(email = "") {
  return VELA_EMAIL.test(String(email || "").trim());
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function supabaseFetch(path, { accessToken = "", method = "GET", body, headers = {}, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Supabase requests are unavailable.");
  const response = await fetchImpl(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_PUBLISHABLE_KEY}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new SupabaseApiError(
      payload?.msg || payload?.message || payload?.error_description || payload?.error || `Supabase returned ${response.status}.`,
      response.status,
      payload?.code || payload?.error_code || "",
    );
  }
  return payload;
}

function normalizeSession(payload = {}) {
  const accessToken = String(payload.access_token || "");
  const refreshToken = String(payload.refresh_token || "");
  const user = payload.user || {};
  if (!accessToken || !refreshToken || !user.id || !isVelaEmail(user.email)) return null;
  const expiresAt = Number(payload.expires_at) || Math.floor(Date.now() / 1000) + (Number(payload.expires_in) || 3600);
  return { accessToken, refreshToken, expiresAt, user: { id: user.id, email: String(user.email).toLowerCase(), userMetadata: user.user_metadata || {} } };
}

async function readStored(storage, key) {
  const result = await storage.get(key);
  return result?.[key] || null;
}

export async function signInWithGoogleTokens({ idToken = "", accessToken = "", nonce = "", storage, fetchImpl = globalThis.fetch } = {}) {
  if (!idToken) throw new Error("Google did not return the identity token required for Vela sign-in.");
  if (!nonce) throw new Error("Google did not return the nonce required for secure Vela sign-in.");
  const payload = await supabaseFetch("/auth/v1/token?grant_type=id_token", {
    method: "POST",
    body: { provider: "google", id_token: idToken, access_token: accessToken || undefined, nonce },
    fetchImpl,
  });
  const session = normalizeSession(payload);
  if (!session) throw new Error("Sign in with a Vela Energy Google account.");
  if (storage) await storage.set({ [SUPABASE_SESSION_STORAGE_KEY]: session });
  return session;
}

export async function activeSupabaseSession({ storage, fetchImpl = globalThis.fetch } = {}) {
  if (!storage) return null;
  const saved = await readStored(storage, SUPABASE_SESSION_STORAGE_KEY);
  if (!saved?.accessToken || !saved?.refreshToken || !isVelaEmail(saved.user?.email)) return null;
  if (Number(saved.expiresAt) > Math.floor(Date.now() / 1000) + 90) return saved;
  try {
    const payload = await supabaseFetch("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: saved.refreshToken },
      fetchImpl,
    });
    const refreshed = normalizeSession(payload);
    if (!refreshed) throw new Error("Vela session refresh failed.");
    await storage.set({ [SUPABASE_SESSION_STORAGE_KEY]: refreshed });
    return refreshed;
  } catch (error) {
    await storage.remove(SUPABASE_SESSION_STORAGE_KEY);
    throw error;
  }
}

export async function signOutSupabase({ storage, fetchImpl = globalThis.fetch } = {}) {
  const session = storage ? await readStored(storage, SUPABASE_SESSION_STORAGE_KEY) : null;
  if (session?.accessToken) {
    await supabaseFetch("/auth/v1/logout", { method: "POST", accessToken: session.accessToken, fetchImpl }).catch(() => {});
  }
  if (storage) await storage.remove(SUPABASE_SESSION_STORAGE_KEY);
}

async function authenticated(path, options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account first.");
  const data = await supabaseFetch(path, { ...options, accessToken: session.accessToken });
  return { data, session };
}

export async function sharedGmailAccounts(options = {}) {
  const { data } = await authenticated("/rest/v1/gmail_accounts?select=id,email,display_name,last_connected_at,is_active&is_active=eq.true&order=email.asc", options);
  return Array.isArray(data) ? data : [];
}

export async function sharedApprovedSenders(options = {}) {
  const { data } = await authenticated("/rest/v1/approved_senders?select=email,display_name,is_active,created_at&is_active=eq.true&order=email.asc", options);
  return Array.isArray(data) ? data : [];
}

export async function requireApprovedSender(email = "", options = {}) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("Choose an approved sender in Settings.");
  const { data } = await authenticated(`/rest/v1/approved_senders?select=email&email=eq.${encodeURIComponent(normalized)}&is_active=eq.true&limit=1`, options);
  if (!Array.isArray(data) || !data.length) throw new Error(`${normalized} is not enabled for sending. Add it in Settings first.`);
  return normalized;
}

export async function approveSender(email = "", displayName = "", options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before adding a Gmail sender.");
  const normalized = String(email || "").trim().toLowerCase();
  if (!isVelaEmail(normalized)) throw new Error("Gmail senders must use an @velaenergy.ai account.");
  const { data } = await authenticated("/rest/v1/approved_senders?on_conflict=email", {
    ...options,
    method: "POST",
    body: [{
      email: normalized,
      display_name: String(displayName || "").trim(),
      is_active: true,
      created_by: session.user.id,
      updated_at: new Date().toISOString(),
    }],
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });
  return Array.isArray(data) ? data[0] : data;
}

export async function sharedTeamProfiles(options = {}) {
  const { data } = await authenticated("/rest/v1/team_profiles?select=id,email,full_name,avatar_url,role,is_active,created_at,removed_at&order=created_at.asc", options);
  return Array.isArray(data) ? data : [];
}

export async function currentTeamMembership(options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) return null;
  const { data } = await authenticated(`/rest/v1/team_profiles?select=id,email,full_name,avatar_url,role,is_active,created_at,removed_at&id=eq.${encodeURIComponent(session.user.id)}&limit=1`, options);
  return Array.isArray(data) ? data[0] || null : null;
}

export async function setTeamMemberActive(targetUserId = "", isActive = false, options = {}) {
  const id = String(targetUserId || "").trim();
  if (!id) throw new Error("Choose a workspace member first.");
  const { data } = await authenticated("/rest/v1/rpc/set_team_member_active", {
    ...options,
    method: "POST",
    body: { target_user_id: id, target_active: Boolean(isActive) },
  });
  return data;
}

function researchRunFromRow(row = {}) {
  return {
    id: String(row.id || ""),
    brief: String(row.brief || ""),
    status: String(row.status || "planning"),
    requestedCount: Number(row.requested_count) || 300,
    totalFound: Number(row.total_found) || 0,
    foundCount: Number(row.found_count) || 0,
    auditedCount: Number(row.audited_count) || 0,
    strongCount: Number(row.strong_count) || 0,
    reviewCount: Number(row.review_count) || 0,
    skipCount: Number(row.skip_count) || 0,
    readyCount: Number(row.ready_count) || 0,
    needsAttentionCount: Number(row.needs_attention_count) || 0,
    enrichedCount: Number(row.enriched_count) || 0,
    contactOutChecks: Number(row.contactout_checks) || 0,
    durationMs: Number(row.duration_ms) || 0,
    threadId: row.thread_id || "",
    plan: row.plan && typeof row.plan === "object" ? row.plan : {},
    page: Number(row.page) || 1,
    sourceProvider: row.source_provider || "apollo",
    startedAt: row.started_at || "",
    metrics: row.metrics && typeof row.metrics === "object" ? row.metrics : {},
    createdBy: row.created_by || "",
    operatorName: row.team_profiles?.full_name || row.team_profiles?.email || "Vela teammate",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    completedAt: row.completed_at || "",
    error: row.error || "",
  };
}

const RESEARCH_RUN_SELECT = "id,brief,status,requested_count,total_found,found_count,audited_count,strong_count,review_count,skip_count,created_by,created_at,updated_at,completed_at,error,team_profiles!research_runs_created_by_fkey(full_name,email)";
const RESEARCH_WORKSPACE_RUN_SELECT = RESEARCH_RUN_SELECT.replace("created_by,", "ready_count,needs_attention_count,enriched_count,contactout_checks,duration_ms,thread_id,plan,page,source_provider,started_at,metrics,created_by,");
const LEGACY_RESEARCH_RUN_SELECT = RESEARCH_RUN_SELECT.replace("total_found,", "");

function missingResearchTotalColumn(error) {
  return error instanceof SupabaseApiError
    && (error.code === "PGRST204" || /(?:column|field).*(?:total_found)|total_found.*(?:column|field)/i.test(error.message));
}

export async function sharedResearchRuns(options = {}) {
  let data;
  try {
    ({ data } = await authenticated(`/rest/v1/research_runs?select=${RESEARCH_WORKSPACE_RUN_SELECT}&order=updated_at.desc&limit=50`, options));
  } catch (error) {
    if (!(error instanceof SupabaseApiError) || (error.code !== "PGRST204" && !/(?:column|field)/i.test(error.message))) throw error;
    try {
      ({ data } = await authenticated(`/rest/v1/research_runs?select=${RESEARCH_RUN_SELECT}&order=updated_at.desc&limit=50`, options));
    } catch (legacyError) {
      if (!missingResearchTotalColumn(legacyError)) throw legacyError;
      ({ data } = await authenticated(`/rest/v1/research_runs?select=${LEGACY_RESEARCH_RUN_SELECT}&order=updated_at.desc&limit=50`, options));
    }
  }
  return (Array.isArray(data) ? data : []).map(researchRunFromRow);
}

export async function syncResearchRun(run = {}, options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before running research.");
  const now = new Date().toISOString();
  const row = {
    id: String(run.id || ""),
    brief: String(run.brief || "").trim(),
    status: ["planning", "searching", "auditing", "complete", "error"].includes(run.status) ? run.status : "planning",
    requested_count: Math.min(300, Math.max(1, Number(run.requestedCount) || 300)),
    total_found: Math.max(0, Number(run.totalFound) || 0),
    found_count: Math.max(0, Number(run.foundCount) || 0),
    audited_count: Math.max(0, Number(run.auditedCount) || 0),
    strong_count: Math.max(0, Number(run.strongCount) || 0),
    review_count: Math.max(0, Number(run.reviewCount) || 0),
    skip_count: Math.max(0, Number(run.skipCount) || 0),
    ready_count: Math.max(0, Number(run.readyCount) || 0),
    needs_attention_count: Math.max(0, Number(run.needsAttentionCount) || 0),
    enriched_count: Math.max(0, Number(run.enrichedCount) || 0),
    contactout_checks: Math.max(0, Number(run.contactOutChecks) || 0),
    duration_ms: Math.max(0, Number(run.durationMs) || 0),
    thread_id: run.threadId || null,
    plan: run.plan && typeof run.plan === "object" ? run.plan : {},
    page: Math.max(1, Number(run.page) || 1),
    source_provider: String(run.sourceProvider || "apollo"),
    started_at: run.startedAt || null,
    metrics: run.metrics && typeof run.metrics === "object" ? run.metrics : {},
    created_by: run.createdBy || session.user.id,
    updated_at: now,
    completed_at: run.status === "complete" ? (run.completedAt || now) : null,
    error: String(run.error || ""),
  };
  if (!row.id || !row.brief) throw new Error("A research run needs an ID and brief.");
  const write = (body) => authenticated("/rest/v1/research_runs?on_conflict=id", {
    ...options,
    method: "POST",
    body: [body],
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });
  try {
    const { data } = await write(row);
    return researchRunFromRow(Array.isArray(data) ? data[0] : data);
  } catch (error) {
    if (!(error instanceof SupabaseApiError) || (error.code !== "PGRST204" && !/(?:column|field)/i.test(error.message))) throw error;
    const legacyRow = { ...row };
    for (const key of ["ready_count", "needs_attention_count", "enriched_count", "contactout_checks", "duration_ms", "thread_id", "plan", "page", "source_provider", "started_at", "metrics"]) delete legacyRow[key];
    try {
      const { data } = await write(legacyRow);
      return { ...researchRunFromRow(Array.isArray(data) ? data[0] : data), ...researchRunFromRow(row) };
    } catch (legacyError) {
      if (!missingResearchTotalColumn(legacyError)) throw legacyError;
      delete legacyRow.total_found;
      const { data } = await write(legacyRow);
      return { ...researchRunFromRow(Array.isArray(data) ? data[0] : data), ...researchRunFromRow(row) };
    }
  }
}

function researchThreadFromRow(row = {}) {
  return { id: String(row.id || ""), title: String(row.title || "New research chat"), context: row.context || {}, createdBy: row.created_by || "", createdAt: row.created_at || "", updatedAt: row.updated_at || "", archivedAt: row.archived_at || "" };
}

function researchMessageFromRow(row = {}) {
  return { id: String(row.id || ""), threadId: String(row.thread_id || ""), role: row.role || "assistant", content: String(row.content || ""), detail: String(row.detail || ""), plan: row.plan || null, createdBy: row.created_by || "", createdAt: row.created_at || "" };
}

function researchAutomationFromRow(row = {}) {
  return { id: String(row.id || ""), name: String(row.name || "Research automation"), threadId: row.thread_id || "", prompt: String(row.prompt || ""), plan: row.plan || {}, cadenceMinutes: Number(row.cadence_minutes) || 1440, mode: row.mode === "yolo" ? "yolo" : "review", contactOutDefault: row.contactout_default !== false, maxResults: Number(row.max_results) || 100, dailySendCap: Number(row.daily_send_cap) || 25, senderEmail: String(row.sender_email || ""), templateId: row.template_id || "", isActive: Boolean(row.is_active), nextRunAt: row.next_run_at || "", lastRunAt: row.last_run_at || "", createdBy: row.created_by || "", createdAt: row.created_at || "", updatedAt: row.updated_at || "" };
}

export async function sharedResearchThreads(options = {}) {
  const { data } = await authenticated("/rest/v1/research_threads?select=id,title,context,created_by,created_at,updated_at,archived_at&archived_at=is.null&order=updated_at.desc&limit=50", options);
  return (Array.isArray(data) ? data : []).map(researchThreadFromRow);
}

export async function createResearchThread(thread = {}, options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before creating a research chat.");
  const body = { id: thread.id || undefined, title: String(thread.title || "New research chat").trim().slice(0, 120), context: thread.context && typeof thread.context === "object" ? thread.context : {}, created_by: session.user.id, updated_at: new Date().toISOString() };
  const { data } = await authenticated("/rest/v1/research_threads", { ...options, method: "POST", body: [body], headers: { Prefer: "return=representation" } });
  return researchThreadFromRow(Array.isArray(data) ? data[0] : data);
}

export async function sharedResearchMessages(threadId = "", options = {}) {
  if (!threadId) return [];
  const { data } = await authenticated(`/rest/v1/research_messages?select=id,thread_id,role,content,detail,plan,created_by,created_at&thread_id=eq.${encodeURIComponent(threadId)}&order=created_at.asc&limit=200`, options);
  return (Array.isArray(data) ? data : []).map(researchMessageFromRow);
}

export async function syncResearchMessage(message = {}, options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before saving research chat.");
  const body = { id: message.id || undefined, thread_id: String(message.threadId || ""), role: ["user", "assistant", "system"].includes(message.role) ? message.role : "assistant", content: String(message.content || "").trim(), detail: String(message.detail || "").trim(), plan: message.plan || null, created_by: session.user.id };
  if (!body.thread_id || !body.content) throw new Error("A saved research message needs a chat and content.");
  const { data } = await authenticated("/rest/v1/research_messages", { ...options, method: "POST", body: [body], headers: { Prefer: "return=representation" } });
  await authenticated(`/rest/v1/research_threads?id=eq.${encodeURIComponent(body.thread_id)}`, { ...options, method: "PATCH", body: { updated_at: new Date().toISOString() }, headers: { Prefer: "return=minimal" } });
  return researchMessageFromRow(Array.isArray(data) ? data[0] : data);
}

export async function clearResearchMessages(threadId = "", options = {}) {
  if (!threadId) return;
  await authenticated(`/rest/v1/research_messages?thread_id=eq.${encodeURIComponent(threadId)}`, { ...options, method: "DELETE", headers: { Prefer: "return=minimal" } });
}

export async function sharedResearchAutomations(options = {}) {
  const { data } = await authenticated("/rest/v1/research_automations?select=*&order=updated_at.desc&limit=50", options);
  return (Array.isArray(data) ? data : []).map(researchAutomationFromRow);
}

export async function sharedResearchLists(options = {}) {
  const { data } = await authenticated("/rest/v1/research_lists?select=id,name,description,created_by,created_at,updated_at,research_list_members(prospect_identity,added_at)&order=updated_at.desc&limit=100", options);
  return (Array.isArray(data) ? data : []).map((row) => ({ id: String(row.id || ""), name: String(row.name || ""), description: String(row.description || ""), prospectIds: (row.research_list_members || []).map((member) => String(member.prospect_identity || "")).filter(Boolean), createdAt: row.created_at || "", updatedAt: row.updated_at || "" }));
}

export async function syncResearchLists(lists = [], options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before saving research lists.");
  const input = Array.isArray(lists) ? lists : [];
  const rows = input.map((list) => ({ id: String(list.id || ""), name: String(list.name || "").trim(), description: String(list.description || "").trim(), created_by: session.user.id, updated_at: list.updatedAt || new Date().toISOString() })).filter((row) => row.id && row.name);
  const existing = await authenticated("/rest/v1/research_lists?select=id", options);
  if (rows.length) await authenticated("/rest/v1/research_lists?on_conflict=id", { ...options, method: "POST", body: rows, headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
  await deleteMissingRows("research_lists", (existing.data || []).map((row) => String(row.id)), new Set(rows.map((row) => row.id)), options);
  for (const list of input) {
    const listId = String(list.id || "");
    if (!listId) continue;
    await authenticated(`/rest/v1/research_list_members?list_id=eq.${encodeURIComponent(listId)}`, { ...options, method: "DELETE", headers: { Prefer: "return=minimal" } });
    const members = [...new Set((list.prospectIds || []).map(String).filter(Boolean))].map((prospectIdentity) => ({ list_id: listId, prospect_identity: prospectIdentity, added_by: session.user.id }));
    if (members.length) await authenticated("/rest/v1/research_list_members?on_conflict=list_id,prospect_identity", { ...options, method: "POST", body: members, headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
  }
  return sharedResearchLists(options);
}

export async function syncResearchAutomation(automation = {}, options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before saving automation.");
  const body = { id: automation.id || crypto.randomUUID(), name: String(automation.name || "Research automation").trim(), thread_id: automation.threadId || null, prompt: String(automation.prompt || "").trim(), plan: automation.plan || {}, cadence_minutes: Math.min(10080, Math.max(15, Number(automation.cadenceMinutes) || 1440)), mode: automation.mode === "yolo" ? "yolo" : "review", contactout_default: automation.contactOutDefault !== false, max_results: Math.min(300, Math.max(1, Number(automation.maxResults) || 300)), daily_send_cap: Math.min(500, Math.max(1, Number(automation.dailySendCap) || 25)), sender_email: automation.senderEmail || null, template_id: automation.templateId || null, is_active: Boolean(automation.isActive), next_run_at: automation.nextRunAt || null, last_run_at: automation.lastRunAt || null, created_by: automation.createdBy || session.user.id, updated_at: new Date().toISOString() };
  if (!body.prompt) throw new Error("Describe what this automation should research.");
  const { data } = await authenticated("/rest/v1/research_automations?on_conflict=id", { ...options, method: "POST", body: [body], headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
  return researchAutomationFromRow(Array.isArray(data) ? data[0] : data);
}

function emailTemplateFromRow(row = {}) {
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    subject: String(row.subject || ""),
    body: String(row.body || ""),
    senderName: String(row.sender_name || ""),
    senderEmail: String(row.sender_email || ""),
    calendarUrl: String(row.calendar_url || ""),
    writerMode: row.writer_mode === "full" ? "full" : "gaps",
    followUpCadenceDays: Number(row.follow_up_cadence_days) || 3,
    followUpTemplateIds: Array.isArray(row.follow_up_template_ids) ? row.follow_up_template_ids.map(String) : [],
  };
}

function followUpTemplateFromRow(row = {}) {
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    body: String(row.body || ""),
    writerMode: row.writer_mode === "full" ? "full" : "gaps",
  };
}

export async function sharedOutreachTemplates(options = {}) {
  const [emails, followUps] = await Promise.all([
    authenticated("/rest/v1/email_templates?select=id,name,subject,body,sender_name,sender_email,calendar_url,writer_mode,follow_up_cadence_days,follow_up_template_ids&order=name.asc", options),
    authenticated("/rest/v1/follow_up_templates?select=id,name,body,writer_mode&order=name.asc", options),
  ]);
  return {
    emailTemplates: (Array.isArray(emails.data) ? emails.data : []).map(emailTemplateFromRow),
    followUpTemplates: (Array.isArray(followUps.data) ? followUps.data : []).map(followUpTemplateFromRow),
  };
}

async function deleteMissingRows(table, existingIds, nextIds, options) {
  const missing = existingIds.filter((id) => !nextIds.has(id));
  if (!missing.length) return;
  const filter = encodeURIComponent(`(${missing.map((id) => `"${String(id).replaceAll('"', '')}"`).join(",")})`);
  await authenticated(`/rest/v1/${table}?id=in.${filter}`, {
    ...options,
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function syncOutreachTemplates({ emailTemplates = [], followUpTemplates = [] } = {}, options = {}) {
  const emails = (Array.isArray(emailTemplates) ? emailTemplates : []).map((template) => ({
    id: String(template.id || ""),
    name: String(template.name || "").trim(),
    subject: String(template.subject || "").trim(),
    body: String(template.body || "").trim(),
    sender_name: String(template.senderName || "").trim(),
    sender_email: String(template.senderEmail || "").trim().toLowerCase() || null,
    calendar_url: String(template.calendarUrl || "").trim(),
    writer_mode: template.writerMode === "full" ? "full" : "gaps",
    follow_up_cadence_days: Math.min(30, Math.max(1, Number(template.followUpCadenceDays) || 3)),
    follow_up_template_ids: Array.isArray(template.followUpTemplateIds) ? template.followUpTemplateIds.map(String).filter(Boolean) : [],
    updated_at: new Date().toISOString(),
  })).filter((template) => template.id && template.name && template.subject && template.body);
  const followUps = (Array.isArray(followUpTemplates) ? followUpTemplates : []).map((template) => ({
    id: String(template.id || ""),
    name: String(template.name || "").trim(),
    body: String(template.body || "").trim(),
    writer_mode: template.writerMode === "full" ? "full" : "gaps",
    updated_at: new Date().toISOString(),
  })).filter((template) => template.id && template.name && template.body);
  if (!emails.length) throw new Error("Keep at least one complete email template.");

  const [existingEmails, existingFollowUps] = await Promise.all([
    authenticated("/rest/v1/email_templates?select=id", options),
    authenticated("/rest/v1/follow_up_templates?select=id", options),
  ]);
  await Promise.all([
    authenticated("/rest/v1/email_templates?on_conflict=id", {
      ...options,
      method: "POST",
      body: emails,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    }),
    followUps.length ? authenticated("/rest/v1/follow_up_templates?on_conflict=id", {
      ...options,
      method: "POST",
      body: followUps,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    }) : Promise.resolve(),
  ]);
  await Promise.all([
    deleteMissingRows("email_templates", (existingEmails.data || []).map((row) => String(row.id)), new Set(emails.map((row) => row.id)), options),
    deleteMissingRows("follow_up_templates", (existingFollowUps.data || []).map((row) => String(row.id)), new Set(followUps.map((row) => row.id)), options),
  ]);
  return { emailTemplates: emails.map(emailTemplateFromRow), followUpTemplates: followUps.map(followUpTemplateFromRow) };
}

export async function syncGmailAccount(account = {}, options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before connecting Gmail.");
  const body = {
    id: String(account.id || ""),
    email: String(account.email || "").trim().toLowerCase(),
    display_name: String(account.displayName || ""),
    added_by: session.user.id,
    last_connected_at: new Date().toISOString(),
    is_active: true,
  };
  if (!body.id || !/^\S+@\S+\.\S+$/.test(body.email)) throw new Error("Google did not return a valid Gmail account.");
  try {
    await approveSender(body.email, body.display_name, options);
    const { data } = await authenticated("/rest/v1/gmail_accounts?on_conflict=id", {
      ...options,
      method: "POST",
      body: [body],
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    });
    return Array.isArray(data) ? data[0] : data;
  } catch (error) {
    if (error instanceof SupabaseApiError && (error.code === "42501" || /row-level security/i.test(error.message))) {
      throw new SupabaseApiError("Vela could not register this sender. Use an active @velaenergy.ai workspace account and reconnect the same Gmail address.", error.status, error.code);
    }
    throw error;
  }
}

export function activityRecordFromRow(row = {}) {
  const importedHistory = row.delivery_mode === "imported";
  return {
    id: row.client_event_id || row.id || "",
    status: row.status || "",
    mode: row.delivery_mode || "",
    senderEmail: row.gmail_accounts?.email || row.metadata?.sender_email || "",
    recipients: row.recipient_email ? [String(row.recipient_email).toLowerCase()] : [],
    subject: row.subject || "",
    prospectId: row.prospect_identity || "",
    completedAt: row.occurred_at || "",
    updatedAt: row.occurred_at || "",
    error: row.metadata?.error || "",
    gmailMessageId: row.metadata?.gmail_message_id || "",
    threadId: row.metadata?.gmail_thread_id || "",
    templateId: row.metadata?.template_id || "",
    kind: row.metadata?.message_kind === "follow_up" ? "follow-up" : "initial",
    bounceReason: row.metadata?.bounce_reason || "",
    bounceType: row.metadata?.bounce_type || "",
    operatorId: importedHistory ? "" : row.team_profiles?.id || row.actor_id || "",
    operatorEmail: importedHistory ? "" : row.team_profiles?.email || row.metadata?.actor_email || "",
    operatorName: importedHistory ? "" : row.team_profiles?.full_name || row.metadata?.actor_email || "",
    operatorAvatarUrl: importedHistory ? "" : row.team_profiles?.avatar_url || "",
    source: "supabase",
  };
}

export async function sharedActivity(options = {}) {
  const pageSize = 1000;
  const basePath = "/rest/v1/activity_events?select=id,client_event_id,event_type,recipient_email,subject,status,delivery_mode,prospect_identity,actor_id,occurred_at,metadata,gmail_accounts(email),team_profiles(id,email,full_name,avatar_url)&order=occurred_at.desc,id.desc";
  const rows = [];
  const seen = new Set();
  for (let offset = 0; ; offset += pageSize) {
    const { data } = await authenticated(`${basePath}&limit=${pageSize}&offset=${offset}`, options);
    const page = Array.isArray(data) ? data : [];
    let added = 0;
    for (const row of page) {
      const key = String(row.id || row.client_event_id || `${row.occurred_at || ""}:${row.recipient_email || ""}`);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      added += 1;
    }
    if (page.length < pageSize || added === 0) break;
  }
  return rows.map(activityRecordFromRow);
}

function gtmMessageRow(message = {}, session = null) {
  return {
    gmail_account_id: String(message.gmailAccountId || ""),
    gmail_message_id: String(message.gmailMessageId || ""),
    gmail_thread_id: String(message.gmailThreadId || ""),
    gmail_history_id: String(message.gmailHistoryId || ""),
    rfc_message_id: String(message.rfcMessageId || "").slice(0, 2_000),
    in_reply_to: String(message.inReplyTo || "").slice(0, 2_000),
    direction: ["outgoing", "incoming", "system"].includes(message.direction) ? message.direction : "incoming",
    message_kind: ["initial", "follow_up", "reply", "bounce"].includes(message.messageKind) ? message.messageKind : "reply",
    template_id: String(message.templateId || ""),
    classification_source: ["vela_header", "delivery_ledger", "template_fingerprint", "sent_mailbox", "thread_reply", "bounce_notice"].includes(message.classificationSource) ? message.classificationSource : "thread_reply",
    sender_email: String(message.senderEmail || "").trim().toLowerCase(),
    recipient_emails: [...new Set((Array.isArray(message.recipientEmails) ? message.recipientEmails : []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))],
    cc_emails: [...new Set((Array.isArray(message.ccEmails) ? message.ccEmails : []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))],
    subject: String(message.subject || "").slice(0, 2_000),
    body_text: String(message.bodyText || "").slice(0, 100_000),
    snippet: String(message.snippet || "").slice(0, 2_000),
    bounce_type: ["hard", "soft"].includes(message.bounceType) ? message.bounceType : "",
    bounce_reason: String(message.bounceReason || "").slice(0, 200),
    occurred_at: message.occurredAt || new Date().toISOString(),
    captured_by: session?.user?.id,
    metadata: message.metadata && typeof message.metadata === "object" ? message.metadata : {},
    updated_at: new Date().toISOString(),
  };
}

export function gtmMessageRecordFromRow(row = {}) {
  return {
    id: row.id || "",
    gmailAccountId: row.gmail_account_id || "",
    gmailMessageId: row.gmail_message_id || "",
    gmailThreadId: row.gmail_thread_id || "",
    gmailHistoryId: row.gmail_history_id || "",
    rfcMessageId: row.rfc_message_id || "",
    inReplyTo: row.in_reply_to || "",
    direction: row.direction || "",
    messageKind: row.message_kind || "",
    templateId: row.template_id || "",
    classificationSource: row.classification_source || "",
    senderEmail: row.sender_email || "",
    recipientEmails: Array.isArray(row.recipient_emails) ? row.recipient_emails : [],
    ccEmails: Array.isArray(row.cc_emails) ? row.cc_emails : [],
    subject: row.subject || "",
    bodyText: row.body_text || "",
    snippet: row.snippet || "",
    bounceType: row.bounce_type || "",
    bounceReason: row.bounce_reason || "",
    occurredAt: row.occurred_at || "",
    metadata: row.metadata || {},
    accountEmail: row.gmail_accounts?.email || "",
    operatorId: row.captured_by || "",
  };
}

export async function recordGtmEmailMessages(messages = [], options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before syncing Gmail history.");
  const rows = (Array.isArray(messages) ? messages : []).map((message) => gtmMessageRow(message, session))
    .filter((row) => row.gmail_account_id && row.gmail_message_id && row.gmail_thread_id && row.sender_email);
  if (!rows.length) return [];
  const saved = [];
  const batchSize = 100;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const { data } = await authenticated("/rest/v1/gtm_email_messages?on_conflict=gmail_account_id,gmail_message_id", {
      ...options,
      method: "POST",
      body: rows.slice(offset, offset + batchSize),
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    });
    if (Array.isArray(data)) saved.push(...data);
  }
  return saved.map(gtmMessageRecordFromRow);
}

export async function sharedGtmEmailMessages({ accountId = "", includeBody = false, ...options } = {}) {
  const pageSize = 1000;
  const columns = [
    "id", "gmail_account_id", "gmail_message_id", "gmail_thread_id", "gmail_history_id", "rfc_message_id", "in_reply_to",
    "direction", "message_kind", "template_id", "classification_source", "sender_email", "recipient_emails", "cc_emails",
    "subject", ...(includeBody ? ["body_text"] : []), "snippet", "bounce_type", "bounce_reason", "occurred_at", "captured_by", "metadata", "gmail_accounts(email)",
  ].join(",");
  const accountFilter = accountId ? `&gmail_account_id=eq.${encodeURIComponent(accountId)}` : "";
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data } = await authenticated(`/rest/v1/gtm_email_messages?select=${columns}${accountFilter}&order=occurred_at.desc,id.desc&limit=${pageSize}&offset=${offset}`, options);
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map(gtmMessageRecordFromRow);
}

export async function sharedGtmMailboxSyncStates(options = {}) {
  const { data } = await authenticated("/rest/v1/gtm_mailbox_sync_state?select=gmail_account_id,last_history_id,last_full_sync_at,last_incremental_sync_at,sync_status,sync_scope,messages_scanned,gtm_messages_found,sent_messages_found,threads_found,replies_found,bounces_found,last_error,updated_at,gmail_accounts(email)&order=updated_at.desc", options);
  return Array.isArray(data) ? data : [];
}

export async function upsertGtmMailboxSyncState(accountId = "", state = {}, options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before syncing Gmail history.");
  const row = {
    gmail_account_id: String(accountId || ""),
    last_history_id: String(state.lastHistoryId || ""),
    last_full_sync_at: state.lastFullSyncAt || null,
    last_incremental_sync_at: state.lastIncrementalSyncAt || null,
    sync_status: ["idle", "syncing", "complete", "error"].includes(state.syncStatus) ? state.syncStatus : "idle",
    sync_scope: state.syncScope === "all_sent_threads" ? "all_sent_threads" : "gtm_only",
    messages_scanned: Math.max(0, Number(state.messagesScanned) || 0),
    gtm_messages_found: Math.max(0, Number(state.gtmMessagesFound) || 0),
    sent_messages_found: Math.max(0, Number(state.sentMessagesFound) || 0),
    threads_found: Math.max(0, Number(state.threadsFound) || 0),
    replies_found: Math.max(0, Number(state.repliesFound) || 0),
    bounces_found: Math.max(0, Number(state.bouncesFound) || 0),
    last_error: String(state.lastError || "").slice(0, 2_000),
    updated_by: session.user.id,
    updated_at: new Date().toISOString(),
  };
  if (!row.gmail_account_id) throw new Error("A Gmail account is required for sync state.");
  const { data } = await authenticated("/rest/v1/gtm_mailbox_sync_state?on_conflict=gmail_account_id", {
    ...options,
    method: "POST",
    body: [row],
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });
  return Array.isArray(data) ? data[0] : data;
}

export async function claimRecipientSend({ recipient = "", claimId = "", senderEmail = "", prospectIdentity = "", force = false } = {}, options = {}) {
  const normalized = String(recipient || "").trim().toLowerCase();
  if (!normalized || !claimId) throw new Error("A recipient and delivery claim are required before sending.");
  const { data } = await authenticated("/rest/v1/rpc/claim_recipient_send", {
    ...options,
    method: "POST",
    body: {
      p_recipient_email: normalized,
      p_claim_id: String(claimId),
      p_sender_email: String(senderEmail || "").trim().toLowerCase(),
      p_prospect_identity: String(prospectIdentity || ""),
      p_force: Boolean(force),
    },
  });
  return data && typeof data === "object" ? data : { claimed: false, recipient: normalized, reason: "unavailable" };
}

export async function completeRecipientSend({ recipient = "", claimId = "", outcome = "failed" } = {}, options = {}) {
  const normalized = String(recipient || "").trim().toLowerCase();
  if (!normalized || !claimId) return false;
  const { data } = await authenticated("/rest/v1/rpc/complete_recipient_send", {
    ...options,
    method: "POST",
    body: { p_recipient_email: normalized, p_claim_id: String(claimId), p_outcome: outcome === "sent" ? "sent" : "failed" },
  });
  return data === true;
}

export async function duplicateActivity(recipients = [], options = {}) {
  const emails = [...new Set((Array.isArray(recipients) ? recipients : []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const encoded = encodeURIComponent(`(${emails.map((email) => `"${email.replaceAll('"', '')}"`).join(",")})`);
  const activityPath = `/rest/v1/activity_events?select=client_event_id,recipient_email,subject,status,delivery_mode,occurred_at,metadata,gmail_accounts(email)&recipient_email=in.${encoded}&status=in.(sent,partial,scheduled)&order=occurred_at.desc`;
  const overlap = encodeURIComponent(`{${emails.map((email) => email.replaceAll(",", "")).join(",")}}`);
  const gmailPath = `/rest/v1/gtm_email_messages?select=id,gmail_message_id,recipient_emails,subject,occurred_at,gmail_accounts(email)&direction=eq.outgoing&message_kind=in.(initial,follow_up)&recipient_emails=ov.${overlap}&order=occurred_at.desc`;
  const [{ data: activityData }, { data: gmailData }] = await Promise.all([
    authenticated(activityPath, options),
    authenticated(gmailPath, options),
  ]);
  const wanted = new Set(emails);
  const gmailRecords = (Array.isArray(gmailData) ? gmailData : []).map((row) => ({
    id: row.gmail_message_id || row.id || "",
    status: "sent",
    mode: "gmail_history",
    senderEmail: row.gmail_accounts?.email || "",
    recipients: (Array.isArray(row.recipient_emails) ? row.recipient_emails : []).map((email) => String(email).toLowerCase()).filter((email) => wanted.has(email)),
    subject: row.subject || "",
    completedAt: row.occurred_at || "",
    updatedAt: row.occurred_at || "",
    source: "gmail",
  }));
  return [...(Array.isArray(activityData) ? activityData : []).map(activityRecordFromRow), ...gmailRecords];
}

export function duplicateRecipientMatches(recipients = [], records = []) {
  const wanted = new Set((Array.isArray(recipients) ? recipients : []).map((email) => String(email).trim().toLowerCase()));
  const seen = new Set();
  return (Array.isArray(records) ? records : []).flatMap((record) => {
    if (!["sent", "partial", "scheduled"].includes(String(record.status || "").toLowerCase())) return [];
    return (record.recipients || []).flatMap((recipient) => {
      const email = String(recipient || "").toLowerCase();
      const key = `${record.id || ""}:${email}:${record.status || ""}`;
      if (!wanted.has(email) || seen.has(key)) return [];
      seen.add(key);
      return [{
        recipient: email,
        status: record.status,
        at: record.completedAt || record.scheduledAt || record.updatedAt || "",
        senderEmail: record.senderEmail || "",
        subject: record.subject || "",
        source: record.source || "local",
      }];
    });
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function activityRowsForDelivery(record = {}, session = null) {
  const recipients = Array.isArray(record.recipients) ? record.recipients : [];
  return recipients.map((recipient) => ({
    client_event_id: `${record.id}:${String(recipient).toLowerCase()}:${record.status || ""}`,
    event_type: "email_delivery",
    recipient_email: String(recipient).toLowerCase(),
    sender_account_id: record.accountId || null,
    subject: record.subject || "",
    status: record.status || "",
    delivery_mode: record.mode || "",
    prospect_identity: record.prospectId || "",
    actor_id: session?.user?.id,
    occurred_at: record.completedAt || record.scheduledAt || record.updatedAt || record.createdAt || new Date().toISOString(),
    metadata: {
      error: record.error || "",
      sender_email: record.senderEmail || "",
      actor_email: session?.user?.email || "",
      ...(record.gmailMessageId ? { gmail_message_id: record.gmailMessageId } : {}),
      ...(record.threadId ? { gmail_thread_id: record.threadId } : {}),
      ...(record.templateId ? { template_id: record.templateId } : {}),
      ...(record.kind ? { message_kind: record.kind === "follow-up" ? "follow_up" : "initial" } : {}),
      ...(record.bounceReason ? { bounce_reason: record.bounceReason } : {}),
      ...(record.bounceType ? { bounce_type: record.bounceType } : {}),
    },
  }));
}

export async function recordSharedActivity(records = [], options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before recording team activity.");
  const rows = (Array.isArray(records) ? records : []).flatMap((record) => activityRowsForDelivery(record, session));
  if (!rows.length) return [];
  const batchSize = 500;
  const saved = [];
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const { data } = await authenticated("/rest/v1/activity_events?on_conflict=client_event_id", {
      ...options,
      method: "POST",
      body: rows.slice(offset, offset + batchSize),
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    });
    if (Array.isArray(data)) saved.push(...data);
  }
  return saved;
}

function prospectIdentity(prospect = {}) {
  const linkedIn = String(prospect.url || prospect.linkedinUrl || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
  const email = String(prospect.email || "").trim().toLowerCase();
  return linkedIn ? `linkedin:${linkedIn}` : email ? `email:${email}` : "";
}

export async function syncProspects(prospects = [], options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before importing prospects.");
  const rows = (Array.isArray(prospects) ? prospects : []).map((prospect) => ({
    identity_key: prospectIdentity(prospect),
    email: prospect.email || null,
    linkedin_url: prospect.url || "",
    name: prospect.name || "",
    company: prospect.profile?.experiences?.[0]?.company || prospect.company || "",
    role: prospect.profile?.experiences?.[0]?.title || prospect.role || prospect.headline || "",
    status: prospect.status || "new",
    source: prospect.source || "",
    payload: prospect,
    imported_by: session.user.id,
    updated_at: new Date().toISOString(),
  })).filter((row) => row.identity_key);
  if (!rows.length) return [];
  const batchSize = 500;
  const saved = [];
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const { data } = await authenticated("/rest/v1/prospects?on_conflict=identity_key", {
      ...options,
      method: "POST",
      body: rows.slice(offset, offset + batchSize),
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    });
    if (Array.isArray(data)) saved.push(...data);
  }
  return saved;
}

export async function sharedProspects(options = {}) {
  const { data } = await authenticated("/rest/v1/prospects?select=payload&order=updated_at.desc&limit=5000", options);
  return (Array.isArray(data) ? data : []).map((row) => row.payload).filter(Boolean);
}

export async function clearSharedProspects(options = {}) {
  const session = await activeSupabaseSession(options);
  if (!session) throw new Error("Sign in with your Vela Energy account before clearing prospects.");
  await authenticated("/rest/v1/prospects?identity_key=not.is.null", { ...options, method: "DELETE", headers: { Prefer: "return=minimal" } });
}
