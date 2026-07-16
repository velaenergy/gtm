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
  if (/[,]\s*(?:which\s+)?(?:suggests?|shows?|demonstrates?|means?|making)\b/i.test(opener)) issues.push("Write a noun phrase that fits naturally inside the inline template slot.");
  if (/^(?:hi|hello|hey)\b[^,]*,/i.test(opener)) issues.push("The opener must not repeat the email greeting.");
  if (/\b(?:best|regards|sincerely),?\s*$/i.test(opener) || /https?:\/\//i.test(opener)) issues.push("The opener must not include a sign-off or scheduling link.");
  return issues;
}

export function mergeEnrichedProfile(profile = {}, enrichment = {}) {
  const provider = enrichment.profile && typeof enrichment.profile === "object" ? enrichment.profile : null;
  if (!provider) return profile;
  const localExperiences = Array.isArray(profile.experiences) ? profile.experiences : [];
  const providerExperiences = Array.isArray(provider.experiences) ? provider.experiences : [];
  const experienceKey = (item = {}) => `${cleanText(item.title).toLowerCase()}|${cleanText(item.company).toLowerCase()}`;
  const localByKey = new Map(localExperiences.map((item) => [experienceKey(item), item]));
  const mergedExperiences = providerExperiences.map((item) => {
    const local = localByKey.get(experienceKey(item)) || {};
    localByKey.delete(experienceKey(item));
    return {
      ...local,
      ...item,
      details: cleanText(item.details) || cleanText(local.details),
    };
  });
  mergedExperiences.push(...localExperiences.filter((item) => localByKey.has(experienceKey(item))));
  const aboutCandidates = [cleanText(profile.about), cleanText(provider.about)].filter(Boolean);
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
    about: aboutCandidates.sort((a, b) => b.length - a.length)[0] || "",
    experiences: providerExperiences.length ? mergedExperiences : localExperiences,
    enrichment: enrichmentContext,
    contactOut: enrichmentContext,
  };
}

export function writerGenerationMode() {
  return "full";
}

export function fullDraftQualityIssues({ subject = "", body = "", workNote = "" } = {}, input = {}) {
  const cleanSubject = cleanText(subject);
  const cleanBody = String(body || "").replace(/\r\n?/g, "\n").trim();
  const paragraphs = cleanBody ? cleanBody.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean) : [];
  const words = cleanBody ? cleanBody.split(/\s+/).filter(Boolean) : [];
  const senderName = cleanText(input.sender?.name);
  const calendarUrl = cleanText(input.sender?.calendarUrl);
  const issues = [];
  if (!cleanSubject) issues.push("Add a specific subject.");
  if (cleanSubject.length > 90) issues.push("Keep the subject under 90 characters.");
  if (!cleanBody) issues.push("Write the complete email body.");
  if (words.length < 55) issues.push("The email is too short to carry the introduction and ask naturally.");
  if (words.length > 220) issues.push("The email is too long for first-touch outreach.");
  if (paragraphs.length < 3 || paragraphs.length > 7) issues.push("Use 3-7 natural paragraph blocks.");
  const hasHardWrappedParagraph = paragraphs.some((paragraph) => {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return false;
    return !(lines.length === 2 && /^(?:best|thanks|regards|sincerely),?$/i.test(lines[0]));
  });
  if (hasHardWrappedParagraph) issues.push("Do not insert fixed-width line breaks inside paragraphs.");
  if (/{{\w+}}/.test(`${cleanSubject}\n${cleanBody}`)) issues.push("Resolve every merge variable.");
  if (/\[[^\]]+\]\(https?:\/\//i.test(cleanBody)) issues.push("Use a plain URL instead of Markdown link syntax.");
  if (senderName && !cleanBody.toLowerCase().includes(senderName.toLowerCase())) issues.push("Keep the configured sender name in the email.");
  if (calendarUrl && !cleanBody.includes(calendarUrl)) issues.push("Keep the configured calendar URL in the email.");
  if (!cleanText(workNote)) issues.push("Return the grounded internal work note.");
  return issues;
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
      about: cleanText(profile.about).slice(0, 2400),
      experiences: (Array.isArray(profile.experiences) ? profile.experiences : []).slice(0, 6).map((item) => ({
        title: cleanText(item.title),
        company: cleanText(item.company),
        dates: cleanText(item.dates),
        location: cleanText(item.location),
        details: cleanText(item.details).slice(0, 700),
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
      purpose: cleanText(template.eyebrow),
      subjectPattern: String(template.subject || "").trim(),
      bodyBlueprint: String(template.body || "").trim(),
      renderedSubject: String(template.renderedSubject || "").trim(),
      renderedBody: String(template.renderedBody || "").trim(),
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
    body: String(data.body || "").replace(/\r\n?/g, "\n").trim(),
    workNote: normalizeWorkNote(data.workNote || data.work_note || data.personalizationNote, profile),
    model: cleanText(payload.model || data.model),
  };
}
