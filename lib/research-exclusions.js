import { isEmail } from "./message.js";
import { normalizeLinkedInUrl } from "./queue.js";

const SENT_DELIVERY_STATUSES = new Set(["sent", "partial"]);
const SENT_ACTIVITY_TYPES = new Set(["sent", "send_partial"]);

function addIdentityValue(keys, value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return;
  const linkedInUrl = normalizeLinkedInUrl(raw);
  if (linkedInUrl) {
    keys.add(`linkedin:${linkedInUrl.toLowerCase()}`);
    return;
  }
  if (raw.startsWith("apollo:") || raw.startsWith("email:")) {
    keys.add(raw);
    return;
  }
  keys.add(`identity:${raw}`);
}

function addEmail(keys, value = "") {
  const email = String(value || "").trim().toLowerCase();
  if (isEmail(email)) keys.add(`email:${email}`);
}

function contactEmails(person = {}) {
  const details = person.contactDetails || {};
  return [
    person.email,
    person.recipient,
    details.email,
    ...(Array.isArray(details.emails) ? details.emails : []),
    ...(Array.isArray(person.emails) ? person.emails : []),
  ].map((entry) => typeof entry === "string" ? entry : entry?.email || entry?.value || "");
}

export function researchIdentityKeys(person = {}) {
  const keys = new Set();
  addIdentityValue(keys, person.id);
  addIdentityValue(keys, person.url || person.linkedInUrl || person.linkedinUrl);
  const providerId = String(person.providerId || person.apolloId || person.externalId || "").trim().toLowerCase();
  if (providerId) keys.add(`apollo:${providerId}`);
  for (const email of contactEmails(person)) addEmail(keys, email);
  return [...keys];
}

function prospectWasSent(prospect = {}) {
  return prospect.status === "sent"
    || Boolean(prospect.emailSentAt)
    || (Array.isArray(prospect.activity) && prospect.activity.some((event) => SENT_ACTIVITY_TYPES.has(event?.type)));
}

export function sentResearchIdentityIndex({ prospects = [], deliveryLog = [] } = {}) {
  const keys = new Set();
  for (const prospect of Array.isArray(prospects) ? prospects : []) {
    if (!prospectWasSent(prospect)) continue;
    for (const key of researchIdentityKeys(prospect)) keys.add(key);
  }
  for (const record of Array.isArray(deliveryLog) ? deliveryLog : []) {
    if (!SENT_DELIVERY_STATUSES.has(record?.status)) continue;
    addIdentityValue(keys, record.prospectId);
    for (const recipient of Array.isArray(record.recipients) ? record.recipients : []) addEmail(keys, recipient);
  }
  return keys;
}

export function previouslyContactedIdentityKeys(person = {}, sentIdentityIndex = new Set()) {
  return researchIdentityKeys(person).filter((key) => sentIdentityIndex.has(key));
}

export function excludePreviouslyContactedProspects(prospects = [], sentIdentityIndex = new Set()) {
  const eligible = [];
  const excluded = [];
  for (const prospect of Array.isArray(prospects) ? prospects : []) {
    const matchedKeys = previouslyContactedIdentityKeys(prospect, sentIdentityIndex);
    if (matchedKeys.length) excluded.push({ prospect, matchedKeys });
    else eligible.push(prospect);
  }
  return { eligible, excluded };
}
