import { contactOutAccountStatus, enrichViaContactOut } from "./lib/contactout.js";
import { writeOutreach } from "./server/openai-writer.mjs";
import { planProspectSearch, respondToResearchMessage } from "./server/search-planner.mjs";
import { verifyTargetFit } from "./server/target-fit.mjs";
import { apolloAccountStatus, enrichViaApollo } from "./lib/apollo.js";
import {
  contactOutSessionStatus,
  openContactOutSessionLogin,
  previewContactOutSession,
  revealContactOutSession,
} from "./lib/contactout-session.js";
import { searchPeopleWithProviders } from "./lib/people-search.js";
import { appendDiagnostic } from "./lib/diagnostics.js";
import {
  GOOGLE_ACCOUNT_AUTH_MODE,
  GOOGLE_ACCOUNTS_STORAGE_KEY,
  GOOGLE_ACCOUNT_STORAGE_KEY,
  authorizeGoogleAccount,
  getGoogleWebAuthToken,
  googleAccountById,
  googleAuthStrategyForAccount,
  normalizeGoogleAccounts,
} from "./lib/google-auth.js";
import { DEFAULT_SETTINGS } from "./lib/message.js";
import { GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, GmailApiError, buildMimeMessage, gmailThreadHasReply, sendGmailMessage, uniqueRecipients } from "./lib/gmail-send.js";
import { listGmailBounces } from "./lib/gmail-bounces.js";
import {
  activeSupabaseSession,
  currentTeamMembership,
  duplicateActivity,
  duplicateRecipientMatches,
  requireApprovedSender,
  recordSharedActivity,
  sharedActivity,
  sharedApprovedSenders,
  sharedGmailAccounts,
  sharedOutreachTemplates,
  sharedProspects,
  sharedResearchRuns,
  sharedTeamProfiles,
  signInWithGoogleTokens,
  signOutSupabase,
  setTeamMemberActive,
  syncGmailAccount,
  syncOutreachTemplates,
  syncProspects,
  syncResearchRun,
} from "./lib/supabase.js";
import {
  SCHEDULED_SENDS_STORAGE_KEY,
  alarmNameForJob,
  createScheduledSend,
  jobIdFromAlarm,
  normalizeScheduledSends,
} from "./lib/schedule.js";
import { QUEUE_STATUS, QUEUE_STORAGE_KEY, withActivity } from "./lib/queue.js";
import { CAMPAIGNS_STORAGE_KEY } from "./lib/campaigns.js";
import {
  WORKSPACE_BACKUP_STORAGE_KEY,
  createWorkspaceBackup,
  workspaceRecoveryPatch,
} from "./lib/workspace-persistence.js";
import {
  DELIVERY_LOG_STORAGE_KEY,
  DELIVERY_STATUS,
  normalizeDeliveryLog,
  upsertDeliveryRecord,
} from "./lib/delivery-ledger.js";
import { buildFollowUpJobs, hasRecordedReply } from "./lib/follow-up.js";

const TEAM_SYNC_STATE_STORAGE_KEY = "velaGtmTeamSyncState";
const GMAIL_BOUNCE_SYNC_STATE_STORAGE_KEY = "velaGtmGmailBounceSyncState";
const GMAIL_BOUNCE_ALARM = "vela-gtm-bounce-sync";

async function enablePersistentSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

function tabIdFromSender(sender = {}) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("Vela GTM could not identify this LinkedIn tab.");
  return tabId;
}

async function configureSidePanelForTab(sender = {}) {
  const tabId = tabIdFromSender(sender);
  if (!chrome.sidePanel?.setOptions) throw new Error("Update Chrome to configure Vela GTM on LinkedIn.");
  await chrome.sidePanel.setOptions({ tabId, path: "popup.html", enabled: true });
  return { configured: true };
}

function openSidePanelFromMessage(sender = {}, sendResponse) {
  let tabId;
  try {
    tabId = tabIdFromSender(sender);
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not identify this LinkedIn tab." });
    return false;
  }
  if (!chrome.sidePanel?.open) {
    sendResponse({ ok: false, error: "Update Chrome to open Vela GTM from LinkedIn." });
    return false;
  }

  // Invoke open() directly in the message event spawned by the click. Chrome
  // requires this call to remain associated with the originating user gesture.
  chrome.sidePanel.open({ tabId })
    .then(() => sendResponse({ ok: true, data: { opened: true } }))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Could not open Vela GTM.",
    }));
  return true;
}

async function maintainWorkspaceBackup() {
  const saved = await chrome.storage.local.get([QUEUE_STORAGE_KEY, CAMPAIGNS_STORAGE_KEY, WORKSPACE_BACKUP_STORAGE_KEY]);
  const recovery = workspaceRecoveryPatch(saved);
  const queue = recovery[QUEUE_STORAGE_KEY] || (Array.isArray(saved[QUEUE_STORAGE_KEY]) ? saved[QUEUE_STORAGE_KEY] : []);
  const campaigns = recovery[CAMPAIGNS_STORAGE_KEY] || (Array.isArray(saved[CAMPAIGNS_STORAGE_KEY]) ? saved[CAMPAIGNS_STORAGE_KEY] : []);
  await chrome.storage.local.set({
    ...recovery,
    [WORKSPACE_BACKUP_STORAGE_KEY]: createWorkspaceBackup({ queue, campaigns }),
  });
}

