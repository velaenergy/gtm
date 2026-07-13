function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export const CONTACTOUT_SENIORITIES = Object.freeze([
  "Owner / Founder", "CXO", "Partner", "VP", "Head", "Director", "Manager", "Senior", "Entry", "Intern",
]);

function normalizeSeniority(value = "") {
  const normalized = clean(value).toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return "";
  if (/\b(owner|founder|co founder)\b/.test(normalized)) return "Owner / Founder";
  if (/\b(cxo|c suite|chief (?:executive|operating|technology|financial|marketing|revenue|commercial|product|information|development) officer)\b/.test(normalized)) return "CXO";
  if (/\bpartner\b/.test(normalized)) return "Partner";
  if (/\b(vp|vice president|svp|evp)\b/.test(normalized)) return "VP";
  if (/\bhead\b/.test(normalized)) return "Head";
  if (/\bdirector\b/.test(normalized)) return "Director";
  if (/\bmanager\b/.test(normalized)) return "Manager";
  if (/\b(senior|sr)\b/.test(normalized)) return "Senior";
  if (/\b(entry|entry level|junior|jr)\b/.test(normalized)) return "Entry";
  if (/\bintern\b/.test(normalized)) return "Intern";
  return "";
}

export function normalizePeopleSearchFilters(filters = {}) {
  const normalized = { ...filters };
  normalized.seniority = [...new Set((Array.isArray(filters.seniority) ? filters.seniority : [filters.seniority]).map(normalizeSeniority).filter(Boolean))];
  return normalized;
}

function uniqueEmails(...groups) {
  return [...new Set(groups.flat().flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value).toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
}

function emailStatuses(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([email, status]) => [clean(email).toLowerCase(), clean(status)])
    .filter(([email, status]) => email && status));
}

function mergeEmailStatuses(...values) {
  return Object.assign({}, ...values.map(emailStatuses));
}

function statusForEmail(email, statuses = {}, fallback = "") {
  return clean(statuses[clean(email).toLowerCase()] || fallback).toLowerCase();
}

export function isContactOutVerified(status = "") {
  return ["verified", "valid"].includes(clean(status).toLowerCase());
}

function samplePayload(payload = {}) {
  const message = clean(payload.message);
  const profileUrl = clean(payload.profile?.url || payload.profile?.linkedinUrl || payload.profile?.linkedin_url);
  const emails = uniqueEmails(payload.profile?.email, payload.profile?.work_email, payload.profile?.workEmail, payload.profile?.personal_email, payload.profile?.personalEmail);
  return /sample response|unlock full access|book a call with our sales team/i.test(message)
    || /linkedin\.com\/in\/example-person/i.test(profileUrl)
    || emails.includes("email1@example.com")
    || emails.includes("email2@gmail.com");
}

function unavailableAccessError() {
  return new ContactOutApiError("ContactOut accepted the API key but returned its sample fixture instead of this prospect. The account has no usable credits or this endpoint is not enabled; add credits or ask ContactOut to enable Contact Info, People Enrich, and Email Verifier access.", 403);
}

function experienceDates(item = {}) {
  const start = [item.start_date_year, item.start_date_month].filter(Boolean).join("-");
  const end = item.is_current ? "Present" : [item.end_date_year, item.end_date_month].filter(Boolean).join("-");
  return [start, end].filter(Boolean).join(" – ");
}

