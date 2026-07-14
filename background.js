import { contactOutAccountStatus, enrichViaContactOut, peopleSearch } from "./lib/contactout.js";
import { writeOutreach } from "./server/openai-writer.mjs";
import { planProspectSearch } from "./server/search-planner.mjs";
import { apolloAccountStatus, enrichViaApollo, peopleSearchViaApollo } from "./lib/apollo.js";
import {
  contactOutSessionStatus,
  openContactOutSessionLogin,
  previewContactOutSession,
  revealContactOutSession,
} from "./lib/contactout-session.js";
import { PROVIDER, preferredSearchProvider } from "./lib/provider-priority.js";
import { appendDiagnostic } from "./lib/diagnostics.js";
import {
  GOOGLE_ACCOUNT_AUTH_MODE,
  GOOGLE_ACCOUNTS_STORAGE_KEY,
  GOOGLE_ACCOUNT_STORAGE_KEY,
  getGoogleAuthToken,
  getGoogleWebAuthToken,
  googleAccountById,
  googleOAuthStrategy,
} from "./lib/google-auth.js";
import { GMAIL_SEND_SCOPE, GmailApiError, buildMimeMessage, sendGmailMessage, uniqueRecipients } from "./lib/gmail-send.js";
import {
  SCHEDULED_SENDS_STORAGE_KEY,
  alarmNameForJob,
  createScheduledSend,
  jobIdFromAlarm,
  normalizeScheduledSends,
} from "./lib/schedule.js";
import { QUEUE_STATUS, QUEUE_STORAGE_KEY, withActivity } from "./lib/queue.js";
import {
  DELIVERY_LOG_STORAGE_KEY,
  DELIVERY_STATUS,
  upsertDeliveryRecord,
} from "./lib/delivery-ledger.js";

async function enablePersistentSidePanel() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

enablePersistentSidePanel().catch((error) => console.error("Could not enable the Vela side panel.", error));

async function settings() {
  const stored = await chrome.storage.local.get("velaGtmSettings");
  return stored.velaGtmSettings || {};
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
  const manifest = chrome.runtime.getManifest();
  const strategy = googleOAuthStrategy({ manifest, webClientId: configured.googleWebClientId });
  const account = await savedGoogleAccount(expectedAccountId);
  if (strategy === GOOGLE_ACCOUNT_AUTH_MODE) {
    if (account.authMode !== GOOGLE_ACCOUNT_AUTH_MODE) throw new Error("Google delivery configuration changed. Reconnect the Gmail sender in Settings.");
    const token = await getGoogleWebAuthToken({
      identity: chrome.identity,
      clientId: configured.googleWebClientId,
      scopes: [GMAIL_SEND_SCOPE],
      expectedEmail: account.email,
      interactive,
    });
    return { token, account };
  }
  if (!strategy) throw new Error("Google delivery OAuth is not configured in manifest.json.");
  if (account.authMode === GOOGLE_ACCOUNT_AUTH_MODE) throw new Error("Google delivery configuration changed. Reconnect the Gmail sender in Settings.");
  const currentProfile = await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
  if (String(currentProfile?.id || "") !== account.id || String(currentProfile?.email || "").trim().toLowerCase() !== account.email) {
    throw new Error("Chrome is signed in with a different Gmail sender. Reconnect the selected account in Settings.");
  }
  const token = await getGoogleAuthToken({
    identity: chrome.identity,
    manifest,
    scopes: [GMAIL_SEND_SCOPE],
    interactive,
  });
  return { token, account };
}

async function recordDelivery(input = {}) {
  const saved = await chrome.storage.local.get(DELIVERY_LOG_STORAGE_KEY);
  const records = upsertDeliveryRecord(saved[DELIVERY_LOG_STORAGE_KEY], input);
  await chrome.storage.local.set({ [DELIVERY_LOG_STORAGE_KEY]: records });
  return records[0];
}

async function sendDelivery(input = {}) {
  const recipients = uniqueRecipients(input.recipients);
  if (!recipients.length) throw new Error("Select at least one verified recipient.");
  for (const recipient of recipients) buildMimeMessage({ to: recipient, subject: input.subject, body: input.body });
  if (!input.accountId) throw new Error("Connect and choose a Gmail sender in Settings.");

  let authorization = await gmailToken(false, input.accountId);
  let { token } = authorization;
  const deliveryInput = { ...input, senderEmail: authorization.account.email };
  let refreshAttempted = false;
  const sent = [];
  const failed = [];
  for (const recipient of recipients) {
    try {
      let result;
      try {
        result = await sendGmailMessage(token, { to: recipient, subject: input.subject, body: input.body });
      } catch (error) {
        if (!(error instanceof GmailApiError) || error.status !== 401 || refreshAttempted) throw error;
        refreshAttempted = true;
        await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
        authorization = await gmailToken(false, input.accountId);
        token = authorization.token;
        result = await sendGmailMessage(token, { to: recipient, subject: input.subject, body: input.body });
      }
      sent.push({ recipient, ...result });
    } catch (error) {
      failed.push({ recipient, error: error instanceof Error ? error.message : "Gmail send failed." });
    }
  }
  const completedAt = new Date().toISOString();
  const deliveryId = input.id || crypto.randomUUID();
  const status = !sent.length ? DELIVERY_STATUS.FAILED : failed.length ? DELIVERY_STATUS.PARTIAL : DELIVERY_STATUS.SENT;
  await recordDelivery({
    ...deliveryInput,
    id: deliveryId,
    mode: input.scheduledAt ? "scheduled" : "immediate",
    status,
    completedAt,
    updatedAt: completedAt,
    error: failed.map((item) => `${item.recipient}: ${item.error}`).join("; "),
  });
  if (!sent.length) throw new Error(failed[0]?.error || "Gmail did not send the message.");
  await recordProspectDelivery(
    input.prospectId,
    failed.length ? "send_partial" : "sent",
    failed.length ? `Sent to ${sent.length}; ${failed.length} failed` : `Sent via Gmail to ${sent.length} verified address${sent.length === 1 ? "" : "es"}`,
    { sent: failed.length === 0 },
  );
  return { deliveryId, sent, failed };
}