function alarmsApi() {
  return globalThis.chrome?.alarms || null;
}

function requireAlarmsApi() {
  const api = alarmsApi();
  if (!api?.create || !api?.clear || !api?.getAll) {
    throw new Error("Chrome scheduling is unavailable. Reload Vela GTM from chrome://extensions so the alarms permission is applied.");
  }
  return api;
}

async function settings() {
  const stored = await chrome.storage.local.get("velaGtmSettings");
  const configured = { ...DEFAULT_SETTINGS, ...(stored.velaGtmSettings || {}) };
  configured.googleWebClientId = DEFAULT_SETTINGS.googleWebClientId;
  return configured;
}

async function recordProspectDelivery(prospectId, type, detail, { sent = false, at = new Date().toISOString() } = {}) {
  if (!prospectId) return;
  const saved = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
  const queue = Array.isArray(saved[QUEUE_STORAGE_KEY]) ? saved[QUEUE_STORAGE_KEY] : [];
  if (!queue.some((item) => item.id === prospectId)) return;
  await chrome.storage.local.set({
    [QUEUE_STORAGE_KEY]: queue.map((item) => item.id === prospectId ? {
      ...withActivity(item, type, detail, at),
      ...(sent ? { status: QUEUE_STATUS.SENT, emailSentAt: at } : {}),
    } : item),
  });
}

async function savedGoogleAccount(expectedAccountId = "") {
  const saved = await chrome.storage.local.get([GOOGLE_ACCOUNTS_STORAGE_KEY, GOOGLE_ACCOUNT_STORAGE_KEY]);
  const account = googleAccountById(saved[GOOGLE_ACCOUNTS_STORAGE_KEY], expectedAccountId, saved[GOOGLE_ACCOUNT_STORAGE_KEY]);
  if (!account) throw new Error("The selected Gmail sender changed. Review Google delivery in Settings before sending.");
  return account;
}

async function gmailToken(interactive = false, expectedAccountId = "") {
  const configured = await settings();
  const account = await savedGoogleAccount(expectedAccountId);
  const strategy = googleAuthStrategyForAccount({ account, webClientId: configured.googleWebClientId });
  if (strategy === GOOGLE_ACCOUNT_AUTH_MODE) {
    const token = await getGoogleWebAuthToken({
      identity: chrome.identity,
      clientId: configured.googleWebClientId,
      scopes: [GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE],
      expectedEmail: account.email,
      interactive,
    });
    return { token, account };
  }
  if (!strategy) {
    throw new Error("Google delivery needs a valid Web OAuth client ID.");
  }
  throw new Error("Google account-chooser authorization is unavailable.");
}

async function recordDelivery(input = {}) {
  const saved = await chrome.storage.local.get(DELIVERY_LOG_STORAGE_KEY);
  const records = upsertDeliveryRecord(saved[DELIVERY_LOG_STORAGE_KEY], input);
  await chrome.storage.local.set({ [DELIVERY_LOG_STORAGE_KEY]: records });
  return records[0];
}

async function syncDeliveryActivity(record = {}) {
  const attemptedAt = new Date().toISOString();
  try {
    await recordSharedActivity([record], { storage: chrome.storage.local });
    const teamSync = { status: "synced", attemptedAt };
    await chrome.storage.local.set({ [TEAM_SYNC_STATE_STORAGE_KEY]: teamSync });
    return teamSync;
  } catch (error) {
    const teamSync = {
      status: "error",
      attemptedAt,
      error: error instanceof Error ? error.message : "Supabase activity sync failed.",
    };
    await chrome.storage.local.set({ [TEAM_SYNC_STATE_STORAGE_KEY]: teamSync });
    return teamSync;
  }
}

async function recordAndSyncDelivery(input = {}) {
  const record = await recordDelivery(input);
  const teamSync = await syncDeliveryActivity(record);
  return { record, tracking: teamSync, teamSync };
}

async function stopFollowUpsForRecipient(recipient = "", reason = "Follow-ups stopped after a delivery bounce.") {
  const normalized = String(recipient || "").trim().toLowerCase();
  if (!normalized) return 0;
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const jobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]);
  const completedAt = new Date().toISOString();
  const cancelled = jobs.filter((job) => job.kind === "follow-up"
    && job.status === DELIVERY_STATUS.SCHEDULED
    && (job.recipients || []).some((email) => String(email).toLowerCase() === normalized));
  for (const job of cancelled) {
    await requireAlarmsApi().clear(alarmNameForJob(job.id));
    await recordAndSyncDelivery({ ...job, status: DELIVERY_STATUS.CANCELLED, completedAt, updatedAt: completedAt, error: reason });
  }
  if (cancelled.length) {
    await chrome.storage.local.set({
      [SCHEDULED_SENDS_STORAGE_KEY]: jobs.map((job) => cancelled.some((item) => item.id === job.id)
        ? { ...job, status: DELIVERY_STATUS.CANCELLED, completedAt, error: reason }
        : job),
    });
  }
  return cancelled.length;
}