export function normalizeContactOutResponse(payload = {}, source = "contactout") {
  const raw = payload.profile;
  if (!raw || Array.isArray(raw)) return { email: "", emails: [], phones: [], emailType: "", emailStatus: "", note: "", profile: null, source };
  const workEmails = uniqueEmails(raw.work_email, raw.workEmail, raw.work_emails);
  const personalEmails = uniqueEmails(raw.personal_email, raw.personalEmail, raw.personal_emails);
  const emails = uniqueEmails(workEmails, personalEmails, raw.email, raw.emails);
  const rawWorkStatuses = raw.work_email_status || raw.workEmailStatus || {};
  const rawPersonalStatuses = raw.personal_email_status || raw.personalEmailStatus || {};
  const rawGeneralStatuses = raw.email_status || raw.emailStatus || {};
  const normalizedStatuses = mergeEmailStatuses(rawWorkStatuses, rawPersonalStatuses, rawGeneralStatuses);
  const workFallback = typeof rawWorkStatuses === "string" ? rawWorkStatuses : "";
  const personalFallback = typeof rawPersonalStatuses === "string" ? rawPersonalStatuses : "";
  const generalFallback = typeof rawGeneralStatuses === "string" ? rawGeneralStatuses : "";
  for (const address of workEmails) if (!normalizedStatuses[address] && workFallback) normalizedStatuses[address] = clean(workFallback);
  for (const address of personalEmails) if (!normalizedStatuses[address] && personalFallback) normalizedStatuses[address] = clean(personalFallback);
  for (const address of emails) if (!normalizedStatuses[address] && generalFallback) normalizedStatuses[address] = clean(generalFallback);
  const verifiedWorkEmails = workEmails.filter((address) => isContactOutVerified(statusForEmail(address, normalizedStatuses)));
  const verifiedPersonalEmails = personalEmails.filter((address) => isContactOutVerified(statusForEmail(address, normalizedStatuses)));
  const verifiedEmails = emails.filter((address) => isContactOutVerified(statusForEmail(address, normalizedStatuses)));
  const email = verifiedWorkEmails[0] || verifiedPersonalEmails[0] || verifiedEmails[0] || "";
  const emailType = verifiedWorkEmails.includes(email) ? "work" : verifiedPersonalEmails.includes(email) ? "personal" : email ? "other" : "";
  const emailStatus = email ? statusForEmail(email, normalizedStatuses) : "";
  const experiences = (Array.isArray(raw.experience) ? raw.experience : []).slice(0, 6).map((item) => ({
    title: clean(item.title), company: clean(item.company_name || item.companyName), dates: experienceDates(item),
    location: clean(item.locality), details: clean(item.summary).slice(0, 700),
  }));
  const headline = clean(raw.headline);
  const company = clean(raw.company?.name || experiences[0]?.company);
  const note = headline && company
    ? headline.toLowerCase().includes(company.toLowerCase()) ? `your background as ${headline}` : `your work as ${headline} at ${company}`
    : headline ? `your background in ${headline}` : company ? `your work at ${company}` : "";
  return {
    email, emails: verifiedEmails, workEmails: verifiedWorkEmails, personalEmails: verifiedPersonalEmails,
    unverifiedEmails: emails.filter((address) => !verifiedEmails.includes(address)),
    unverifiedWorkEmails: workEmails.filter((address) => !verifiedWorkEmails.includes(address)),
    unverifiedPersonalEmails: personalEmails.filter((address) => !verifiedPersonalEmails.includes(address)),
    phones: [...new Set((Array.isArray(raw.phone) ? raw.phone : [raw.phone]).map(clean).filter(Boolean))],
    emailType, emailStatus, emailStatuses: normalizedStatuses, note, source,
    profile: {
      name: clean(raw.full_name || raw.fullName), headline, location: clean(raw.location),
      about: clean(raw.summary).slice(0, 1200), experiences,
      company: raw.company ? { name: clean(raw.company.name), domain: clean(raw.company.domain), industry: clean(raw.company.industry), overview: clean(raw.company.overview).slice(0, 700) } : null,
      industry: clean(raw.industry), skills: (Array.isArray(raw.skills) ? raw.skills : []).map(clean).filter(Boolean).slice(0, 20),
      source,
    },
  };
}

function retryAfterMs(response, attempt) {
  const seconds = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  return Math.min(1_000 * (2 ** attempt), 8_000);
}

