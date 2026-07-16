export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const VELA_TEMPLATE_HEADER = "X-Vela-GTM-Template-ID";
export const VELA_EVENT_HEADER = "X-Vela-GTM-Event-ID";
export const VELA_KIND_HEADER = "X-Vela-GTM-Message-Kind";

const EMAIL_LOCAL_PART = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const EMAIL_DOMAIN = /^(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i;

function safeHeader(value = "", label = "Header") {
  const raw = String(value);
  if (/[\r\n]/.test(raw)) throw new Error(`${label} cannot contain line breaks.`);
  return raw.trim();
}

export function recipientEmail(value = "") {
  const recipient = safeHeader(value, "Recipient email").toLowerCase();
  const parts = recipient.split("@");
  const local = parts[0] || "";
  const domain = parts[1] || "";
  const validLocal = EMAIL_LOCAL_PART.test(local) && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
  if (parts.length !== 2 || !validLocal || !EMAIL_DOMAIN.test(domain)) throw new Error("Choose a valid recipient email address.");
  return recipient;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64UrlEncode(value = "") {
  return bytesToBase64(new TextEncoder().encode(String(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function encodeMimeHeader(value = "") {
  const clean = safeHeader(value, "Subject");
  return /^[\x20-\x7E]*$/.test(clean) ? clean : `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(clean))}?=`;
}

export function buildMimeMessage({
  to = "",
  subject = "",
  body = "",
  messageId = "",
  replyToMessageId = "",
  templateId = "",
  eventId = "",
  messageKind = "",
} = {}) {
  const recipient = recipientEmail(to);
  const normalizedBody = String(body).replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
  if (!String(subject).trim()) throw new Error("Add a subject before sending.");
  if (!normalizedBody.trim()) throw new Error("Add a message before sending.");
  const headers = [
    `To: ${recipient}`,
    `Subject: ${encodeMimeHeader(subject)}`,
  ];
  if (messageId) headers.push(`Message-ID: ${safeHeader(messageId, "Message-ID")}`);
  if (replyToMessageId) {
    const reference = safeHeader(replyToMessageId, "Reply reference");
    headers.push(`In-Reply-To: ${reference}`, `References: ${reference}`);
  }
  if (templateId) headers.push(`${VELA_TEMPLATE_HEADER}: ${safeHeader(templateId, "Template ID")}`);
  if (eventId) headers.push(`${VELA_EVENT_HEADER}: ${safeHeader(eventId, "Event ID")}`);
  if (messageKind) {
    const kind = safeHeader(messageKind, "Message kind");
    if (!["initial", "follow_up"].includes(kind)) throw new Error("Message kind must be initial or follow_up.");
    headers.push(`${VELA_KIND_HEADER}: ${kind}`);
  }
  return [
    ...headers,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizedBody,
  ].join("\r\n");
}

export function gmailSendPayload(message = {}) {
  const payload = { raw: base64UrlEncode(buildMimeMessage(message)) };
  if (message.threadId) payload.threadId = String(message.threadId);
  return payload;
}

export class GmailApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
  }
}

async function gmailRequest(url, token, options = {}, fetchImpl = globalThis.fetch) {
  if (!token) throw new Error("A Gmail access token is required.");
  if (typeof fetchImpl !== "function") throw new Error("Gmail requests are unavailable.");
  const response = await fetchImpl(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new GmailApiError(payload.error?.message || `Gmail returned ${response.status}.`, response.status);
  return payload;
}

export async function sendGmailMessage(token, message, { fetchImpl = globalThis.fetch } = {}) {
  const payload = await gmailRequest(GMAIL_SEND_API_URL, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(gmailSendPayload(message)),
  }, fetchImpl);
  return { id: payload.id || "sent", threadId: payload.threadId || "" };
}

export async function gmailThreadHasReply(token, { threadId = "", senderEmail = "", sentAt = "" } = {}, { fetchImpl = globalThis.fetch } = {}) {
  if (!threadId) return false;
  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "From");
  const thread = await gmailRequest(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?${params}`, token, {}, fetchImpl);
  const sender = String(senderEmail).trim().toLowerCase();
  const threshold = Date.parse(sentAt || "") || 0;
  return (thread.messages || []).some((message) => {
    if (Number(message.internalDate || 0) <= threshold) return false;
    const from = (message.payload?.headers || []).find((header) => String(header.name).toLowerCase() === "from")?.value || "";
    const email = from.match(/<([^>]+)>/)?.[1] || from;
    return email.trim().toLowerCase() && email.trim().toLowerCase() !== sender;
  });
}

export function uniqueRecipients(recipients = []) {
  return [...new Set((Array.isArray(recipients) ? recipients : [recipients]).map(recipientEmail))];
}
