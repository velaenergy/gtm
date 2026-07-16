import { GMAIL_BOUNCE_QUERY, parseGmailBounce } from "./gmail-bounces.js";
import { GmailApiError, VELA_EVENT_HEADER, VELA_KIND_HEADER, VELA_TEMPLATE_HEADER } from "./gmail-send.js";

export { VELA_EVENT_HEADER, VELA_KIND_HEADER, VELA_TEMPLATE_HEADER } from "./gmail-send.js";

const GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";
const EMAIL_PATTERN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAX_BODY_LENGTH = 100_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gmailJson(url, token, { fetchImpl = globalThis.fetch, retries = 2 } = {}) {
  if (!token) throw new Error("A Gmail access token is required.");
  if (typeof fetchImpl !== "function") throw new Error("Gmail requests are unavailable.");
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= retries) throw new GmailApiError(payload.error?.message || `Gmail returned ${response.status}.`, response.status);
    const retryAfter = Number(response.headers?.get?.("Retry-After")) || 0;
    await sleep(Math.min(3_000, Math.max(250, retryAfter * 1_000 || 400 * (2 ** attempt))));
  }
}

function decodeBase64Url(value = "") {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return "";
  }
}

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function payloadParts(payload = {}, mimeType = "text/plain") {
  const parts = [];
  if (String(payload.mimeType || "").toLowerCase() === mimeType && payload.body?.data) parts.push(decodeBase64Url(payload.body.data));
  for (const child of Array.isArray(payload.parts) ? payload.parts : []) parts.push(...payloadParts(child, mimeType));
  return parts;
}

export function gmailMessageBody(payload = {}) {
  const plain = payloadParts(payload, "text/plain").filter(Boolean);
  const html = plain.length ? [] : payloadParts(payload, "text/html").filter(Boolean).map(stripHtml);
  const direct = !plain.length && !html.length && payload.body?.data ? decodeBase64Url(payload.body.data) : "";
  return [...plain, ...html, direct]
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_BODY_LENGTH);
}

function headerMap(headers = []) {
  return new Map((Array.isArray(headers) ? headers : []).map((header) => [String(header?.name || "").toLowerCase(), String(header?.value || "")]));
}

function emailsFromHeader(value = "") {
  return [...new Set((String(value || "").match(EMAIL_PATTERN) || []).map((email) => email.toLowerCase()))];
}

function normalizedComparable(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/{{[^}]+}}/g, " ")
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9@./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function templateFragments(template = {}) {
  return String(template.body || "")
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((part) => normalizedComparable(part))
    .filter((part) => part.length >= 26)
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
}

function normalizedTemplates(templates = {}) {
  return [
    ...(Array.isArray(templates.emailTemplates) ? templates.emailTemplates : []).map((template) => ({ ...template, kind: "initial" })),
    ...(Array.isArray(templates.followUpTemplates) ? templates.followUpTemplates : []).map((template) => ({ ...template, kind: "follow_up" })),
  ].map((template) => ({ ...template, id: String(template.id || ""), fragments: templateFragments(template), subjectComparable: normalizedComparable(template.subject || "") }))
    .filter((template) => template.id && template.fragments.length);
}

export function matchGtmTemplate(message = {}, templates = {}) {
  const headers = message.headers instanceof Map ? message.headers : headerMap(message.payload?.headers || []);
  const explicitTemplateId = String(headers.get(VELA_TEMPLATE_HEADER.toLowerCase()) || "").trim();
  const explicitKind = String(headers.get(VELA_KIND_HEADER.toLowerCase()) || "").trim();
  if (explicitTemplateId) return { templateId: explicitTemplateId, kind: explicitKind === "follow_up" ? "follow_up" : "initial", source: "vela_header" };

  const body = normalizedComparable(message.bodyText || gmailMessageBody(message.payload || {}));
  const subject = normalizedComparable(message.subject || headers.get("subject") || "");
  for (const template of normalizedTemplates(templates)) {
    const matchedFragments = template.fragments.filter((fragment) => body.includes(fragment));
    const required = template.fragments.length === 1 ? 1 : 2;
    const subjectMatches = !template.subjectComparable || subject.includes(template.subjectComparable) || template.subjectComparable.includes(subject);
    if (matchedFragments.length >= required || (matchedFragments[0]?.length >= 70 && subjectMatches)) {
      return { templateId: template.id, kind: template.kind, source: "template_fingerprint" };
    }
  }
  return null;
}

