import { cleanText, isEmail } from "./message.js";

export const DELIVERY_LOG_STORAGE_KEY = "velaGtmDeliveryLog";

export const DELIVERY_STATUS = Object.freeze({
  SCHEDULED: "scheduled",
  SENT: "sent",
  PARTIAL: "partial",
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
    mode: input.mode === "scheduled" || input.scheduledAt ? "scheduled" : "immediate",
    status: Object.values(DELIVERY_STATUS).includes(input.status) ? input.status : DELIVERY_STATUS.SENT,
    prospectId: String(input.prospectId || ""),
    senderEmail: String(input.senderEmail || "").trim().toLowerCase(),
    recipients,
    subject: cleanText(input.subject),
    scheduledAt: input.scheduledAt || "",
    createdAt,
    completedAt: input.completedAt || "",
    updatedAt: input.updatedAt || input.completedAt || createdAt,
    error: cleanText(input.error),
  };
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
