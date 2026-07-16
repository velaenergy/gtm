const CONTACTED_STATUSES = new Set(["sent", "partial"]);

function normalizedEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function contactIdentity(prospect = {}) {
  const email = normalizedEmail(prospect.email);
  if (email) return `email:${email}`;
  const linkedIn = String(prospect.url || prospect.linkedinUrl || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
  return linkedIn ? `linkedin:${linkedIn}` : `prospect:${prospect.id || prospect.name || "unknown"}`;
}

function prospectCompany(prospect = {}) {
  return prospect.profile?.experiences?.[0]?.company || prospect.company || "";
}

function sourceLabel(prospect = {}) {
  const source = String(prospect.source || prospect.emailSource || "");
  if (/spreadsheet|\.xlsx|\.xls|\.csv|import(?:ed)?\s+list|linkedin url import/i.test(source)) return "Imported list";
  if ((prospect.activity || []).some((event) => event?.type === "imported")) return "Imported list";
  return source ? "Tool" : "Workspace";
}

function eventTime(record = {}) {
  return record.completedAt || record.occurredAt || record.scheduledAt || record.updatedAt || record.createdAt || "";
}

function eventRecipients(record = {}) {
  return (Array.isArray(record.recipients) ? record.recipients : [record.recipientEmail])
    .map(normalizedEmail)
    .filter(Boolean);
}

function uniqueTouches(records = []) {
  return new Set(records.map((record) => record.id || `${record.status}:${eventTime(record)}:${record.subject || ""}`)).size;
}

function historicalActivity(record = {}) {
  const mode = String(record.mode || "").toLowerCase();
  return ["imported", "gmail_history", "inbox"].includes(mode) || record.source === "gmail";
}

function attributableOperator(record = {}) {
  if (!CONTACTED_STATUSES.has(String(record.status || "").toLowerCase()) || historicalActivity(record)) return "";
  return record.operatorName || record.operatorEmail || "";
}

function ownerSource(activities = [], operators = []) {
  if (operators.length) return "Sent this contact";
  if (activities.some((record) => record.source === "gmail" || ["gmail_history", "inbox"].includes(String(record.mode || "").toLowerCase()))) return "Gmail history";
  if (activities.some((record) => String(record.mode || "").toLowerCase() === "imported")) return "Imported history";
  return "No recorded sender";
}

export function contactStatus(contact = {}) {
  const activities = Array.isArray(contact.activities) ? contact.activities : [];
  if (contact.prospect?.replyReceivedAt || (contact.prospect?.activity || []).some((item) => item.type === "reply_received")) return "Replied";
  if (contact.prospect?.emailBouncedAt || activities.some((item) => item.status === "bounced")) return "Bounced";
  if (activities.some((item) => CONTACTED_STATUSES.has(item.status)) || contact.prospect?.emailSentAt || contact.prospect?.status === "sent") return "Contacted";
  if (activities.some((item) => item.status === "scheduled")) return "Scheduled";
  if (contact.source === "Imported list") return "Imported";
  return contact.prospect?.email ? "Ready" : "Researching";
}

function bounceLabel(reason = "") {
  return ({
    recipient_not_found: "Address not found",
    mailbox_full: "Mailbox full",
    domain_failure: "Domain not found",
    policy_blocked: "Recipient blocked it",
    temporary_failure: "Temporary failure",
    delivery_failed: "Delivery failed",
  })[reason] || "Delivery failed";
}

export function buildContacts({ prospects = [], deliveryLog = [] } = {}) {
  const contacts = new Map();
  for (const prospect of Array.isArray(prospects) ? prospects : []) {
    const identity = contactIdentity(prospect);
    const email = normalizedEmail(prospect.email);
    contacts.set(identity, {
      id: identity,
      prospectId: prospect.id || prospect.url || prospect.email || identity,
      prospect,
      name: prospect.name || email.split("@")[0] || "—",
      email,
      company: prospectCompany(prospect),
      source: sourceLabel(prospect),
      activities: [],
    });
  }

  for (const record of Array.isArray(deliveryLog) ? deliveryLog : []) {
    for (const email of eventRecipients(record)) {
      const identity = `email:${email}`;
      const existing = contacts.get(identity) || {
        id: identity,
        prospectId: record.prospectId || identity,
        prospect: {},
        name: record.recipientName || email.split("@")[0] || "—",
        email,
        company: "",
        source: record.mode === "imported" ? "Imported list" : "Tool",
        activities: [],
      };
      existing.activities.push(record);
      contacts.set(identity, existing);
    }
  }

  return [...contacts.values()].map((contact) => {
    const completed = contact.activities.filter((record) => CONTACTED_STATUSES.has(record.status));
    const latestBounce = contact.activities.filter((record) => record.status === "bounced")
      .sort((a, b) => String(eventTime(b)).localeCompare(String(eventTime(a))))[0];
    const latest = [...(completed.length ? completed : contact.activities)]
      .sort((a, b) => String(eventTime(b)).localeCompare(String(eventTime(a))))[0];
    const lastContactAt = eventTime(latest) || contact.prospect.emailSentAt || "";
    const lastActivityAt = [lastContactAt, eventTime(latestBounce), contact.prospect.emailBouncedAt || ""]
      .filter(Boolean).sort().at(-1) || "";
    const operators = [...new Set(contact.activities
      .map(attributableOperator)
      .filter(Boolean))];
    const normalized = {
      ...contact,
      lastContactAt,
      lastActivityAt,
      touches: uniqueTouches(completed),
      operators,
      ownerName: operators[0] || "Unknown",
      ownerSource: ownerSource(contact.activities, operators),
      deliveryHealth: latestBounce || contact.prospect.emailBouncedAt
        ? `${latestBounce?.bounceType || contact.prospect.emailBounceType || "hard"} bounce`
        : completed.length || contact.prospect.emailSentAt ? "Delivered" : "Not sent",
      bounceReason: bounceLabel(latestBounce?.bounceReason || contact.prospect.emailBounceReason || ""),
      bounceDiagnostic: latestBounce?.error || "",
    };
    return { ...normalized, status: contactStatus(normalized) };
  }).sort((a, b) => String(b.lastContactAt || b.prospect.importedAt || b.prospect.updatedAt || "").localeCompare(String(a.lastContactAt || a.prospect.importedAt || a.prospect.updatedAt || "")) || a.name.localeCompare(b.name));
}

export function filterContacts(contacts = [], { query = "", status = "all" } = {}) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return (Array.isArray(contacts) ? contacts : []).filter((contact) => {
    if (status !== "all" && contact.status.toLowerCase() !== status.toLowerCase()) return false;
    if (!normalizedQuery) return true;
    return [contact.name, contact.email, contact.company, contact.status, contact.source, contact.deliveryHealth, contact.bounceReason, contact.ownerName, contact.ownerSource, ...(contact.operators || [])]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}