async function scheduleDelivery(input = {}) {
  const recipients = uniqueRecipients(input.recipients);
  for (const recipient of recipients) buildMimeMessage({ to: recipient, subject: input.subject, body: input.body });
  if (!input.accountId) throw new Error("Connect and choose a Gmail sender in Settings.");
  const account = await savedGoogleAccount(input.accountId);
  const job = createScheduledSend({ ...input, senderEmail: account.email, recipients });
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const jobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]);
  await chrome.storage.local.set({ [SCHEDULED_SENDS_STORAGE_KEY]: [...jobs, job].slice(-100) });
  await chrome.alarms.create(alarmNameForJob(job.id), { when: new Date(job.scheduledAt).getTime() });
  await recordDelivery({ ...job, mode: "scheduled", status: DELIVERY_STATUS.SCHEDULED, updatedAt: job.createdAt });
  await recordProspectDelivery(job.prospectId, "scheduled", `Gmail send scheduled for ${job.scheduledAt}`);
  return job;
}

async function updateScheduledJob(id, updates) {
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const jobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]);
  await chrome.storage.local.set({
    [SCHEDULED_SENDS_STORAGE_KEY]: jobs.map((job) => job.id === id ? { ...job, ...updates } : job),
  });
}

async function processScheduledJob(id) {
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const job = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]).find((item) => item.id === id);
  if (!job || job.status !== "scheduled") return;
  try {
    const result = await sendDelivery(job);
    const completedAt = new Date().toISOString();
    await updateScheduledJob(id, { status: result.failed.length ? "partial" : "sent", error: result.failed.map((item) => item.error).join("; "), completedAt });
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Scheduled Gmail send failed.";
    await updateScheduledJob(id, { status: "failed", error: message, completedAt });
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
  await chrome.alarms.clear(alarmNameForJob(id));
  await updateScheduledJob(id, { status: DELIVERY_STATUS.CANCELLED, completedAt });
  await recordDelivery({ ...job, status: DELIVERY_STATUS.CANCELLED, completedAt, updatedAt: completedAt });
  await recordProspectDelivery(job.prospectId, "schedule_cancelled", "Scheduled Gmail send cancelled", { at: completedAt });
  return { id, status: DELIVERY_STATUS.CANCELLED };
}

async function restoreScheduledAlarms() {
  const saved = await chrome.storage.local.get(SCHEDULED_SENDS_STORAGE_KEY);
  const jobs = normalizeScheduledSends(saved[SCHEDULED_SENDS_STORAGE_KEY]).filter((job) => job.status === "scheduled");
  const alarms = new Set((await chrome.alarms.getAll()).map((alarm) => alarm.name));
  for (const job of jobs) {
    const name = alarmNameForJob(job.id);
    if (!alarms.has(name)) await chrome.alarms.create(name, { when: Math.max(Date.parse(job.scheduledAt), Date.now() + 250) });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const supported = message?.type?.startsWith("VELA_GTM_PROVIDER_")
    || message?.type?.startsWith("VELA_GTM_CONTACTOUT_SESSION_")
    || ["VELA_GTM_EMAIL_SEND", "VELA_GTM_EMAIL_SCHEDULE", "VELA_GTM_EMAIL_SCHEDULE_CANCEL"].includes(message?.type);
  if (!supported) return false;
  (async () => {
    if (message.type === "VELA_GTM_EMAIL_SEND") return sendDelivery(message.delivery);
    if (message.type === "VELA_GTM_EMAIL_SCHEDULE") return scheduleDelivery(message.delivery);
    if (message.type === "VELA_GTM_EMAIL_SCHEDULE_CANCEL") return cancelScheduledJob(message.id);
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
    if (message.type === "VELA_GTM_PROVIDER_PEOPLE_SEARCH") {
      return preferredSearchProvider(configured) === PROVIDER.CONTACTOUT
        ? peopleSearch(message.filters, { apiKey: configured.contactOutApiKey })
        : peopleSearchViaApollo(message.filters, { apiKey: configured.apolloApiKey });
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

chrome.alarms.onAlarm.addListener((alarm) => {
  const id = jobIdFromAlarm(alarm.name);
  if (id) processScheduledJob(id);
});

chrome.runtime.onInstalled.addListener(() => {
  enablePersistentSidePanel().catch(() => {});
  restoreScheduledAlarms();
});
chrome.runtime.onStartup.addListener(() => {
  enablePersistentSidePanel().catch(() => {});
  restoreScheduledAlarms();
});