function maxHistoryId(current = "", candidate = "") {
  try { return BigInt(candidate || 0) > BigInt(current || 0) ? String(candidate) : String(current || ""); } catch { return String(candidate || current || ""); }
}

export function normalizeGmailMessage(message = {}, account = {}) {
  const headers = headerMap(message.payload?.headers || []);
  const from = emailsFromHeader(headers.get("from"));
  const to = emailsFromHeader(headers.get("to"));
  const cc = emailsFromHeader(headers.get("cc"));
  const accountEmail = String(account.email || "").trim().toLowerCase();
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds.map(String) : [];
  const outgoing = from.includes(accountEmail) || labelIds.includes("SENT");
  const system = /mailer-daemon|postmaster/i.test(headers.get("from") || "");
  const internalTimestamp = Number(message.internalDate);
  const headerTimestamp = Date.parse(headers.get("date") || "");
  const occurredTimestamp = internalTimestamp > 0 ? internalTimestamp : Number.isFinite(headerTimestamp) ? headerTimestamp : Date.now();
  return {
    id: String(message.id || ""),
    threadId: String(message.threadId || ""),
    historyId: String(message.historyId || ""),
    rfcMessageId: String(headers.get("message-id") || ""),
    inReplyTo: String(headers.get("in-reply-to") || ""),
    direction: system ? "system" : outgoing ? "outgoing" : "incoming",
    senderEmail: from[0] || accountEmail,
    recipientEmails: to,
    ccEmails: cc,
    subject: String(headers.get("subject") || "").slice(0, 2_000),
    bodyText: gmailMessageBody(message.payload || {}),
    snippet: String(message.snippet || "").slice(0, 2_000),
    occurredAt: new Date(occurredTimestamp).toISOString(),
    headers,
    labelIds,
    raw: message,
  };
}

function canonicalMessage(message, classification, account, overrides = {}) {
  return {
    gmailAccountId: String(account.id || ""),
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    gmailHistoryId: message.historyId,
    rfcMessageId: message.rfcMessageId,
    inReplyTo: message.inReplyTo,
    direction: overrides.direction || message.direction,
    messageKind: overrides.messageKind || classification.kind,
    templateId: overrides.templateId ?? classification.templateId ?? "",
    classificationSource: overrides.classificationSource || classification.source,
    senderEmail: message.senderEmail,
    recipientEmails: overrides.recipientEmails || message.recipientEmails,
    ccEmails: message.ccEmails,
    subject: overrides.subject ?? message.subject,
    bodyText: overrides.bodyText ?? message.bodyText,
    snippet: overrides.snippet ?? message.snippet,
    bounceType: overrides.bounceType || "",
    bounceReason: overrides.bounceReason || "",
    occurredAt: overrides.occurredAt || message.occurredAt,
    metadata: {
      label_ids: message.labelIds,
      ...(message.headers.get(VELA_EVENT_HEADER.toLowerCase()) ? { vela_event_id: message.headers.get(VELA_EVENT_HEADER.toLowerCase()) } : {}),
      ...(overrides.diagnostic ? { diagnostic: overrides.diagnostic } : {}),
    },
  };
}