async function syncGmailBounces({ interactive = false } = {}) {
  const saved = await chrome.storage.local.get([
    GOOGLE_ACCOUNTS_STORAGE_KEY,
    GOOGLE_ACCOUNT_STORAGE_KEY,
    DELIVERY_LOG_STORAGE_KEY,
    QUEUE_STORAGE_KEY,
  ]);
  const accounts = normalizeGoogleAccounts(saved[GOOGLE_ACCOUNTS_STORAGE_KEY] || [], saved[GOOGLE_ACCOUNT_STORAGE_KEY]);
  if (!accounts.length) throw new Error("Connect a Gmail sender before checking delivery health.");

  const deliveryLog = normalizeDeliveryLog(saved[DELIVERY_LOG_STORAGE_KEY]);
  const queue = Array.isArray(saved[QUEUE_STORAGE_KEY]) ? saved[QUEUE_STORAGE_KEY] : [];
  const knownRecipients = new Set([
    ...deliveryLog.filter((record) => [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status)).flatMap((record) => record.recipients || []),
    ...queue.filter((prospect) => prospect.emailSentAt
      || prospect.status === QUEUE_STATUS.SENT
      || (prospect.activity || []).some((item) => ["sent", "send_partial"].includes(item?.type)))
      .map((prospect) => prospect.email),
  ].map((email) => String(email || "").trim().toLowerCase()).filter(Boolean));
  const existingIds = new Set(deliveryLog.map((record) => record.id));
  const matchedProspects = new Map(queue.map((prospect) => [String(prospect.email || "").trim().toLowerCase(), prospect]));
  const errors = [];
  const detected = [];
  const newBounceEvents = [];
  let newlyDetected = 0;
  let followUpsStopped = 0;

  for (const account of accounts) {
    try {
      const authorization = await gmailToken(interactive, account.id);
      const bounces = await listGmailBounces(authorization.token, { senderEmail: authorization.account.email });
      for (const bounce of bounces.filter((item) => knownRecipients.has(item.recipient))) {
        const prospect = matchedProspects.get(bounce.recipient);
        const latestDelivery = deliveryLog.find((record) => (record.recipients || []).includes(bounce.recipient)
          && [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PARTIAL].includes(record.status));
        const id = `gmail-bounce:${account.id}:${bounce.gmailMessageId}:${bounce.recipient}`;
        if (!existingIds.has(id)) {
          newlyDetected += 1;
          newBounceEvents.push(bounce);
          existingIds.add(id);
        }
        await recordAndSyncDelivery({
          id,
          accountId: account.id,
          senderEmail: account.email,
          recipients: [bounce.recipient],
          prospectId: prospect?.id || latestDelivery?.prospectId || "",
          subject: latestDelivery?.subject || "",
          mode: "inbox",
          status: DELIVERY_STATUS.BOUNCED,
          completedAt: bounce.occurredAt,
          updatedAt: bounce.occurredAt,
          error: bounce.diagnostic,
          gmailMessageId: bounce.gmailMessageId,
          bounceReason: bounce.reason,
          bounceType: bounce.type,
        });
        followUpsStopped += await stopFollowUpsForRecipient(bounce.recipient, `${bounce.label}; automatic follow-ups stopped.`);
        detected.push(bounce);
      }
    } catch (error) {
      errors.push({ account: account.email, error: error instanceof Error ? error.message : "Inbox check failed." });
    }
  }

  if (newBounceEvents.length) {
    const latestByRecipient = new Map(newBounceEvents.sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt))).map((bounce) => [bounce.recipient, bounce]));
    const updated = queue.map((prospect) => {
      const bounce = latestByRecipient.get(String(prospect.email || "").trim().toLowerCase());
      if (!bounce) return prospect;
      return {
        ...withActivity(prospect, "email_bounced", `${bounce.label}: ${bounce.diagnostic}`, bounce.occurredAt),
        emailBouncedAt: bounce.occurredAt,
        emailBounceReason: bounce.reason,
        emailBounceType: bounce.type,
      };
    });
    await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: updated });
    await syncProspects(updated.filter((prospect) => latestByRecipient.has(String(prospect.email || "").trim().toLowerCase())), { storage: chrome.storage.local }).catch(() => {});
  }

  const result = {
    checkedAccounts: accounts.length,
    detected: detected.length,
    newBounces: newlyDetected,
    followUpsStopped,
    errors,
    checkedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [GMAIL_BOUNCE_SYNC_STATE_STORAGE_KEY]: result });
  if (!detected.length && errors.length === accounts.length) throw new Error(errors[0].error);
  return result;
}

