function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boundedText(value, maxLength) {
  return clean(value).slice(0, maxLength).trim();
}

function boundedList(value, { maxItems, maxLength }) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(items.map((item) => boundedText(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function uniqueEmails(...groups) {
  return [...new Set(groups.flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value).toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
}

function verified(status = "") { return ["verified", "valid"].includes(clean(status).toLowerCase()); }

export class ApolloApiError extends Error {
  constructor(message, status = 0, retryAfter = 0) { super(message); this.name = "ApolloApiError"; this.status = status; this.retryAfter = retryAfter; }
}

function retryAfterMs(response, attempt) {
  const seconds = Number(response?.headers?.get?.("retry-after"));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 60_000) : Math.min(1_000 * (2 ** attempt), 8_000);
}

async function apolloRequest(path, { apiKey, method = "GET", body, query, fetchImpl = fetch, sleepImpl = (delay) => new Promise((resolve) => setTimeout(resolve, delay)), maxRateLimitRetries = 1 } = {}) {
  if (!apiKey) throw new Error("Add an Apollo API key in Vela GTM Settings.");
  const url = new URL(path.startsWith("http") ? path : `https://api.apollo.io/api/v1/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  for (let attempt = 0; attempt <= maxRateLimitRetries; attempt += 1) {
    const response = await fetchImpl(url, { method, headers: { Accept: "application/json", "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": apiKey }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 429 && attempt < maxRateLimitRetries) { await sleepImpl(retryAfterMs(response, attempt)); continue; }
    if (!response.ok) {
      const message = payload.message || payload.error || (response.status === 401 ? "Apollo rejected the API key." : response.status === 403 ? "Apollo API access is not enabled for this key." : response.status === 429 ? "Apollo's request limit was reached." : `Apollo request failed (${response.status}).`);
      throw new ApolloApiError(message, response.status, response.status === 429 ? retryAfterMs(response, attempt) : 0);
    }
    return payload;
  }
  throw new ApolloApiError("Apollo request failed.");
}

function personFrom(payload = {}) { return payload.matches?.[0] || payload.person || payload.people?.[0] || payload.contacts?.[0] || payload.data?.person || payload.data?.people?.[0] || null; }

function employmentHistory(raw = {}) {
  const entries = raw.employment_history || raw.employmentHistory || raw.experience || [];
  return (Array.isArray(entries) ? entries : []).slice(0, 6).map((item) => ({ title: clean(item.title || item.job_title), company: clean(item.organization_name || item.company_name || item.organization?.name || item.company?.name), dates: [item.start_date || item.startDate, item.end_date || item.endDate || (item.current || item.is_current ? "Present" : "")].filter(Boolean).join(" – "), location: clean(item.location || item.raw_address), details: clean(item.description || item.summary).slice(0, 700) }));
}

export function normalizeApolloPerson(payload = {}, source = "Apollo") {
  const raw = personFrom(payload) || (payload.id || payload.email ? payload : null);
  if (!raw) return { email: "", emails: [], workEmails: [], personalEmails: [], phones: [], emailStatus: "", emailStatuses: {}, note: "", profile: null, source };
  const email = clean(raw.email || raw.primary_email).toLowerCase();
  const workCandidates = uniqueEmails(raw.work_email, raw.work_emails, email);
  const personalCandidates = uniqueEmails(raw.personal_email, raw.personal_emails);
  const emails = uniqueEmails(email, raw.emails, workCandidates, personalCandidates);
  const statuses = Object.fromEntries(Object.entries({ ...(raw.email_statuses || {}), ...(raw.emailStatuses || {}), ...(raw.work_email_statuses || {}), ...(raw.personal_email_statuses || {}) }).map(([address, status]) => [clean(address).toLowerCase(), clean(status)]));
  const status = clean(raw.email_status || raw.emailStatus || statuses[email] || (email ? "verified" : ""));
  if (email && !statuses[email]) statuses[email] = status;
  const verifiedEmails = emails.filter((address) => verified(statuses[address]));
  const verifiedWorkEmails = workCandidates.filter((address) => verified(statuses[address]));
  const verifiedPersonalEmails = personalCandidates.filter((address) => verified(statuses[address]));
  const verifiedEmail = verifiedWorkEmails[0] || verifiedPersonalEmails[0] || verifiedEmails[0] || "";
  const experiences = employmentHistory(raw);
  const organization = raw.organization || raw.organization_name || raw.company || {};
  const company = clean(typeof organization === "string" ? organization : organization.name || raw.organization_name || experiences[0]?.company);
  const headline = clean(raw.headline || raw.title || raw.job_title);
  const phones = [...new Set([raw.phone_number, raw.phone, ...(Array.isArray(raw.phone_numbers) ? raw.phone_numbers : []), ...(Array.isArray(raw.phones) ? raw.phones : [])].map(clean).filter(Boolean))];
  const linkedinUrl = clean(raw.linkedin_url || raw.linkedinUrl);
  return { email: verifiedEmail, emails: verifiedEmails, workEmails: verifiedWorkEmails, personalEmails: verifiedPersonalEmails, unverifiedEmails: emails.filter((address) => !verifiedEmails.includes(address)), phones, emailStatus: verifiedEmail ? statuses[verifiedEmail] : status, emailStatuses: statuses, note: headline && company ? `your work as ${headline} at ${company}` : headline ? `your background in ${headline}` : company ? `your work at ${company}` : "", source, profile: { name: clean(raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(" ")), headline, location: clean([raw.city, raw.state, raw.country].filter(Boolean).join(", ") || raw.location), about: clean(raw.bio || raw.summary).slice(0, 1200), experiences, company: company ? { name: company, domain: clean(organization.domain || raw.domain), industry: clean(organization.industry || raw.industry), overview: clean(organization.short_description || organization.overview).slice(0, 700) } : null, industry: clean(raw.industry), skills: (Array.isArray(raw.skills) ? raw.skills : []).map(clean).filter(Boolean).slice(0, 20), linkedinUrl, source } };
}

export async function apolloAccountStatus(options = {}) { return apolloRequest("https://api.apollo.io/v1/auth/health", options); }

export async function enrichViaApollo(profile, options = {}) {
  return (await bulkEnrichViaApollo([profile], options))[0] || normalizeApolloPerson({}, "Apollo verified contact");
}

export async function bulkEnrichViaApollo(profiles = [], options = {}) {
  const input = (Array.isArray(profiles) ? profiles : []).slice(0, 10);
  if (!input.length) return [];
  const details = input.map((profile) => {
  const [firstName = "", ...lastParts] = clean(profile?.name).split(" ");
    const detail = { linkedin_url: clean(profile?.url), first_name: firstName, last_name: lastParts.join(" "), name: clean(profile?.name), organization_name: clean(profile?.experiences?.[0]?.company || profile?.company?.name || profile?.company) };
    if (profile?.providerId) detail.id = clean(profile.providerId);
    return detail;
  });
  const payload = await apolloRequest("https://api.apollo.io/v1/people/bulk_enrich", { ...options, method: "POST", query: { reveal_personal_emails: Boolean(options.revealPersonalEmails), reveal_phone_number: Boolean(options.includePhone) }, body: { details } });
  const matches = Array.isArray(payload.matches) ? payload.matches : input.map((_, index) => index === 0 ? personFrom(payload) : null);
  return input.map((_, index) => normalizeApolloPerson(matches[index] || {}, "Apollo verified contact"));
}

export async function peopleSearchViaApollo(filters = {}, options = {}) {
  const requestedLimit = Number(filters.limit || filters.per_page || 100);
  const body = { page: Math.max(1, Number(filters.page) || 1), per_page: Math.min(100, Math.max(1, requestedLimit)) };
  const listMapping = {
    job_title: { target: "person_titles", maxItems: 8, maxLength: 120 },
    seniority: { target: "person_seniorities", maxItems: 5, maxLength: 40 },
    location: { target: "person_locations", maxItems: 5, maxLength: 120 },
  };
  for (const [key, limits] of Object.entries(listMapping)) {
    const values = boundedList(filters[key], limits);
    if (values.length) body[limits.target] = values;
  }
  const company = boundedText(Array.isArray(filters.company) ? filters.company.join(" ") : filters.company, 200);
  if (company) body.q_organization_name = company;
  const keywords = [...new Set([
    clean(Array.isArray(filters.keyword) ? filters.keyword.join(" ") : filters.keyword),
    ...(Array.isArray(filters.industry) ? filters.industry : filters.industry ? [filters.industry] : []).map(clean),
  ].filter(Boolean))];
  if (keywords.length) body.q_keywords = boundedText(keywords.join(" "), 250);
  if (filters.include_similar_titles !== undefined) body.include_similar_titles = Boolean(filters.include_similar_titles);
  const payload = await apolloRequest("https://api.apollo.io/api/v1/mixed_people/api_search", { ...options, method: "POST", body });
  const people = payload.people || payload.contacts || payload.data?.people || [];
  const prospects = (Array.isArray(people) ? people : []).map((raw) => {
    const normalized = normalizeApolloPerson({ person: raw }, "Apollo people search");
    return {
      providerId: clean(raw.id || raw.person_id || raw.contact_id),
      url: clean(raw.linkedin_url || raw.linkedinUrl),
      name: clean(raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(" ")),
      headline: clean(raw.title || raw.headline || raw.job_title),
      location: clean([raw.city, raw.state, raw.country].filter(Boolean).join(", ") || raw.location),
      email: normalized.email,
      emailSource: normalized.email ? "Apollo verified contact" : "",
      contactDetails: normalized,
      background: clean(raw.headline || raw.title).slice(0, 600),
      profile: normalized.profile,
    };
  }).filter((person) => person.providerId || person.url || person.email);
  return {
    total: Number(payload.total_entries || payload.pagination?.total_entries || people.length),
    page: Number(payload.pagination?.page || body.page),
    perPage: body.per_page,
    prospects,
  };
}

export function broadenApolloPeopleFilters(filters = {}) {
  const broadened = { ...filters, include_similar_titles: false };
  delete broadened.keyword;
  delete broadened.skills;
  delete broadened.industry;
  return broadened;
}

export function titlesOnlyApolloPeopleFilters(filters = {}) {
  return {
    job_title: Array.isArray(filters.job_title) ? filters.job_title : filters.job_title ? [filters.job_title] : [],
    include_similar_titles: true,
    page: Math.max(1, Number(filters.page) || 1),
    limit: Math.min(100, Math.max(1, Number(filters.limit) || 100)),
  };
}

export async function searchApolloPeopleWithRecovery(filters = {}, { search, onRetry = () => {} } = {}) {
  if (typeof search !== "function") throw new Error("An Apollo people search function is required.");
  const exact = await search(filters, { attempt: "exact" });
  if (exact?.prospects?.length) return { data: exact, broadened: false, attempts: 1, filters };
  const broadenedFilters = broadenApolloPeopleFilters(filters);
  const changed = JSON.stringify(broadenedFilters) !== JSON.stringify(filters);
  if (!changed) return { data: exact || { prospects: [], total: 0 }, broadened: false, attempts: 1, filters };
  await onRetry(broadenedFilters);
  const broader = await search(broadenedFilters, { attempt: "broadened" });
  return {
    data: { ...(broader || {}), total: Math.max(Number(exact?.total) || 0, Number(broader?.total) || 0) },
    broadened: true,
    attempts: 2,
    filters: broadenedFilters,
  };
}
