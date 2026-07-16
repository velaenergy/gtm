export const FOLLOW_UP_KIND = "follow-up";

export function addBusinessDays(value, days = 1) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid sequence start date is required.");
  let remaining = Math.max(0, Math.floor(Number(days) || 0));
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (![0, 6].includes(date.getDay())) remaining -= 1;
  }
  return date;
}

export function buildFollowUpJobs({ followUps = [], cadenceDays = 3, startAt = new Date(), base = {}, threadId = "", replyToMessageId = "" } = {}) {
  const cadence = Math.min(30, Math.max(1, Number(cadenceDays) || 3));
  return (Array.isArray(followUps) ? followUps : []).filter((step) => step?.body).slice(0, 3).map((step, index) => ({
    ...base,
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}`,
    kind: FOLLOW_UP_KIND,
    sequenceId: String(base.sequenceId || base.id || ""),
    sequenceStep: index + 1,
    templateId: String(step.templateId || ""),
    subject: String(base.subject || ""),
    body: String(step.body),
    threadId: String(threadId || ""),
    replyToMessageId: String(replyToMessageId || ""),
    scheduledAt: addBusinessDays(startAt, cadence * (index + 1)).toISOString(),
  }));
}

export function hasRecordedReply(prospect = {}) {
  return Boolean(prospect.replyReceivedAt || (prospect.activity || []).some((event) => ["reply", "replied", "reply_received", "gmail_reply"].includes(event?.type)));
}