async function ensureBounceAlarm() {
  const api = alarmsApi();
  if (!api?.create) return;
  await api.create(GMAIL_BOUNCE_ALARM, { delayInMinutes: 5, periodInMinutes: 30 });
}

async function teamSnapshot() {
  const saved = await chrome.storage.local.get(DELIVERY_LOG_STORAGE_KEY);
  const localRecords = normalizeDeliveryLog(saved[DELIVERY_LOG_STORAGE_KEY]).map((record) => ({ ...record, source: "local" }));
  try {
    const records = await sharedActivity({ storage: chrome.storage.local });
    return { records: [...records, ...localRecords], backendStatus: "synced" };
  } catch (error) {
    return {
      records: localRecords,
      backendStatus: "error",
      error: error instanceof Error ? error.message : "Could not check Supabase team activity.",
    };
  }
}

async function checkDuplicateDelivery(input = {}) {
  const recipients = uniqueRecipients(input.recipients);
  const saved = await chrome.storage.local.get(DELIVERY_LOG_STORAGE_KEY);
  const localRecords = normalizeDeliveryLog(saved[DELIVERY_LOG_STORAGE_KEY]).map((record) => ({ ...record, source: "local" }));
  let sharedRecords = [];
  let backendStatus = "synced";
  let error = "";
  try {
    sharedRecords = await duplicateActivity(recipients, { storage: chrome.storage.local });
  } catch (cause) {
    backendStatus = "error";
    error = cause instanceof Error ? cause.message : "Could not check Supabase team activity.";
  }
  const records = [...sharedRecords, ...localRecords].filter((record) => !input.id || record.id !== input.id);
  return { backendStatus, error, matches: duplicateRecipientMatches(recipients, records) };
}

async function requireDuplicateOverride(input = {}) {
  if (input.duplicateOverride) return;
  const duplicate = await checkDuplicateDelivery(input);
  if (!duplicate.matches.length) return;
  const first = duplicate.matches[0];
  const when = first.at ? ` on ${new Date(first.at).toLocaleString()}` : "";
  const error = new Error(`${first.recipient} was already ${first.status}${when}. Confirm that you want to send another email.`);
  error.code = "DUPLICATE_RECIPIENT";
  error.duplicate = duplicate;
  throw error;
}

async function importHistoricalDeliveries(records = []) {
  const normalized = (Array.isArray(records) ? records : [])
    .map((record) => ({ ...record, status: DELIVERY_STATUS.SENT, mode: "imported" }))
    .filter((record) => uniqueRecipients(record.recipients).length && record.completedAt);
  if (!normalized.length) return { imported: 0, tracking: { status: "skipped" } };
  const saved = await chrome.storage.local.get(DELIVERY_LOG_STORAGE_KEY);
  let deliveryLog = saved[DELIVERY_LOG_STORAGE_KEY];
  for (const record of normalized) deliveryLog = upsertDeliveryRecord(deliveryLog, record);
  await chrome.storage.local.set({ [DELIVERY_LOG_STORAGE_KEY]: deliveryLog });
  try {
    await recordSharedActivity(normalized, { storage: chrome.storage.local });
    return { imported: normalized.length, tracking: { status: "synced" }, teamSync: { status: "synced" } };
  } catch (error) {
    const teamSync = { status: "error", error: error instanceof Error ? error.message : "Historical sends were saved locally but did not sync to Supabase." };
    return { imported: normalized.length, tracking: teamSync, teamSync };
  }
}

