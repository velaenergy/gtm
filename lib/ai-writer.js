import { cleanText } from "./message.js";

export const DEFAULT_WRITER_ENDPOINT = "http://127.0.0.1:8787/generate";

export function mergeEnrichedProfile(profile = {}, enrichment = {}) {
  const provider = enrichment.profile && typeof enrichment.profile === "object" ? enrichment.profile : null;
  if (!provider) return profile;
  const enrichmentContext = {
    company: provider.company || null,
    industry: cleanText(provider.industry),
    skills: Array.isArray(provider.skills) ? provider.skills : [],
    source: cleanText(provider.source || enrichment.emailSource),
  };
  return {
    ...profile,
    name: cleanText(profile.name || provider.name),
    headline: cleanText(provider.headline || profile.headline),
    location: cleanText(provider.location || profile.location),
    about: cleanText(provider.about || profile.about),
    experiences: Array.isArray(provider.experiences) && provider.experiences.length ? provider.experiences : profile.experiences,
    enrichment: enrichmentContext,
    contactOut: enrichmentContext,
  };
}

export function buildWriterRequest(profile = {}, settings = {}, workNote = "", draft = {}) {
  return {
    source: "vela-gtm-extension",
    profile: {
      name: cleanText(profile.name),
      headline: cleanText(profile.headline),
      location: cleanText(profile.location),
      about: cleanText(profile.about).slice(0, 1200),
      experiences: (Array.isArray(profile.experiences) ? profile.experiences : []).slice(0, 4).map((item) => ({
        title: cleanText(item.title),
        company: cleanText(item.company),
        dates: cleanText(item.dates),
        location: cleanText(item.location),
        details: cleanText(item.details).slice(0, 420),
      })),
      company: (profile.enrichment || profile.contactOut)?.company ? {
        name: cleanText((profile.enrichment || profile.contactOut).company.name),
        industry: cleanText((profile.enrichment || profile.contactOut).company.industry),
        overview: cleanText((profile.enrichment || profile.contactOut).company.overview).slice(0, 500),
      } : null,
      industry: cleanText((profile.enrichment || profile.contactOut)?.industry),
      skills: (Array.isArray((profile.enrichment || profile.contactOut)?.skills) ? (profile.enrichment || profile.contactOut).skills : []).slice(0, 12).map(cleanText),
      url: cleanText(profile.url),
    },
    personalizationNote: cleanText(workNote),
    sender: {
      name: cleanText(settings.senderName),
      calendarUrl: cleanText(settings.calendarUrl),
    },
    currentDraft: {
      subject: cleanText(draft.subject),
      body: String(draft.body || "").trim(),
    },
  };
}

export function normalizeWriterResponse(payload = {}) {
  const data = payload.data || payload.draft || payload;
  return {
    subject: cleanText(data.subject),
    body: String(data.body || "").trim(),
    workNote: cleanText(data.workNote || data.work_note || data.personalizationNote),
    model: cleanText(payload.model || data.model),
  };
}
