const SUCCESSFUL_DELIVERY_STATUSES = new Set(["sent", "partial"]);
const CONSUMER_GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

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
  const seen = new Set();

  for (const record of deliveryLog) {
    if (!SUCCESSFUL_DELIVERY_STATUSES.has(record.status)) continue;
    const at = validDate(record.completedAt || record.updatedAt || record.scheduledAt || record.createdAt);
    if (!at) continue;
    if (record.prospectId) loggedProspects.add(record.prospectId);
    const recipients = Array.isArray(record.recipients) && record.recipients.length ? record.recipients : [""];
    for (const recipient of recipients) {
      const identity = record.prospectId || recipient || record.id;
      const key = `${record.id || ""}|${String(recipient).toLowerCase()}|${at.toISOString()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
        id: record.id || `${identity}-${at.toISOString()}`,
        identity,
        recipient,
        at: at.toISOString(),
        senderEmail: record.senderEmail || "",
        operatorId: record.operatorId || "",
        operatorEmail: record.operatorEmail || "",
        operatorName: record.operatorName || "",
        operatorAvatarUrl: record.operatorAvatarUrl || "",
        subject: record.subject || "",
        status: record.status || "sent",
      });
    }
  }

  for (const prospect of queue) {
    const identity = prospect.id || prospect.url || prospect.email;
    if (!prospect.emailSentAt || loggedProspects.has(identity)) continue;
    const at = validDate(prospect.emailSentAt);
    if (!at) continue;
    events.push({
      id: `prospect-${identity}-${at.toISOString()}`,
      identity,
      recipient: prospect.email || "",
      at: at.toISOString(),
      senderEmail: prospect.senderEmail || "",
      operatorId: prospect.operatorId || "",
      operatorEmail: prospect.operatorEmail || "",
      operatorName: prospect.operatorName || "",
      operatorAvatarUrl: prospect.operatorAvatarUrl || "",
      subject: prospect.subject || "",
      status: "sent",
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function mailboxSentEvents({ deliveryLog = [] } = {}) {
  return collectSentEvents({ deliveryLog }).filter((event) => Boolean(event.senderEmail));
}

export function teamMemberKey(event = {}) {
  const operatorId = String(event.operatorId || "").trim();
  const operatorEmail = String(event.operatorEmail || "").trim().toLowerCase();
  const senderEmail = String(event.senderEmail || "").trim().toLowerCase();
  const name = String(event.operatorName || event.senderEmail || "Unattributed history").trim();
  return operatorId || operatorEmail || (event.operatorName ? name.toLowerCase() : senderEmail || "unattributed");
}

export function teamPerformance(events = [], { replyRecipients = [], replyOwnerByRecipient = {} } = {}) {
  const byMember = new Map();
  const replied = new Set(replyRecipients.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  const replyOwner = replyOwnerByRecipient instanceof Map
    ? replyOwnerByRecipient
    : new Map(Object.entries(replyOwnerByRecipient || {}));
  for (const event of events) {
    const name = String(event.operatorName || event.senderEmail || "Unattributed history").trim();
    const senderEmail = String(event.senderEmail || "").trim().toLowerCase();
    const operatorEmail = String(event.operatorEmail || "").trim().toLowerCase();
    const operatorId = String(event.operatorId || "").trim();
    const key = teamMemberKey(event);
    if (!byMember.has(key)) byMember.set(key, {
      key,
      name,
      operatorId,
      operatorEmail,
      avatarUrl: event.operatorAvatarUrl || "",
      senderEmail,
      senders: new Set(),
      sent: 0,
      recipients: new Set(),
      repliedRecipients: new Set(),
      lastSentAt: "",
    });
    const member = byMember.get(key);
    member.sent += 1;
    if (senderEmail) member.senders.add(senderEmail);
    if (event.recipient) {
      const recipient = String(event.recipient).toLowerCase();
      member.recipients.add(recipient);
      const assignedOwner = replyOwner.get(recipient);
      if (replied.has(recipient) && (!assignedOwner || assignedOwner === key)) member.repliedRecipients.add(recipient);
    }
    if (String(event.at) > member.lastSentAt) member.lastSentAt = event.at;
  }
  return [...byMember.values()].map((member) => ({
    ...member,
    senderEmail: member.senderEmail || [...member.senders][0] || "",
    senders: [...member.senders],
    recipients: member.recipients.size,
    replies: member.repliedRecipients.size,
    replyRate: member.recipients.size ? Math.round((member.repliedRecipients.size / member.recipients.size) * 100) : 0,
  }))
    .sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
}

export function mergeDeliveryRecords(...groups) {
  const merged = [];
  const seen = new Set();
  for (const record of groups.flat()) {
    if (!record) continue;
    const recipients = Array.isArray(record.recipients) && record.recipients.length ? record.recipients : [""];
    for (const recipient of recipients) {
      const at = record.completedAt || record.scheduledAt || record.updatedAt || record.createdAt || "";
      const identity = record.gmailMessageId ? `gmail:${record.gmailMessageId}` : `${record.id || ""}|${at}`;
      const key = `${identity}|${String(recipient).toLowerCase()}|${record.status || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...record, recipients: recipient ? [recipient] : [] });
    }
  }
  return merged.sort((a, b) => String(b.completedAt || b.scheduledAt || b.updatedAt || b.createdAt || "")
    .localeCompare(String(a.completedAt || a.scheduledAt || a.updatedAt || a.createdAt || "")));
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

export function mailboxDailyCapacity(email = "") {
  const domain = String(email).trim().toLowerCase().split("@")[1] || "";
  return CONSUMER_GMAIL_DOMAINS.has(domain) ? 500 : 2000;
}

export function mailboxCapacityUsage({ deliveryLog = [], accounts = [], now = new Date() } = {}) {
  const today = localDayKey(now);
  const mailboxes = new Map();
  const addMailbox = (email, account = {}) => {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) return null;
    if (!mailboxes.has(normalized)) {
      const capacity = mailboxDailyCapacity(normalized);
      mailboxes.set(normalized, {
        id: String(account.id || normalized),
        email: normalized,
        type: capacity === 500 ? "Gmail" : "Workspace",
        capacity,
        sent: 0,
      });
    }
    return mailboxes.get(normalized);
  };

  for (const account of accounts) addMailbox(account?.email, account);
  for (const record of deliveryLog) {
    if (!SUCCESSFUL_DELIVERY_STATUSES.has(record?.status)) continue;
    const sentAt = record.completedAt || record.updatedAt || record.scheduledAt || record.createdAt;
    if (localDayKey(sentAt) !== today) continue;
    const mailbox = addMailbox(record.senderEmail);
    if (!mailbox) continue;
    mailbox.sent += Math.max(1, Array.isArray(record.recipients) ? record.recipients.length : 0);
  }

  return [...mailboxes.values()].map((mailbox) => ({
    ...mailbox,
    remaining: Math.max(0, mailbox.capacity - mailbox.sent),
    percent: Math.min(100, Math.round((mailbox.sent / mailbox.capacity) * 100)),
  }));
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
