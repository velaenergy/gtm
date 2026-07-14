export const DELIVERY_SETTINGS_KEY = "velaGtmDeliverySettings";
export const SCHEDULED_SENDS_STORAGE_KEY = "velaGtmScheduledSends";
export const SCHEDULE_ALARM_PREFIX = "vela-gtm-send:";

export const DEFAULT_DELIVERY_SETTINGS = Object.freeze({
  scheduleEnabled: false,
  scheduleTime: "09:00",
});

export function normalizeScheduleTime(value = "") {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value));
  if (!match) return DEFAULT_DELIVERY_SETTINGS.scheduleTime;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : DEFAULT_DELIVERY_SETTINGS.scheduleTime;
}

export function normalizeDeliverySettings(value = {}) {
  return {
    scheduleEnabled: Boolean(value?.scheduleEnabled),
    scheduleTime: normalizeScheduleTime(value?.scheduleTime),
  };
}

export function nextScheduledAt(time = DEFAULT_DELIVERY_SETTINGS.scheduleTime, now = new Date()) {
  const [hour, minute] = normalizeScheduleTime(time).split(":").map(Number);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

export function alarmNameForJob(id = "") {
  return `${SCHEDULE_ALARM_PREFIX}${id}`;
}

export function jobIdFromAlarm(name = "") {
  return String(name).startsWith(SCHEDULE_ALARM_PREFIX) ? String(name).slice(SCHEDULE_ALARM_PREFIX.length) : "";
}

export function createScheduledSend(input = {}, now = new Date()) {
  const id = String(input.id || globalThis.crypto?.randomUUID?.() || `${now.getTime()}-${Math.random().toString(36).slice(2, 9)}`);
  const scheduledAt = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= now.getTime()) throw new Error("Choose a future send time.");
  return {
    id,
    accountId: String(input.accountId || ""),
    senderEmail: String(input.senderEmail || ""),
    recipients: Array.isArray(input.recipients) ? [...input.recipients] : [],
    subject: String(input.subject || ""),
    body: String(input.body || ""),
    prospectId: String(input.prospectId || ""),
    scheduledAt: scheduledAt.toISOString(),
    status: "scheduled",
    error: "",
    createdAt: now.toISOString(),
    completedAt: "",
  };
}

export function normalizeScheduledSends(value = []) {
  return (Array.isArray(value) ? value : []).filter((job) => job?.id && job?.scheduledAt).slice(-100);
}