async function sendDelivery(input = {}) {
  const recipients = uniqueRecipients(input.recipients);
  if (!recipients.length) throw new Error("Select at least one verified recipient.");
  for (const recipient of recipients) buildMimeMessage({ to: recipient, subject: input.subject, body: input.body });
  if (!input.accountId) throw new Error("Connect and choose a Gmail sender in Settings.");
  await requireDuplicateOverride({ ...input, recipients });

  let authorization = await gmailToken(false, input.accountId);
  await requireApprovedSender(authorization.account.email, { storage: chrome.storage.local });
  let { token } = authorization;
  const deliveryInput = { ...input, senderEmail: authorization.account.email };
  let refreshAttempted = false;
  const sent = [];
  const failed = [];
  for (const recipient of recipients) {
    try {
      const messageId = input.messageId || `<${crypto.randomUUID()}@vela.energy>`;
      let result;
      try {
        result = await sendGmailMessage(token, { to: recipient, subject: input.subject, body: input.body, messageId, threadId: input.threadId, replyToMessageId: input.replyToMessageId });
      } catch (error) {
        if (!(error instanceof GmailApiError) || error.status !== 401 || refreshAttempted) throw error;
        refreshAttempted = true;
        await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
        authorization = await gmailToken(false, input.accountId);
        token = authorization.token;
        result = await sendGmailMessage(token, { to: recipient, subject: input.subject, body: input.body, messageId, threadId: input.threadId, replyToMessageId: input.replyToMessageId });
      }
      sent.push({ recipient, messageId, ...result });
    } catch (error) {
      failed.push({ recipient, error: error instanceof Error ? error.message : "Gmail send failed." });
    }
  }
  const completedAt = new Date().toISOString();
  const deliveryId = input.id || crypto.randomUUID();
  const status = !sent.length ? DELIVERY_STATUS.FAILED : failed.length ? DELIVERY_STATUS.PARTIAL : DELIVERY_STATUS.SENT;
  const { tracking } = await recordAndSyncDelivery({
    ...deliveryInput,
    id: deliveryId,
    mode: input.scheduledAt ? "scheduled" : "immediate",
    status,
    completedAt,
    updatedAt: completedAt,
    error: failed.map((item) => `${item.recipient}: ${item.error}`).join("; "),
  });
  if (!sent.length) {
    const error = new Error(failed[0]?.error || "Gmail did not send the message.");
    error.deliveryRecorded = true;
    throw error;
  }
  await recordProspectDelivery(
    input.prospectId,
    failed.length ? "send_partial" : "sent",
    failed.length ? `Sent to ${sent.length}; ${failed.length} failed` : `Sent via Gmail to ${sent.length} verified address${sent.length === 1 ? "" : "es"}`,
    { sent: failed.length === 0 },
  );
  if (status === DELIVERY_STATUS.SENT && input.kind !== "follow-up" && input.followUps?.length) {
    await scheduleAutomaticFollowUps({
      ...input,
      senderEmail: authorization.account.email,
      recipients,
      initialDeliveryId: deliveryId,
      threadId: sent[0]?.threadId || "",
      replyToMessageId: sent[0]?.messageId || "",
      startAt: completedAt,
    });
  }
  return { deliveryId, sent, failed, tracking };
}

async function scheduleAutomaticFollowUps(input = {}) {
  const jobs = buildFollowUpJobs({
    followUps: input.followUps,
    cadenceDays: input.followUpCadenceDays,
    startAt: input.startAt,
    threadId: input.threadId,
    replyToMessageId: input.replyToMessageId,
    base: {
      sequenceId: input.initialDeliveryId,
      accountId: input.accountId,
      senderEmail: input.senderEmail,
      recipients: input.recipients,
      prospectId: input.prospectId,
      subject: input.subject,
    },
  }).map((job) => createScheduledSend(job));
  if (!jobs.length) return [];
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const existing = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]);
  await chrome.storage.local.set({ [SCHEDULED_SENDS_STORAGE_KEY]: [...existing, ...jobs].slice(-100) });
  for (const job of jobs) {
    await requireAlarmsApi().create(alarmNameForJob(job.id), { when: Date.parse(job.scheduledAt) });
    await recordAndSyncDelivery({ ...job, status: DELIVERY_STATUS.SCHEDULED, updatedAt: job.createdAt });
  }
  await recordProspectDelivery(input.prospectId, "follow_up_sequence_started", `${jobs.length} automatic follow-ups queued`);
  return jobs;
}

async function scheduleDelivery(input = {}) {
  const recipients = uniqueRecipients(input.recipients);
  for (const recipient of recipients) buildMimeMessage({ to: recipient, subject: input.subject, body: input.body });
  if (!input.accountId) throw new Error("Connect and choose a Gmail sender in Settings.");
  await requireDuplicateOverride({ ...input, recipients });
  const account = await savedGoogleAccount(input.accountId);
  await requireApprovedSender(account.email, { storage: chrome.storage.local });
  const job = createScheduledSend({ ...input, senderEmail: account.email, recipients });
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const jobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]);
  await chrome.storage.local.set({ [SCHEDULED_SENDS_STORAGE_KEY]: [...jobs, job].slice(-100) });
  await requireAlarmsApi().create(alarmNameForJob(job.id), { when: new Date(job.scheduledAt).getTime() });
  const { tracking } = await recordAndSyncDelivery({ ...job, mode: "scheduled", status: DELIVERY_STATUS.SCHEDULED, updatedAt: job.createdAt });
  await recordProspectDelivery(job.prospectId, "scheduled", `Gmail send scheduled for ${job.scheduledAt}`);
  return { ...job, tracking };
}

async function updateScheduledJob(id, updates) {
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const jobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]);
  await chrome.storage.local.set({
    [SCHEDULED_SENDS_STORAGE_KEY]: jobs.map((job) => job.id === id ? { ...job, ...updates } : job),
  });
}

async function stopFollowUpSequence(sequenceId, reason = "Sequence stopped after a reply.") {
  if (!sequenceId) return;
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const jobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]);
  const completedAt = new Date().toISOString();
  const cancelled = jobs.filter((job) => job.sequenceId === sequenceId && job.status === DELIVERY_STATUS.SCHEDULED);
  for (const job of cancelled) {
    await requireAlarmsApi().clear(alarmNameForJob(job.id));
    await recordAndSyncDelivery({ ...job, status: DELIVERY_STATUS.CANCELLED, completedAt, updatedAt: completedAt, error: reason });
  }
  await chrome.storage.local.set({
    [SCHEDULED_SENDS_STORAGE_KEY]: jobs.map((job) => cancelled.some((item) => item.id === job.id) ? { ...job, status: DELIVERY_STATUS.CANCELLED, completedAt, error: reason } : job),
  });
}