export function gmailMessagesAsDeliveryRecords(messages = []) {
  return (Array.isArray(messages) ? messages : []).flatMap((message) => {
    if (message?.direction !== "outgoing" || !["initial", "follow_up"].includes(message.messageKind)) return [];
    const gmailMessageId = String(message.gmailMessageId || "");
    const gmailAccountId = String(message.gmailAccountId || "");
    const senderEmail = String(message.accountEmail || message.senderEmail || "").trim().toLowerCase();
    const recipients = [...new Set((Array.isArray(message.recipientEmails) ? message.recipientEmails : [])
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(Boolean))];
    if (!gmailMessageId || !senderEmail || !recipients.length) return [];
    return [{
      id: `gmail:${gmailAccountId || senderEmail}:${gmailMessageId}`,
      mode: "gmail_history",
      status: "sent",
      accountId: gmailAccountId,
      senderEmail,
      recipients,
      subject: String(message.subject || ""),
      kind: message.messageKind === "follow_up" ? "follow-up" : "initial",
      threadId: String(message.gmailThreadId || ""),
      gmailMessageId,
      completedAt: message.occurredAt || "",
      updatedAt: message.occurredAt || "",
      operatorId: String(message.operatorId || ""),
      operatorEmail: String(message.operatorEmail || "").trim().toLowerCase(),
      operatorName: String(message.operatorName || ""),
      operatorAvatarUrl: String(message.operatorAvatarUrl || ""),
      source: "gmail",
    }];
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function listMessagePage(token, { q = "", pageToken = "", fetchImpl } = {}) {
  const params = new URLSearchParams({ maxResults: "500", includeSpamTrash: "true" });
  if (q) params.set("q", q);
  if (pageToken) params.set("pageToken", pageToken);
  return gmailJson(`${GMAIL_API_ROOT}/messages?${params}`, token, { fetchImpl });
}

async function fullMessage(token, id, fetchImpl) {
  try {
    return await gmailJson(`${GMAIL_API_ROOT}/messages/${encodeURIComponent(id)}?format=full`, token, { fetchImpl });
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 404) return null;
    throw error;
  }
}

async function fullThread(token, id, fetchImpl) {
  try {
    return await gmailJson(`${GMAIL_API_ROOT}/threads/${encodeURIComponent(id)}?format=full`, token, { fetchImpl });
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 404) return { id, messages: [] };
    throw error;
  }
}

function knownIndex(records = []) {
  const messageIds = new Map();
  const threads = new Map();
  const recipients = new Map();
  const deliveries = [];
  for (const record of Array.isArray(records) ? records : []) {
    const templateId = String(record.templateId || "");
    const recordKind = record.messageKind || (record.kind === "follow-up" ? "follow_up" : "initial");
    const kind = recordKind === "follow_up" ? "follow_up" : "initial";
    const score = recordKind === "initial" ? 3 : recordKind === "follow_up" ? 2 : 1;
    const known = {
      templateId,
      kind,
      source: record.classificationSource || "delivery_ledger",
      rootMessageId: recordKind === "initial" ? String(record.gmailMessageId || "") : "",
      rootOccurredAt: recordKind === "initial" ? String(record.occurredAt || record.completedAt || record.updatedAt || "") : "",
      score,
    };
    if (record.gmailMessageId) messageIds.set(String(record.gmailMessageId), known);
    if (record.gmailThreadId || record.threadId) {
      const threadId = String(record.gmailThreadId || record.threadId);
      const current = threads.get(threadId);
      if (!current || score > current.score) threads.set(threadId, known);
    }
    if (["initial", "follow_up"].includes(recordKind)) {
      for (const recipient of record.recipientEmails || record.recipients || []) recipients.set(String(recipient).toLowerCase(), known);
      deliveries.push({
        ...known,
        subject: normalizedComparable(record.subject || ""),
        recipients: new Set((record.recipientEmails || record.recipients || []).map((email) => String(email).toLowerCase())),
        occurredAt: String(record.occurredAt || record.completedAt || record.updatedAt || ""),
      });
    }
  }
  return { messageIds, threads, recipients, deliveries };
}

function matchDeliveryRecord(message, deliveries = []) {
  const subject = normalizedComparable(message.subject);
  const occurredAt = Date.parse(message.occurredAt);
  return deliveries.find((delivery) => {
    if (!message.recipientEmails.some((recipient) => delivery.recipients.has(recipient))) return false;
    if (delivery.subject && subject && delivery.subject !== subject) return false;
    const expectedAt = Date.parse(delivery.occurredAt);
    return !Number.isFinite(expectedAt) || !Number.isFinite(occurredAt) || Math.abs(expectedAt - occurredAt) <= 15 * 60_000;
  }) || null;
}

async function scanMessageQuery(token, query, { fetchImpl, onPage } = {}) {
  let pageToken = "";
  let scanned = 0;
  let latestHistoryId = "";
  do {
    const page = await listMessagePage(token, { q: query, pageToken, fetchImpl });
    const refs = Array.isArray(page.messages) ? page.messages : [];
    const messages = (await mapWithConcurrency(refs, 8, (ref) => fullMessage(token, ref.id, fetchImpl))).filter(Boolean);
    scanned += messages.length;
    for (const message of messages) latestHistoryId = maxHistoryId(latestHistoryId, message.historyId);
    await onPage(messages, { scanned, resultSizeEstimate: Number(page.resultSizeEstimate) || scanned });
    pageToken = String(page.nextPageToken || "");
  } while (pageToken);
  return { scanned, latestHistoryId };
}

function classifyThreadMessage(message, root, account) {
  if (root.rootOccurredAt && message.id !== root.rootMessageId && Date.parse(message.occurredAt) < Date.parse(root.rootOccurredAt)) return null;
  const bounce = parseGmailBounce(message.raw, { senderEmail: account.email });
  if (bounce.length) {
    return canonicalMessage(message, root, account, {
      direction: "system",
      messageKind: "bounce",
      classificationSource: "bounce_notice",
      recipientEmails: bounce.map((item) => item.recipient),
      bounceType: bounce[0].type,
      bounceReason: bounce[0].reason,
      occurredAt: bounce[0].occurredAt,
      bodyText: bounce.map((item) => `${item.label}: ${item.diagnostic}`).join("\n"),
      diagnostic: bounce.map((item) => item.diagnostic).join(" | "),
    });
  }
  if (message.direction === "incoming") return canonicalMessage(message, root, account, { messageKind: "reply", classificationSource: "thread_reply" });
  if (message.direction === "outgoing") {
    const explicitKind = String(message.headers.get(VELA_KIND_HEADER.toLowerCase()) || "");
    return canonicalMessage(message, root, account, { messageKind: explicitKind === "initial" ? "initial" : message.id === root.rootMessageId ? root.kind : "follow_up", classificationSource: message.id === root.rootMessageId ? root.source : "thread_reply" });
  }
  return null;
}

export async function scanFullGtmMailbox(token, { account = {}, templates = {}, knownRecords = [], persistBatch = async () => {}, onProgress = async () => {}, fetchImpl = globalThis.fetch } = {}) {
  if (!account.id || !account.email) throw new Error("A connected Gmail account is required for GTM sync.");
  const known = knownIndex(knownRecords);
  const roots = new Map(known.threads);
  const recipientTemplates = new Map(known.recipients);
  const found = new Map();
  const scannedMessageIds = new Set();
  let latestHistoryId = "";

  const sentScan = await scanMessageQuery(token, "in:sent", {
    fetchImpl,
    onPage: async (rawMessages, progress) => {
      const pageMatches = [];
      for (const raw of rawMessages) {
        scannedMessageIds.add(String(raw.id || ""));
        const message = normalizeGmailMessage(raw, account);
        const matched = known.messageIds.get(message.id) || matchDeliveryRecord(message, known.deliveries) || matchGtmTemplate(message, templates) || { templateId: "", kind: "initial", source: "sent_mailbox" };
        const candidateRoot = { ...matched, kind: "initial", rootMessageId: message.id, rootOccurredAt: message.occurredAt, score: 3 };
        const currentRoot = roots.get(message.threadId);
        const candidateAt = Date.parse(candidateRoot.rootOccurredAt);
        const currentAt = Date.parse(currentRoot?.rootOccurredAt || "");
        const root = !currentRoot || !Number.isFinite(currentAt) || (Number.isFinite(candidateAt) && candidateAt < currentAt)
          ? candidateRoot
          : currentRoot;
        roots.set(message.threadId, root);
        for (const recipient of message.recipientEmails) recipientTemplates.set(recipient, root);
        const canonical = canonicalMessage(message, matched, account, {
          messageKind: message.id === root.rootMessageId ? "initial" : "follow_up",
          classificationSource: matched.source,
        });
        found.set(message.id, canonical);
        pageMatches.push(canonical);
      }
      if (pageMatches.length) await persistBatch(pageMatches);
      await onProgress({ phase: "sent", ...progress, gtmMessagesFound: found.size });
    },
  });
  latestHistoryId = maxHistoryId(latestHistoryId, sentScan.latestHistoryId);

  const threadEntries = [...roots.entries()];
  const threadBatchSize = 25;
  for (let offset = 0; offset < threadEntries.length; offset += threadBatchSize) {
    const entries = threadEntries.slice(offset, offset + threadBatchSize);
    const threads = await mapWithConcurrency(entries, 5, async ([threadId, root], index) => {
      const thread = await fullThread(token, threadId, fetchImpl);
      await onProgress({ phase: "threads", scanned: offset + index + 1, resultSizeEstimate: threadEntries.length, gtmMessagesFound: found.size });
      return { root, thread };
    });
    for (const { root, thread } of threads) {
      const batch = [];
      for (const raw of Array.isArray(thread.messages) ? thread.messages : []) {
        scannedMessageIds.add(String(raw.id || ""));
        const message = normalizeGmailMessage(raw, account);
        latestHistoryId = maxHistoryId(latestHistoryId, message.historyId);
        const canonical = classifyThreadMessage(message, root, account);
        if (!canonical) continue;
        found.set(message.id, canonical);
        batch.push(canonical);
        if (canonical.direction === "outgoing") {
          for (const recipient of canonical.recipientEmails) recipientTemplates.set(String(recipient).toLowerCase(), root);
        }
      }
      if (batch.length) await persistBatch(batch);
    }
  }

  const bounceScan = await scanMessageQuery(token, GMAIL_BOUNCE_QUERY.replace("newer_than:90d ", ""), {
    fetchImpl,
    onPage: async (rawMessages, progress) => {
      const batch = [];
      for (const raw of rawMessages) {
        scannedMessageIds.add(String(raw.id || ""));
        const parsed = parseGmailBounce(raw, { senderEmail: account.email });
        const relevant = parsed.filter((bounce) => recipientTemplates.has(bounce.recipient));
        if (!relevant.length) continue;
        const message = normalizeGmailMessage(raw, account);
        const root = recipientTemplates.get(relevant[0].recipient) || { templateId: "", kind: "initial", source: "bounce_notice" };
        const canonical = canonicalMessage(message, root, account, {
          direction: "system",
          messageKind: "bounce",
          classificationSource: "bounce_notice",
          recipientEmails: relevant.map((bounce) => bounce.recipient),
          bounceType: relevant[0].type,
          bounceReason: relevant[0].reason,
          occurredAt: relevant[0].occurredAt,
          bodyText: relevant.map((bounce) => `${bounce.label}: ${bounce.diagnostic}`).join("\n"),
          diagnostic: relevant.map((bounce) => bounce.diagnostic).join(" | "),
        });
        found.set(message.id, canonical);
        batch.push(canonical);
      }
      if (batch.length) await persistBatch(batch);
      await onProgress({ phase: "bounces", ...progress, gtmMessagesFound: found.size });
    },
  });
  latestHistoryId = maxHistoryId(latestHistoryId, bounceScan.latestHistoryId);

  const messages = [...found.values()];
  return {
    messagesScanned: scannedMessageIds.size,
    gtmMessagesFound: messages.length,
    sentMessagesFound: messages.filter((message) => message.direction === "outgoing").length,
    threadsFound: new Set(messages.map((message) => message.gmailThreadId)).size,
    repliesFound: messages.filter((message) => message.messageKind === "reply").length,
    bouncesFound: messages.filter((message) => message.messageKind === "bounce").length,
    latestHistoryId,
    messages,
  };
}

export async function scanIncrementalGtmMailbox(token, { account = {}, startHistoryId = "", templates = {}, knownRecords = [], persistBatch = async () => {}, fetchImpl = globalThis.fetch } = {}) {
  if (!startHistoryId) throw new Error("A Gmail history cursor is required for incremental sync.");
  const known = knownIndex(knownRecords);
  const refs = new Map();
  let pageToken = "";
  let latestHistoryId = String(startHistoryId);
  do {
    const params = new URLSearchParams({ startHistoryId: String(startHistoryId), maxResults: "500", historyTypes: "messageAdded" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gmailJson(`${GMAIL_API_ROOT}/history?${params}`, token, { fetchImpl });
    latestHistoryId = maxHistoryId(latestHistoryId, page.historyId);
    for (const history of Array.isArray(page.history) ? page.history : []) {
      for (const added of Array.isArray(history.messagesAdded) ? history.messagesAdded : []) {
        if (added.message?.id) refs.set(String(added.message.id), added.message);
      }
    }
    pageToken = String(page.nextPageToken || "");
  } while (pageToken);

  const rawMessages = (await mapWithConcurrency([...refs.values()], 8, (ref) => fullMessage(token, ref.id, fetchImpl))).filter(Boolean);
  const normalized = rawMessages.map((message) => normalizeGmailMessage(message, account));
  for (const message of normalized) {
    const matched = known.messageIds.get(message.id) || (message.direction === "outgoing" ? matchDeliveryRecord(message, known.deliveries) || matchGtmTemplate(message, templates) || { templateId: "", kind: "initial", source: "sent_mailbox" } : null);
    if (matched) known.threads.set(message.threadId, { ...matched, rootMessageId: message.id, rootOccurredAt: message.occurredAt, score: 3 });
  }
  const messages = [];
  for (const message of normalized) {
    const parsedBounces = parseGmailBounce(message.raw, { senderEmail: account.email });
    const relevantBounces = parsedBounces.filter((bounce) => known.recipients.has(bounce.recipient));
    if (relevantBounces.length) {
      const root = known.recipients.get(relevantBounces[0].recipient) || { templateId: "", kind: "initial", source: "bounce_notice" };
      messages.push(canonicalMessage(message, root, account, {
        direction: "system",
        messageKind: "bounce",
        classificationSource: "bounce_notice",
        recipientEmails: relevantBounces.map((bounce) => bounce.recipient),
        bounceType: relevantBounces[0].type,
        bounceReason: relevantBounces[0].reason,
        occurredAt: relevantBounces[0].occurredAt,
        bodyText: relevantBounces.map((bounce) => `${bounce.label}: ${bounce.diagnostic}`).join("\n"),
        diagnostic: relevantBounces.map((bounce) => bounce.diagnostic).join(" | "),
      }));
      continue;
    }
    const root = known.threads.get(message.threadId);
    if (!root) continue;
    const canonical = classifyThreadMessage(message, root, account);
    if (canonical) messages.push(canonical);
  }
  if (messages.length) await persistBatch(messages);
  return {
    messagesScanned: rawMessages.length,
    gtmMessagesFound: messages.length,
    sentMessagesFound: messages.filter((message) => message.direction === "outgoing").length,
    threadsFound: new Set(messages.map((message) => message.gmailThreadId)).size,
    repliesFound: messages.filter((message) => message.messageKind === "reply").length,
    bouncesFound: messages.filter((message) => message.messageKind === "bounce").length,
    latestHistoryId,
    messages,
  };
}
