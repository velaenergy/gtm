import { cleanText, isEmail } from "./message.js";

export const DELIVERY_LOG_STORAGE_KEY = "velaGtmDeliveryLog";

export const DELIVERY_STATUS = Object.freeze({
  SCHEDULED: "scheduled",
  SENT: "sent",
  PARTIAL: "partial",
  BOUNCED: "bounced",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

function deliveryId(value = "", now = new Date()) {
  return String(value || globalThis.crypto?.randomUUID?.() || `${now.getTime()}-${Math.random().toString(36).slice(2, 9)}`);
}

export function normalizeDeliveryRecord(input = {}, now = new Date()) {
  const recipients = [...new Set((Array.isArray(input.recipients) ? input.recipients : [])
    .map((value) => String(value).trim().toLowerCase())
    .filter(isEmail))];
  const createdAt = input.createdAt || now.toISOString();
  return {
    id: deliveryId(input.id, now),
    mode: input.mode === "inbox" ? "inbox" : input.mode === "imported" ? "imported" : input.mode === "scheduled" || input.scheduledAt ? "scheduled" : "immediate",
    status: Object.values(DELIVERY_STATUS).includes(input.status) ? input.status : DELIVERY_STATUS.SENT,
    prospectId: String(input.prospectId || ""),
    accountId: String(input.accountId || ""),
    senderEmail: String(input.senderEmail || "").trim().toLowerCase(),
    operatorId: String(input.operatorId || ""),
    operatorEmail: String(input.operatorEmail || "").trim().toLowerCase(),
    operatorName: cleanText(input.operatorName),
    operatorAvatarUrl: String(input.operatorAvatarUrl || ""),
    recipients,
    subject: cleanText(input.subject),
    kind: input.kind === "follow-up" ? "follow-up" : "initial",
    sequenceId: String(input.sequenceId || ""),
    sequenceStep: Math.max(0, Number(input.sequenceStep) || 0),
    templateId: String(input.templateId || ""),
    threadId: String(input.threadId || ""),
    gmailMessageId: String(input.gmailMessageId || ""),
    bounceReason: String(input.bounceReason || ""),
    bounceType: input.bounceType === "soft" ? "soft" : input.bounceType === "hard" ? "hard" : "",
    scheduledAt: input.scheduledAt || "",
    createdAt,
    completedAt: input.completedAt || "",
    updatedAt: input.updatedAt || input.completedAt || createdAt,
    error: cleanText(input.error),
  };
}

export function deliveryModeLabel(record = {}) {
  if (record.kind === "follow-up") return `Follow-up ${Math.max(0, Number(record.sequenceStep) || 0) || ""}`.trim();
  if (record.mode === "gmail_history") return "Gmail history";
  if (record.mode === "imported") return "Imported from list";
  if (record.mode === "scheduled") return "Scheduled send";
  if (record.mode === "inbox") return "Inbox signal";
  return "Direct send";
}

export function normalizeDeliveryLog(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((record) => normalizeDeliveryRecord(record, new Date(record?.createdAt || Date.now())))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function upsertDeliveryRecord(existing = [], input = {}, now = new Date()) {
  const next = normalizeDeliveryRecord(input, now);
  const records = normalizeDeliveryLog(existing);
  const current = records.find((record) => record.id === next.id);
  const merged = current ? { ...current, ...next, createdAt: current.createdAt } : next;
  return [merged, ...records.filter((record) => record.id !== next.id)]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