async function processScheduledJob(id) {
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const job = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]).find((item) => item.id === id);
  if (!job || job.status !== "scheduled") return;
  try {
    if (job.kind === "follow-up" && job.prospectId) {
      const queueState = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
      const prospect = (queueState[QUEUE_STORAGE_KEY] || []).find((item) => item.id === job.prospectId);
      if (prospect && hasRecordedReply(prospect)) {
        await stopFollowUpSequence(job.sequenceId, "Sequence stopped after a recorded reply.");
        return;
      }
      if (job.threadId) {
        const { token, account } = await gmailToken(false, job.accountId);
        const replied = await gmailThreadHasReply(token, { threadId: job.threadId, senderEmail: account.email, sentAt: job.createdAt });
        if (replied) {
          await stopFollowUpSequence(job.sequenceId, "Sequence stopped after a Gmail reply.");
          await recordProspectDelivery(job.prospectId, "gmail_reply", "Reply detected in Gmail; automatic follow-ups stopped");
          return;
        }
      }
    }
    const result = await sendDelivery({ ...job, duplicateOverride: true });
    const completedAt = new Date().toISOString();
    await updateScheduledJob(id, { status: result.failed.length ? "partial" : "sent", error: result.failed.map((item) => item.error).join("; "), completedAt });
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Scheduled Gmail send failed.";
    await updateScheduledJob(id, { status: "failed", error: message, completedAt });
    if (!error?.deliveryRecorded) {
      await recordAndSyncDelivery({
        ...job,
        status: DELIVERY_STATUS.FAILED,
        completedAt,
        updatedAt: completedAt,
        error: message,
      });
    }
    await recordProspectDelivery(job.prospectId, "send_failed", message, { at: completedAt });
  }
}

async function cancelScheduledJob(id) {
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const jobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]);
  const job = jobs.find((item) => item.id === id);
  if (!job) throw new Error("That scheduled send no longer exists.");
  if (job.status !== "scheduled") throw new Error("Only queued sends can be cancelled.");
  const completedAt = new Date().toISOString();
  await requireAlarmsApi().clear(alarmNameForJob(id));
  await updateScheduledJob(id, { status: DELIVERY_STATUS.CANCELLED, completedAt });
  const { tracking } = await recordAndSyncDelivery({ ...job, status: DELIVERY_STATUS.CANCELLED, completedAt, updatedAt: completedAt });
  await recordProspectDelivery(job.prospectId, "schedule_cancelled", "Scheduled Gmail send cancelled", { at: completedAt });
  return { id, status: DELIVERY_STATUS.CANCELLED, tracking };
}

async function restoreScheduledAlarms() {
  const api = alarmsApi();
  if (!api?.getAll || !api?.create) return;
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const jobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]).filter((job) => job.status === "scheduled");
  const alarms = new Set((await api.getAll()).map((alarm) => alarm.name));
  for (const job of jobs) {
    const name = alarmNameForJob(job.id);
    if (!alarms.has(name)) await api.create(name, { when: Math.max(Date.parse(job.scheduledAt), Date.now() + 250) });
  }
}

async function teamAuthStatus() {
  const session = await activeSupabaseSession({ storage: chrome.storage.local });
  if (!session) return { signedIn: false, user: null };
  const membership = await currentTeamMembership({ storage: chrome.storage.local });
  if (!membership?.is_active) {
    await signOutSupabase({ storage: chrome.storage.local });
    return { signedIn: false, user: null, error: "Your Vela workspace access is inactive." };
  }
  return { signedIn: true, user: { ...session.user, role: membership.role }, membership };
}

async function signInTeam(message = {}) {
  const session = await signInWithGoogleTokens({
    idToken: message.idToken,
    accessToken: message.accessToken,
    nonce: message.nonce,
    storage: chrome.storage.local,
  });
  const membership = await currentTeamMembership({ storage: chrome.storage.local });
  if (!membership?.is_active) {
    await signOutSupabase({ storage: chrome.storage.local });
    throw new Error("Your Vela workspace access is inactive. Ask the workspace admin to restore it.");
  }
  return { signedIn: true, user: { ...session.user, role: membership.role }, membership };
}

