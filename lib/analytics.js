const SUCCESSFUL_DELIVERY_STATUSES = new Set(["sent", "partial"]);

function validDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date : null;
}

function localDayKey(value) {
  const date = value instanceof Date ? value : validDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function collectSentEvents({ deliveryLog = [], queue = [] } = {}) {
  const loggedProspects = new Set();
  const events = [];

  for (const record of deliveryLog) {
    if (!SUCCESSFUL_DELIVERY_STATUSES.has(record.status)) continue;
    const at = validDate(record.completedAt || record.updatedAt || record.scheduledAt || record.createdAt);
    if (!at) continue;
    const identity = record.prospectId || record.recipients?.[0] || record.id;
    if (record.prospectId) loggedProspects.add(record.prospectId);
    events.push({ id: record.id || `${identity}-${at.toISOString()}`, identity, at: at.toISOString() });
  }

  for (const prospect of queue) {
    const identity = prospect.id || prospect.url || prospect.email;
    if (!prospect.emailSentAt || loggedProspects.has(identity)) continue;
    const at = validDate(prospect.emailSentAt);
    if (!at) continue;
    events.push({ id: `prospect-${identity}-${at.toISOString()}`, identity, at: at.toISOString() });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function buildDailySendSeries(events = [], { days = 14, now = new Date(), locale } = {}) {
  const count = Math.max(1, Math.floor(days));
  const today = validDate(now) || new Date();
  const byDay = new Map();
  for (const event of events) {
    const key = localDayKey(event.at);
    if (key) byDay.set(key, (byDay.get(key) || 0) + 1);
  }

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - index));
    const key = localDayKey(date);
    return {
      key,
      date: date.toISOString(),
      count: byDay.get(key) || 0,
      label: new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date),
      shortDate: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date),
    };
  });
}

export function summarizeDailySends(series = []) {
  const total = series.reduce((sum, day) => sum + day.count, 0);
  const lastSeven = series.slice(-7).reduce((sum, day) => sum + day.count, 0);
  const best = series.reduce((current, day) => day.count > (current?.count || 0) ? day : current, null);
  return {
    total,
    lastSeven,
    average: series.length ? total / series.length : 0,
    best: best?.count ? best : null,
  };
}

export function deliveryOutcomeCounts({ deliveryLog = [], scheduledJobs = [] } = {}) {
  const counts = { sent: 0, scheduled: 0, failed: 0, cancelled: 0 };
  for (const record of deliveryLog) {
    if (SUCCESSFUL_DELIVERY_STATUSES.has(record.status)) counts.sent += 1;
    else if (record.status === "failed") counts.failed += 1;
    else if (record.status === "cancelled") counts.cancelled += 1;
  }
  counts.scheduled = scheduledJobs.filter((record) => record.status === "scheduled").length;
  return counts;
}
