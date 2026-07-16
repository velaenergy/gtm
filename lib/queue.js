import { cleanText, isEmail } from "./message.js";

export const QUEUE_STORAGE_KEY = "velaGtmProspectQueue";

export const QUEUE_STATUS = Object.freeze({
  NEW: "new",
  PROCESSING: "processing",
  NEEDS_EMAIL: "needs_email",
  READY: "ready",
  DRAFTED: "drafted",
  SENT: "sent",
  ERROR: "error",
});

export function normalizeLinkedInUrl(value = "") {
  const candidate = String(value).trim().match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s|?#]+/i)?.[0] || "";
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    const slug = url.pathname.match(/^\/in\/([^/]+)/i)?.[1];
    if (!slug) return "";
    return `https://www.linkedin.com/in/${slug}`;
  } catch {
    return "";
  }
}

export function prospectId(linkedInUrl = "") {
  return normalizeLinkedInUrl(linkedInUrl).toLowerCase();
}

export function prospectIdentity(input = {}) {
  const linkedInId = prospectId(input.url || input.linkedInUrl || "");
  if (linkedInId) return linkedInId;
  const email = cleanText(input.email || input.recipient).toLowerCase();
  if (isEmail(email)) return `email:${email}`;
  const providerId = cleanText(input.providerId || input.apolloId || input.externalId);
  return providerId ? `apollo:${providerId.toLowerCase()}` : "";
}

export function parseBulkProspects(value = "") {
  const seen = new Set();
  const prospects = [];
  for (const rawLine of String(value).split(/\r?\n/)) {
    const matchedUrl = rawLine.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s|]+/i)?.[0] || "";
    const url = normalizeLinkedInUrl(matchedUrl);
    const id = prospectId(url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const background = cleanText(rawLine.replace(matchedUrl, "").replace(/^[\s|,;:\t/-]+|[\s|,;:\t/-]+$/g, ""));
    prospects.push({ url, background });
  }
  return prospects;
}

export function createProspect(input = {}, now = new Date().toISOString()) {
  const url = normalizeLinkedInUrl(input.url);
  const id = prospectIdentity({ ...input, url });
  if (!id) return null;
  return {
    id,
    providerId: cleanText(input.providerId || input.apolloId || input.externalId),
    url,
    name: cleanText(input.name),
    headline: cleanText(input.headline),
    location: cleanText(input.location),
    background: cleanText(input.background),
    email: cleanText(input.email).toLowerCase(),
    emailSource: cleanText(input.emailSource),
    workNote: cleanText(input.workNote),
    subject: cleanText(input.subject),
    body: String(input.body || "").trim(),
    status: input.status || QUEUE_STATUS.NEW,
    error: cleanText(input.error),
    draftId: cleanText(input.draftId),
    contactDetails: input.contactDetails || null,
    profile: input.profile || null,
    source: cleanText(input.source),
    targetFit: input.targetFit && typeof input.targetFit === "object" ? input.targetFit : null,
    researchRunId: cleanText(input.researchRunId),
    auditStatus: ["queued", "processing", "complete", "error"].includes(input.auditStatus) ? input.auditStatus : "",
    auditError: cleanText(input.auditError),
    auditedBy: input.auditedBy && typeof input.auditedBy === "object" ? input.auditedBy : null,
    auditedAt: input.auditedAt || "",
    activity: Array.isArray(input.activity) ? input.activity.slice(-80) : [],
    importedAt: input.importedAt || "",
    researchedAt: input.researchedAt || "",
    reviewedAt: input.reviewedAt || "",
    draftedAt: input.draftedAt || "",
    exportedAt: input.exportedAt || "",
    emailSentAt: input.emailSentAt || "",
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function upsertProspects(existing = [], incoming = [], now = new Date().toISOString()) {
  const byId = new Map();
  for (const item of existing) {
    const normalized = createProspect(item, item.updatedAt || now);
    if (normalized) byId.set(normalized.id, { ...normalized, ...item, id: normalized.id, url: normalized.url });
  }
  for (const input of incoming) {
    const next = createProspect(input, now);
    if (!next) continue;
    const current = byId.get(next.id);
    byId.set(next.id, current ? {
      ...current,
      ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== "" && value !== null)),
      status: current.status === QUEUE_STATUS.DRAFTED ? current.status : (input.status || current.status),
      createdAt: current.createdAt,
      updatedAt: now,
    } : next);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function queueStats(items = []) {
  return items.reduce((stats, item) => {
    stats.total += 1;
    if (item.status === QUEUE_STATUS.READY) stats.ready += 1;
    if (item.status === QUEUE_STATUS.DRAFTED) stats.drafted += 1;
    if (item.status === QUEUE_STATUS.SENT || item.emailSentAt) stats.sent += 1;
    if ([QUEUE_STATUS.NEW, QUEUE_STATUS.ERROR, QUEUE_STATUS.NEEDS_EMAIL].includes(item.status)) stats.attention += 1;
    return stats;
  }, { total: 0, ready: 0, drafted: 0, sent: 0, attention: 0 });
}

export function withActivity(item = {}, type = "updated", detail = "", at = new Date().toISOString()) {
  const activity = [...(Array.isArray(item.activity) ? item.activity : []), { type, detail: cleanText(detail), at }].slice(-80);
  return { ...item, activity, updatedAt: at };
}