async function signInTeamInteractive() {
  const configured = await settings();
  const authorization = await authorizeGoogleAccount({
    identity: chrome.identity,
    clientId: configured.googleWebClientId,
    scopes: [],
    includeIdToken: true,
  });
  return signInTeam({ idToken: authorization.idToken, accessToken: authorization.token, nonce: authorization.nonce });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "VELA_GTM_OPEN_SIDE_PANEL") {
    return openSidePanelFromMessage(sender, sendResponse);
  }
  const supported = message?.type?.startsWith("VELA_GTM_PROVIDER_")
    || message?.type?.startsWith("VELA_GTM_CONTACTOUT_SESSION_")
    || [
      "VELA_GTM_CONFIGURE_SIDE_PANEL", "VELA_GTM_EMAIL_SEND", "VELA_GTM_EMAIL_SCHEDULE", "VELA_GTM_EMAIL_SCHEDULE_CANCEL", "VELA_GTM_EMAIL_DUPLICATE_CHECK",
      "VELA_GTM_TEAM_AUTH_STATUS", "VELA_GTM_TEAM_SIGN_IN", "VELA_GTM_TEAM_INTERACTIVE_SIGN_IN", "VELA_GTM_TEAM_SIGN_OUT", "VELA_GTM_TEAM_ACTIVITY_READ", "VELA_GTM_TEAM_ACTIVITY_IMPORT",
      "VELA_GTM_TEAM_GMAIL_READ", "VELA_GTM_TEAM_GMAIL_SYNC", "VELA_GTM_GMAIL_BOUNCES_SYNC", "VELA_GTM_TEAM_SENDERS_READ", "VELA_GTM_TEAM_MEMBERS_READ", "VELA_GTM_TEAM_MEMBER_SET_ACTIVE", "VELA_GTM_TEAM_PROSPECTS_READ", "VELA_GTM_TEAM_PROSPECTS_SYNC", "VELA_GTM_TEAM_RESEARCH_RUNS_READ", "VELA_GTM_TEAM_RESEARCH_RUN_SYNC", "VELA_GTM_TEAM_TEMPLATES_READ", "VELA_GTM_TEAM_TEMPLATES_SYNC",
    ].includes(message?.type);
  if (!supported) return false;
  (async () => {
    if (message.type === "VELA_GTM_CONFIGURE_SIDE_PANEL") return configureSidePanelForTab(sender);
    if (message.type === "VELA_GTM_EMAIL_SEND") return sendDelivery(message.delivery);
    if (message.type === "VELA_GTM_EMAIL_SCHEDULE") return scheduleDelivery(message.delivery);
    if (message.type === "VELA_GTM_EMAIL_SCHEDULE_CANCEL") return cancelScheduledJob(message.id);
    if (message.type === "VELA_GTM_EMAIL_DUPLICATE_CHECK") return checkDuplicateDelivery(message.delivery);
    if (message.type === "VELA_GTM_TEAM_AUTH_STATUS") return teamAuthStatus();
    if (message.type === "VELA_GTM_TEAM_SIGN_IN") return signInTeam(message);
    if (message.type === "VELA_GTM_TEAM_INTERACTIVE_SIGN_IN") return signInTeamInteractive();
    if (message.type === "VELA_GTM_TEAM_SIGN_OUT") { await signOutSupabase({ storage: chrome.storage.local }); return { signedIn: false }; }
    if (message.type === "VELA_GTM_TEAM_ACTIVITY_READ") return teamSnapshot();
    if (message.type === "VELA_GTM_TEAM_ACTIVITY_IMPORT") return importHistoricalDeliveries(message.records);
    if (message.type === "VELA_GTM_TEAM_GMAIL_READ") return sharedGmailAccounts({ storage: chrome.storage.local });
    if (message.type === "VELA_GTM_TEAM_SENDERS_READ") return sharedApprovedSenders({ storage: chrome.storage.local });
    if (message.type === "VELA_GTM_TEAM_GMAIL_SYNC") return syncGmailAccount(message.account, { storage: chrome.storage.local });
    if (message.type === "VELA_GTM_GMAIL_BOUNCES_SYNC") return syncGmailBounces({ interactive: Boolean(message.interactive) });
    if (message.type === "VELA_GTM_TEAM_MEMBERS_READ") return sharedTeamProfiles({ storage: chrome.storage.local });
    if (message.type === "VELA_GTM_TEAM_MEMBER_SET_ACTIVE") return setTeamMemberActive(message.memberId, message.isActive, { storage: chrome.storage.local });
    if (message.type === "VELA_GTM_TEAM_PROSPECTS_READ") return sharedProspects({ storage: chrome.storage.local });
    if (message.type === "VELA_GTM_TEAM_PROSPECTS_SYNC") return syncProspects(message.prospects, { storage: chrome.storage.local });
    if (message.type === "VELA_GTM_TEAM_RESEARCH_RUNS_READ") return sharedResearchRuns({ storage: chrome.storage.local });
    if (message.type === "VELA_GTM_TEAM_RESEARCH_RUN_SYNC") return syncResearchRun(message.run, { storage: chrome.storage.local });
    if (message.type === "VELA_GTM_TEAM_TEMPLATES_READ") return sharedOutreachTemplates({ storage: chrome.storage.local });
    if (message.type === "VELA_GTM_TEAM_TEMPLATES_SYNC") return syncOutreachTemplates(message.templates, { storage: chrome.storage.local });
    const configured = await settings();
    if (message.type === "VELA_GTM_PROVIDER_CONTACTOUT") {
      return enrichViaContactOut(message.profile, { apiKey: configured.contactOutApiKey, includePhone: configured.includeContactOutPhone });
    }
    if (message.type === "VELA_GTM_PROVIDER_CONTACTOUT_STATUS") {
      return contactOutAccountStatus({ apiKey: configured.contactOutApiKey });
    }
    if (message.type === "VELA_GTM_CONTACTOUT_SESSION_CONNECT") {
      return openContactOutSessionLogin();
    }
    if (message.type === "VELA_GTM_CONTACTOUT_SESSION_STATUS") {
      return contactOutSessionStatus({ createPage: Boolean(message.createPage) });
    }
    if (message.type === "VELA_GTM_PROVIDER_CONTACTOUT_SESSION") {
      if (!configured.contactOutSessionEnabled) throw new Error("Enable the ContactOut browser session in Settings first.");
      return previewContactOutSession(message.profile, { includePhone: false });
    }
    if (message.type === "VELA_GTM_PROVIDER_CONTACTOUT_SESSION_REVEAL") {
      if (!configured.contactOutSessionEnabled) throw new Error("Enable the ContactOut browser session in Settings first.");
      return revealContactOutSession(message.revealToken);
    }
    if (message.type === "VELA_GTM_PROVIDER_APOLLO") {
      return enrichViaApollo(message.profile, { apiKey: configured.apolloApiKey, includePhone: configured.includeContactOutPhone });
    }
    if (message.type === "VELA_GTM_PROVIDER_APOLLO_STATUS") {
      return apolloAccountStatus({ apiKey: configured.apolloApiKey });
    }
    if (message.type === "VELA_GTM_PROVIDER_WRITE") {
      return writeOutreach(message.input, { apiKey: configured.openAIApiKey, model: configured.openAIModel || "gpt-5.4-mini" });
    }
    if (message.type === "VELA_GTM_PROVIDER_PLAN_SEARCH") {
      return planProspectSearch(message.brief, { apiKey: configured.openAIApiKey, model: configured.openAIModel || "gpt-5.4-mini" });
    }
    if (message.type === "VELA_GTM_PROVIDER_RESEARCH_MESSAGE") {
      return respondToResearchMessage(message.message, {
        apiKey: configured.openAIApiKey,
        model: configured.openAIModel || "gpt-5.4-mini",
        history: message.history,
        pendingPlan: message.pendingPlan,
      });
    }
    if (message.type === "VELA_GTM_PROVIDER_VERIFY_TARGET") {
      return verifyTargetFit(message.input, { apiKey: configured.openAIApiKey, model: configured.openAIModel || "gpt-5.4-mini" });
    }
    if (message.type === "VELA_GTM_PROVIDER_PEOPLE_SEARCH") {
      return searchPeopleWithProviders(message.filters, configured);
    }
    throw new Error("Unknown Vela provider action.");
  })()
    .then(async (data) => {
      if (/CONTACTOUT_SESSION|PROVIDER_CONTACTOUT|PROVIDER_APOLLO/.test(message.type)) {
        await appendDiagnostic({
          area: "provider", stage: "background_message", outcome: "ok", provider: message.type.replace("VELA_GTM_PROVIDER_", "").replace("VELA_GTM_", ""),
          requiresReveal: Boolean(data?.requiresReveal), candidateCount: data?.candidateCounts?.email,
        });
      }
      sendResponse({ ok: true, data });
    })
    .catch(async (error) => {
      if (/CONTACTOUT_SESSION|PROVIDER_CONTACTOUT|PROVIDER_APOLLO/.test(message.type)) {
        await appendDiagnostic({
          area: "provider", stage: "background_message", outcome: "error", provider: message.type.replace("VELA_GTM_PROVIDER_", "").replace("VELA_GTM_", ""),
          code: error?.code, httpStatus: error?.status, message: error instanceof Error ? error.message : "Provider request failed.",
        });
      }
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Provider request failed.",
        code: typeof error?.code === "string" ? error.code : "",
        status: Number(error?.status) || 0,
      });
    });
  return true;
});

if (alarmsApi()?.onAlarm?.addListener) {
  alarmsApi().onAlarm.addListener((alarm) => {
    if (alarm.name === GMAIL_BOUNCE_ALARM) {
      syncGmailBounces().catch(() => {});
      return;
    }
    const id = jobIdFromAlarm(alarm.name);
    if (id) processScheduledJob(id);
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes[QUEUE_STORAGE_KEY] && !changes[CAMPAIGNS_STORAGE_KEY])) return;
  maintainWorkspaceBackup().catch((error) => console.error("Could not refresh the Vela workspace backup.", error));
});

chrome.runtime.onInstalled.addListener(() => {
  enablePersistentSidePanel().catch(() => {});
  maintainWorkspaceBackup().catch(() => {});
  restoreScheduledAlarms().catch(() => {});
  ensureBounceAlarm().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  maintainWorkspaceBackup().catch(() => {});
  restoreScheduledAlarms().catch(() => {});
  ensureBounceAlarm().catch(() => {});
});
