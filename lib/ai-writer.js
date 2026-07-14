import { cleanText } from "./message.js";

export const DEFAULT_WRITER_ENDPOINT = "http://127.0.0.1:8787/generate";

export function normalizeWorkNote(value = "") {
  let note = cleanText(value)
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/^(?:opener|opening line)\s*:\s*/i, "")
    .trim();
  if (!note) return "";
  note = `${note[0].toUpperCase()}${note.slice(1)}`;
  if (!/[.!?]$/.test(note)) note += ".";
  return note;
}

export function openerQualityIssues(value = "") {
  const opener = cleanText(value);
  const issues = [];
  const wordCount = opener ? opener.split(/\s+/).length : 0;
  if (wordCount < 12) issues.push("The opener is too short to feel meaningfully personalized.");
  if (wordCount > 70) issues.push("The opener is too long.");
  if (!/[.!?]$/.test(opener)) issues.push("The opener must be a complete sentence.");
  if (/\b(?:was|am|were|are)\s+(?:really\s+)?impressed\b/i.test(opener)) issues.push("Do not default to saying you are impressed.");
  if (/\bcame across your (?:profile|work)\b/i.test(opener)) issues.push("Do not use the generic came-across-your-profile setup.");
  if (/\b(?:caught my eye|stood out to me|your journey|deep expertise|track record|at the intersection of)\b/i.test(opener)) issues.push("Avoid stock AI outreach language.");
  if (/^Your (?:work|background|experience|leadership|progression)\b/i.test(opener)) issues.push("Write a complete thought instead of a legacy personalization fragment.");
  if (/^(?:hi|hello|hey)\b[^,]*,/i.test(opener)) issues.push("The opener must not repeat the email greeting.");
  if (/\b(?:best|regards|sincerely),?\s*$/i.test(opener) || /https?:\/\//i.test(opener)) issues.push("The opener must not include a sign-off or scheduling link.");
  return issues;
}

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

export function writerGenerationMode(configuredMode = "personalization", { explicitRewrite = false } = {}) {
  if (explicitRewrite) return "full";
  return configuredMode === "full" ? "full" : "personalization";
}

export function buildWriterRequest(profile = {}, settings = {}, workNote = "", draft = {}, context = {}) {
  const recipient = context.recipient && typeof context.recipient === "object" ? context.recipient : {};
  const template = context.template && typeof context.template === "object" ? context.template : {};
  return {
    source: "vela-gtm-extension",
    generationMode: context.generationMode || writerGenerationMode(settings.aiGenerationMode),
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
    currentOpener: cleanText(workNote),
    personalizationNote: cleanText(workNote),
    sender: {
      name: cleanText(settings.senderName),
      calendarUrl: cleanText(settings.calendarUrl),
    },
    recipient: {
      email: cleanText(recipient.email).toLowerCase(),
      type: cleanText(recipient.type),
      source: cleanText(recipient.source),
      verified: recipient.verified === true,
    },
    template: {
      id: cleanText(template.id),
      name: cleanText(template.name),
      subject: String(template.subject || "").trim(),
      body: String(template.body || "").trim(),
    },
    currentDraft: {
      subject: cleanText(draft.subject),
      body: String(draft.body || "").trim(),
    },
  };
}

export function normalizeWriterResponse(payload = {}, profile = {}) {
  const data = payload.data || payload.draft || payload;
  return {
    subject: cleanText(data.subject),
    body: String(data.body || "").trim(),
    workNote: normalizeWorkNote(data.workNote || data.work_note || data.personalizationNote, profile),
    model: cleanText(payload.model || data.model),
  };
}
