import { GmailApiError } from "./gmail-send.js";

export const GMAIL_BOUNCE_QUERY = 'in:anywhere newer_than:90d {from:(mailer-daemon) from:(postmaster) subject:("Delivery Status Notification (Failure)") subject:(Undeliverable) subject:("Mail delivery failed")}';

const EMAIL_PATTERN = "[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\\.[A-Z]{2,}";
const RECIPIENT_PATTERNS = [
  new RegExp(`(?:Final-Recipient|Original-Recipient):\\s*(?:rfc822;)?\\s*<?(${EMAIL_PATTERN})>?`, "gi"),
  new RegExp(`X-Failed-Recipients:\\s*<?(${EMAIL_PATTERN})>?`, "gi"),
  new RegExp(`(?:wasn't delivered to|could not be delivered to|undeliverable to)\\s*<?(${EMAIL_PATTERN})>?`, "gi"),
  new RegExp(`Recipient address rejected(?::|\\s)+<?(${EMAIL_PATTERN})>?`, "gi"),
  new RegExp(`<?(${EMAIL_PATTERN})>?\\s+(?:wasn't found|does not exist|is over quota|has a full mailbox)`, "gi"),
];

function headerValue(headers = [], name = "") {
  return (Array.isArray(headers) ? headers : []).find((header) => String(header?.name || "").toLowerCase() === name.toLowerCase())?.value || "";
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

function payloadText(payload = {}) {
  const own = decodeBase64Url(payload.body?.data || "");
  const nested = (Array.isArray(payload.parts) ? payload.parts : []).map(payloadText).filter(Boolean);
  return [own, ...nested].filter(Boolean).join("\n");
}

function isBounceNotification(message = {}, text = "") {
  const headers = message.payload?.headers || [];
  const from = headerValue(headers, "From");
  const subject = headerValue(headers, "Subject");
  const mimeType = String(message.payload?.mimeType || "");
  return /mailer-daemon|postmaster/i.test(from)
    || /delivery status notification|undeliverable|mail delivery failed|returned mail/i.test(subject)
    || /message\/delivery-status/i.test(`${mimeType}\n${text}`);
}

function bounceClassification(text = "") {
  if (/mailbox (?:is )?full|over quota|quota exceeded|5\.2\.2/i.test(text)) {
    return { reason: "mailbox_full", type: "soft", label: "Mailbox full" };
  }
  if (/temporar(?:y|ily)|try again later|4\.[0-9]\.[0-9]|\b4\d\d\b/i.test(text)) {
    return { reason: "temporary_failure", type: "soft", label: "Temporary failure" };
  }
  if (/domain (?:does not exist|not found)|no such domain|dns|5\.1\.2/i.test(text)) {
    return { reason: "domain_failure", type: "hard", label: "Domain not found" };
  }
  if (/blocked|policy|spam|not permitted|access denied|5\.7\.[0-9]/i.test(text)) {
    return { reason: "policy_blocked", type: "hard", label: "Blocked by recipient" };
  }
  if (/5\.1\.1|address (?:not found|rejected)|unknown user|no such user|does not exist|wasn't found/i.test(text)) {
    return { reason: "recipient_not_found", type: "hard", label: "Address not found" };
  }
  return { reason: "delivery_failed", type: "hard", label: "Delivery failed" };
}

function diagnosticSummary(text = "", fallback = "Delivery failed") {
  const line = String(text || "").split(/\r?\n/).map((value) => value.trim()).find((value) => /(?:Diagnostic-Code|\b[45]\d\d\b|wasn't delivered|undeliverable|not found|mailbox|blocked)/i.test(value));
  return (line || fallback).replace(/^Diagnostic-Code:\s*/i, "").slice(0, 280);
}

export function parseGmailBounce(message = {}, { senderEmail = "" } = {}) {
  const headers = message.payload?.headers || [];
  const text = [
    headerValue(headers, "X-Failed-Recipients") ? `X-Failed-Recipients: ${headerValue(headers, "X-Failed-Recipients")}` : "",
    payloadText(message.payload || {}),
    message.snippet || "",
  ].filter(Boolean).join("\n");
  if (!isBounceNotification(message, text)) return [];

  const recipients = new Set();
  for (const pattern of RECIPIENT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) recipients.add(String(match[1] || "").trim().toLowerCase());
  }
  recipients.delete(String(senderEmail || "").trim().toLowerCase());
  if (!recipients.size) return [];

  const classification = bounceClassification(text);
  const occurredAt = Number(message.internalDate) > 0 ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString();
  const diagnostic = diagnosticSummary(text, classification.label);
  return [...recipients].map((recipient) => ({
    gmailMessageId: String(message.id || ""),
    gmailThreadId: String(message.threadId || ""),
    recipient,
    occurredAt,
    diagnostic,
    ...classification,
  }));
}

async function gmailJson(url, token, fetchImpl) {
  if (!token) throw new Error("A Gmail access token is required.");
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new GmailApiError(payload.error?.message || `Gmail returned ${response.status}.`, response.status);
  return payload;
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

export async function listGmailBounces(token, { senderEmail = "", maxResults = 100, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Gmail requests are unavailable.");
  const params = new URLSearchParams({ q: GMAIL_BOUNCE_QUERY, maxResults: String(Math.min(100, Math.max(1, Number(maxResults) || 100))) });
  const listed = await gmailJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, token, fetchImpl);
  const messages = Array.isArray(listed.messages) ? listed.messages : [];
  const details = await mapWithConcurrency(messages, 6, (message) => gmailJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=full`,
    token,
    fetchImpl,
  ));
  return details.flatMap((message) => parseGmailBounce(message, { senderEmail }));
}
