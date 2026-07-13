function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueEmails(...groups) {
  return [...new Set(groups.flat().flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value).toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
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
  const email = workEmails[0] || personalEmails[0] || emails[0] || "";
  const emailType = workEmails.includes(email) ? "work" : personalEmails.includes(email) ? "personal" : email ? "other" : "";
  const statuses = raw.work_email_status || raw.workEmailStatus || {};
  const emailStatus = typeof statuses === "string" ? statuses : clean(statuses[email]);
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
    email, emails, workEmails, personalEmails,
    phones: [...new Set((Array.isArray(raw.phone) ? raw.phone : [raw.phone]).map(clean).filter(Boolean))],
    emailType, emailStatus, note, source,
    profile: {
      name: clean(raw.full_name || raw.fullName), headline, location: clean(raw.location),
      about: clean(raw.summary).slice(0, 1200), experiences,
      company: raw.company ? { name: clean(raw.company.name), domain: clean(raw.company.domain), industry: clean(raw.company.industry), overview: clean(raw.company.overview).slice(0, 700) } : null,
      industry: clean(raw.industry), skills: (Array.isArray(raw.skills) ? raw.skills : []).map(clean).filter(Boolean).slice(0, 20),
      source,
    },
  };
}

async function contactOutRequest(url, { apiKey, method = "GET", body, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Add a ContactOut API key in Vela GTM Settings.");
  const response = await fetchImpl(url, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", token: apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  const status = response.status || payload.status_code;
  if (status === 404 || payload.status_code === 404) return payload;
  if (!response.ok || payload.status_code >= 400) {
    if ([401, 403].includes(status)) throw new Error("ContactOut rejected the API key in Settings.");
    if (status === 429) throw new Error("ContactOut rate limit reached. Try again shortly.");
    throw new Error(payload.message || `ContactOut request failed (${status}).`);
  }
  return payload;
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

export async function enrichViaContactOut(profile, options = {}) {
  if (!/^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\//i.test(profile?.url || "")) throw new Error("A regular LinkedIn profile URL is required for ContactOut.");
  const contact = await contactInfoByLinkedIn(profile.url, options);
  if (contact.email) return contact;
  const enriched = await peopleEnrich(profile, options);
  if (enriched.email || enriched.profile?.headline || enriched.profile?.experiences?.length) return enriched;
  return linkedInProfileEnrich(profile, options);
}

export async function peopleSearch(filters = {}, options = {}) {
  const allowed = ["job_title", "seniority", "skills", "location", "industry", "company", "keyword"];
  const body = { page: 1, page_size: 10, current_titles_only: true, include_related_job_titles: true, reveal_info: false, detailed_experience: true };
  for (const key of allowed) {
    const value = filters[key];
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
