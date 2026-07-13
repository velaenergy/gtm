import { cleanText } from "./message.js";

export const DEFAULT_WRITER_ENDPOINT = "http://127.0.0.1:8787/generate";

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
      company: profile.contactOut?.company ? {
        name: cleanText(profile.contactOut.company.name),
        industry: cleanText(profile.contactOut.company.industry),
        overview: cleanText(profile.contactOut.company.overview).slice(0, 500),
      } : null,
      industry: cleanText(profile.contactOut?.industry),
      skills: (Array.isArray(profile.contactOut?.skills) ? profile.contactOut.skills : []).slice(0, 12).map(cleanText),
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
