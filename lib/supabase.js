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
    requestedCount: Number(row.requested_count) || 100,
    totalFound: Number(row.total_found) || 0,
    foundCount: Number(row.found_count) || 0,
    auditedCount: Number(row.audited_count) || 0,
    strongCount: Number(row.strong_count) || 0,
    reviewCount: Number(row.review_count) || 0,
    skipCount: Number(row.skip_count) || 0,
    createdBy: row.created_by || "",
    operatorName: row.team_profiles?.full_name || row.team_profiles?.email || "Vela teammate",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    completedAt: row.completed_at || "",
    error: row.error || "",
  };
}

const RESEARCH_RUN_SELECT = "id,brief,status,requested_count,total_found,found_count,audited_count,strong_count,review_count,skip_count,created_by,created_at,updated_at,completed_at,error,team_profiles!research_runs_created_by_fkey(full_name,email)";
const LEGACY_RESEARCH_RUN_SELECT = RESEARCH_RUN_SELECT.replace("total_found,", "");

function missingResearchTotalColumn(error) {
  return error instanceof SupabaseApiError
    && (error.code === "PGRST204" || /(?:column|field).*(?:total_found)|total_found.*(?:column|field)/i.test(error.message));
}

export async function sharedResearchRuns(options = {}) {
  let data;
  try {
    ({ data } = await authenticated(`/rest/v1/research_runs?select=${RESEARCH_RUN_SELECT}&order=updated_at.desc&limit=20`, options));
  } catch (error) {
    if (!missingResearchTotalColumn(error)) throw error;
    ({ data } = await authenticated(`/rest/v1/research_runs?select=${LEGACY_RESEARCH_RUN_SELECT}&order=updated_at.desc&limit=20`, options));
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
    requested_count: Math.min(100, Math.max(1, Number(run.requestedCount) || 100)),
    total_found: Math.max(0, Number(run.totalFound) || 0),
    found_count: Math.max(0, Number(run.foundCount) || 0),
    audited_count: Math.max(0, Number(run.auditedCount) || 0),
    strong_count: Math.max(0, Number(run.strongCount) || 0),
    review_count: Math.max(0, Number(run.reviewCount) || 0),
    skip_count: Math.max(0, Number(run.skipCount) || 0),
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
    if (!missingResearchTotalColumn(error)) throw error;
    const legacyRow = { ...row };
    delete legacyRow.total_found;
    const { data } = await write(legacyRow);
    return { ...researchRunFromRow(Array.isArray(data) ? data[0] : data), totalFound: row.total_found };
  }
}

function emailTemplateFromRow(row = {}) {
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    subject: String(row.subject || ""),
    body: String(row.body || ""),
    senderName: String(row.sender_name || ""),
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
    authenticated("/rest/v1/email_templates?select=id,name,subject,body,sender_name,calendar_url,writer_mode,follow_up_cadence_days,follow_up_template_ids&order=name.asc", options),
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
    bounceReason: row.metadata?.bounce_reason || "",
    bounceType: row.metadata?.bounce_type || "",
    operatorId: row.team_profiles?.id || row.actor_id || "",
    operatorEmail: row.team_profiles?.email || row.metadata?.actor_email || "",
    operatorName: row.team_profiles?.full_name || row.metadata?.actor_email || "",
    operatorAvatarUrl: row.team_profiles?.avatar_url || "",
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

export async function duplicateActivity(recipients = [], options = {}) {
  const emails = [...new Set((Array.isArray(recipients) ? recipients : []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const encoded = encodeURIComponent(`(${emails.map((email) => `"${email.replaceAll('"', '')}"`).join(",")})`);
  const path = `/rest/v1/activity_events?select=client_event_id,recipient_email,subject,status,delivery_mode,occurred_at,metadata,gmail_accounts(email)&recipient_email=in.${encoded}&status=in.(sent,partial,scheduled)&order=occurred_at.desc`;
  const { data } = await authenticated(path, options);
  return (Array.isArray(data) ? data : []).map(activityRecordFromRow);
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
  const { data } = await authenticated("/rest/v1/prospects?on_conflict=identity_key", {
    ...options,
    method: "POST",
    body: rows,
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });
  return Array.isArray(data) ? data : [];
}

export async function sharedProspects(options = {}) {
  const { data } = await authenticated("/rest/v1/prospects?select=payload&order=updated_at.desc&limit=5000", options);
  return (Array.isArray(data) ? data : []).map((row) => row.payload).filter(Boolean);
}