export class ContactOutApiError extends Error {
  constructor(message, status = 0, retryAfter = 0) {
    super(message);
    this.name = "ContactOutApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function contactOutRequest(url, {
  apiKey,
  method = "GET",
  body,
  fetchImpl = fetch,
  sleepImpl = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  maxRateLimitRetries = 1,
}) {
  if (!apiKey) throw new Error("Add a ContactOut API key in Vela GTM Settings.");
  for (let attempt = 0; attempt <= maxRateLimitRetries; attempt += 1) {
    const response = await fetchImpl(url, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", authorization: "basic", token: apiKey },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    const status = Number(response.status || payload.status_code || (response.ok ? 200 : 0));
    if (samplePayload(payload)) throw unavailableAccessError();
    if (status === 429 && attempt < maxRateLimitRetries) {
      await sleepImpl(retryAfterMs(response, attempt));
      continue;
    }
    if (status === 404 || payload.status_code === 404) return payload;
    if (!response.ok || payload.status_code >= 400) {
      if (status === 400) {
        throw new ContactOutApiError("ContactOut rejected the API credentials or request headers. Recopy the API key from the ContactOut API Dashboard.", status);
      }
      if (status === 403) {
        const exhausted = /out of credits|credit|quota/i.test(payload.message || "");
        throw new ContactOutApiError(exhausted
          ? "ContactOut accepted the API key, but this account is out of credits. Add credits or wait for the quota to reset."
          : "ContactOut accepted the API key, but this endpoint is not enabled for the account. Ask ContactOut to enable the required API product.", status);
      }
      if (status === 402) throw new ContactOutApiError("ContactOut API credits are exhausted for this account.", status);
      if (status === 429) {
        const wait = retryAfterMs(response, attempt);
        throw new ContactOutApiError(`ContactOut's request-per-minute limit was reached. Retry in ${Math.max(1, Math.ceil(wait / 1000))} seconds.`, status, wait);
      }
      throw new ContactOutApiError(payload.message || `ContactOut request failed (${status || "network"}).`, status);
    }
    return payload;
  }
  throw new ContactOutApiError("ContactOut request failed.");
}

export async function contactOutAccountStatus(options = {}) {
  const payload = await contactOutRequest("https://api.contactout.com/v1/stats", options);
  const sampleStats = payload.period?.start === "2023-04-01"
    && payload.period?.end === "2023-04-30"
    && payload.usage?.count === 100
    && payload.usage?.quota === 200
    && payload.usage?.phone_count === 500
    && payload.usage?.phone_quota === 1000;
  if (sampleStats) throw unavailableAccessError();
  return { period: payload.period || null, usage: payload.usage || null };
}

export async function contactInfoByLinkedIn(linkedInUrl, options = {}) {
  const endpoint = new URL("https://api.contactout.com/v1/people/linkedin");
  endpoint.searchParams.set("profile", linkedInUrl);
  endpoint.searchParams.set("email_type", "personal,work");
  endpoint.searchParams.set("include_phone", String(Boolean(options.includePhone)));
  return normalizeContactOutResponse(await contactOutRequest(endpoint, options), "ContactOut verified contact");
}

export async function peopleEnrich(profile, options = {}) {
  const body = {
    linkedin_url: profile.url,
    full_name: clean(profile.name) || undefined,
    company: clean(profile.experiences?.[0]?.company) ? [clean(profile.experiences[0].company)] : undefined,
    job_title: clean(profile.experiences?.[0]?.title || profile.headline) || undefined,
    include: ["work_email", "personal_email", ...(options.includePhone ? ["phone"] : [])],
  };
  return normalizeContactOutResponse(await contactOutRequest("https://api.contactout.com/v1/people/enrich", { ...options, method: "POST", body }), "ContactOut people enrich");
}

export async function linkedInProfileEnrich(profile, options = {}) {
  const endpoint = new URL("https://api.contactout.com/v1/linkedin/enrich");
  endpoint.searchParams.set("profile", profile.url);
  return normalizeContactOutResponse(await contactOutRequest(endpoint, options), "ContactOut profile data");
}

export async function verifyEmailAddress(email, options = {}) {
  const endpoint = new URL("https://api.contactout.com/v1/email/verify");
  endpoint.searchParams.set("email", email);
  const payload = await contactOutRequest(endpoint, options);
  return clean(payload.data?.status).toLowerCase();
}

async function verifyCandidateEmails(result, options = {}, verificationCache = new Map()) {
  if (result.email) return result;
  const candidates = [...(result.unverifiedWorkEmails || []), ...(result.unverifiedPersonalEmails || [])].slice(0, 3);
  const statuses = { ...(result.emailStatuses || {}) };
  for (const candidate of candidates) {
    let status = verificationCache.get(candidate);
    if (!status) {
      status = await verifyEmailAddress(candidate, options);
      verificationCache.set(candidate, status);
    }
    statuses[candidate] = status;
    if (status !== "valid") continue;
    const work = (result.unverifiedWorkEmails || []).includes(candidate);
    return {
      ...result,
      email: candidate,
      emails: [candidate],
      workEmails: work ? [candidate] : [],
      personalEmails: work ? [] : [candidate],
      emailType: work ? "work" : "personal",
      emailStatus: status,
      emailStatuses: statuses,
    };
  }
  return { ...result, emailStatuses: statuses };
}

export async function enrichViaContactOut(profile, options = {}) {
  if (!/^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\//i.test(profile?.url || "")) throw new Error("A regular LinkedIn profile URL is required for ContactOut.");
  const verificationCache = new Map();
  const contact = await verifyCandidateEmails(await contactInfoByLinkedIn(profile.url, options), options, verificationCache);
  if (contact.email) return contact;
  const enriched = await verifyCandidateEmails(await peopleEnrich(profile, options), options, verificationCache);
  if (enriched.email) return enriched;
  const broad = await verifyCandidateEmails(await linkedInProfileEnrich(profile, options), options, verificationCache);
  if (broad.email || broad.profile?.headline || broad.profile?.experiences?.length) return broad;
  return enriched.profile?.headline || enriched.profile?.experiences?.length ? enriched : contact;
}

export async function peopleSearch(filters = {}, options = {}) {
  const allowed = ["job_title", "seniority", "skills", "location", "industry", "company", "keyword"];
  const body = { page: 1, page_size: 10, current_titles_only: true, include_related_job_titles: true, reveal_info: false, detailed_experience: true };
  const safeFilters = normalizePeopleSearchFilters(filters);
  for (const key of allowed) {
    const value = safeFilters[key];
    if (Array.isArray(value) ? value.length : clean(value)) body[key] = value;
  }
  const payload = await contactOutRequest("https://api.contactout.com/v1/people/search", { ...options, method: "POST", body });
  const entries = payload.profiles && !Array.isArray(payload.profiles) ? Object.entries(payload.profiles) : [];
  return {
    total: Number(payload.metadata?.total_results || entries.length),
    prospects: entries.map(([url, raw]) => ({
      url,
      name: clean(raw.full_name),
      headline: clean(raw.headline || raw.title),
      location: clean(raw.location),
      background: clean(raw.summary).slice(0, 600),
      profile: normalizeContactOutResponse({ profile: raw }, "ContactOut people search").profile,
    })),
  };
}
