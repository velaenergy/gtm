export const DEFAULT_SETTINGS = Object.freeze({
  endpointUrl: "",
  apiToken: "",
  writerEndpointUrl: "",
  writerToken: "",
  contactOutApiKey: "",
  apolloApiKey: "",
  openAIApiKey: "",
  openAIModel: "gpt-5.4-mini",
  includeContactOutPhone: false,
  autoEnrich: true,
  theme: "system",
  senderName: "Tarun",
  calendarUrl: "https://cal.com/team/velaenergy",
});

export const TEMPLATES = Object.freeze([
  {
    id: "quick-intro",
    name: "Quick intro",
    eyebrow: "Pick their brain",
    subject: "Quick intro + would love to pick your brain",
    body: `Hi {{firstName}},

Came across your profile and was really impressed by {{workNote}}.

A bit about me: I'm {{senderName}}, CEO of Vela Energy. Tony (my co-founder) and I both come from energy-intensive backgrounds. I’m a nationally recognized inventor in energy, and Tony actually left his role at Tesla to build Vela with me full-time. We recently raised $1.3M from a16z Speedrun and Z Fellows to build AI agent products that help large energy loads get powered on faster.

Super interested in learning more about your work, and would love to pick your brain as we build this out. Would you have 20-30 minutes in the coming week for a chat? {{calendarUrl}}

Looking forward to hearing from you.

Best,
{{senderName}}`,
  },
  {
    id: "operator-intro",
    name: "Operator intro",
    eyebrow: "Energy + infrastructure",
    subject: "Your work in {{shortRole}} + a quick Vela intro",
    body: `Hi {{firstName}},

I came across your profile while researching leaders working at the intersection of energy, infrastructure, and operations. {{workNoteSentence}}

I’m {{senderName}}, CEO of Vela Energy. We’re building AI agents that help large energy loads navigate utilities, interconnection, and power procurement so they can get energized faster. We recently raised $1.3M from a16z Speedrun and Z Fellows.

I’d really value your perspective on where teams lose the most time today. Open to a 20-minute conversation next week? {{calendarUrl}}

Best,
{{senderName}}`,
  },
  {
    id: "follow-up",
    name: "Warm follow-up",
    eyebrow: "Short and direct",
    subject: "Re: quick Vela introduction",
    body: `Hi {{firstName}},

Wanted to quickly follow up in case my note got buried. I’d still love to learn from {{workNote}} as we build Vela’s products for large energy users.

If it’s easier, here’s my calendar: {{calendarUrl}}

Best,
{{senderName}}`,
  },
]);

export function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

export function getFirstName(name = "") {
  return cleanText(name).split(" ")[0] || "there";
}

export function initialsFor(name = "") {
  const parts = cleanText(name).split(" ").filter(Boolean);
  if (!parts.length) return "VG";
  return `${parts[0][0] || ""}${parts.length > 1 ? parts.at(-1)[0] : ""}`.toUpperCase();
}

function stripEmploymentNoise(value = "") {
  return cleanText(value)
    .replace(/\b(full[- ]time|part[- ]time|contract|self-employed)\b/gi, "")
    .replace(/\s*·\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function shortRoleFor(profile = {}) {
  const current = profile.experiences?.[0];
  if (current?.title) return stripEmploymentNoise(current.title);
  if (profile.headline) return cleanText(profile.headline).split(/[|@]/)[0].trim();
  return "energy infrastructure";
}

export function buildWorkNote(profile = {}) {
  if (cleanText(profile.workNote)) return cleanText(profile.workNote).replace(/[.!?]+$/, "");

  const experiences = Array.isArray(profile.experiences) ? profile.experiences : [];
  const current = experiences[0] || {};
  const past = experiences.slice(1, 3);
  const role = stripEmploymentNoise(current.title || shortRoleFor(profile));
  const company = stripEmploymentNoise(current.company || "");

  let lead;
  if (role && company) lead = `your work as ${role} at ${company}`;
  else if (profile.headline) lead = `your background in ${cleanText(profile.headline)}`;
  else lead = "the work you’re doing across energy and infrastructure";

  const details = past
    .map((item) => stripEmploymentNoise(item.company || item.title || ""))
    .filter((item, index, all) => item && all.indexOf(item) === index && item !== company)
    .slice(0, 2);

  if (details.length === 1) return `${lead}, including your experience with ${details[0]}`;
  if (details.length === 2) return `${lead}, including your experience with ${details[0]} and ${details[1]}`;
  return lead;
}

export function sentenceCase(value = "") {
  const clean = cleanText(value).replace(/[.!?]+$/, "");
  return clean ? `${clean[0].toUpperCase()}${clean.slice(1)}.` : "";
}

export function templateVariables(profile = {}, settings = {}, workNote = "") {
  const resolvedNote = cleanText(workNote) || buildWorkNote(profile);
  return {
    firstName: getFirstName(profile.name),
    senderName: cleanText(settings.senderName) || DEFAULT_SETTINGS.senderName,
    calendarUrl: cleanText(settings.calendarUrl) || DEFAULT_SETTINGS.calendarUrl,
    workNote: resolvedNote,
    workNoteSentence: sentenceCase(resolvedNote),
    shortRole: shortRoleFor(profile),
  };
}

export function applyTemplate(template, variables = {}) {
  const replace = (value = "") => value.replace(/{{(\w+)}}/g, (_, key) => variables[key] ?? `{{${key}}}`);
  return {
    subject: replace(template?.subject || ""),
    body: replace(template?.body || ""),
  };
}

export function gmailComposeUrl({ to = "", subject = "", body = "" } = {}) {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (cleanText(to)) params.set("to", cleanText(to));
  if (subject) params.set("su", subject);
  if (body) params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function normalizeEnrichmentResponse(payload = {}) {
  const data = payload?.data || payload?.person || payload?.contact || payload || {};
  const email = cleanText(data.email || data.workEmail || data.work_email || "").toLowerCase();
  const workEmails = [...new Set((data.workEmails || data.work_emails || []).map((value) => cleanText(value).toLowerCase()).filter(isEmail))];
  const personalEmails = [...new Set((data.personalEmails || data.personal_emails || []).map((value) => cleanText(value).toLowerCase()).filter(isEmail))];
  const note = cleanText(data.note || data.workNote || data.work_note || data.summary || "");
  const confidenceValue = data.confidence ?? data.emailConfidence ?? data.email_confidence;
  const numericConfidence = Number(confidenceValue);
  const rawStatuses = data.emailStatuses || data.email_statuses || {};
  const emailStatuses = rawStatuses && typeof rawStatuses === "object" && !Array.isArray(rawStatuses)
    ? Object.fromEntries(Object.entries(rawStatuses).map(([address, status]) => [cleanText(address).toLowerCase(), cleanText(status)]).filter(([address, status]) => isEmail(address) && status))
    : {};
  const confidence = Number.isFinite(numericConfidence)
    ? Math.max(0, Math.min(100, numericConfidence <= 1 ? numericConfidence * 100 : numericConfidence))
    : null;

  return {
    email,
    note,
    confidence,
    emailSource: cleanText(data.emailSource || data.email_source || ""),
    emails: [...new Set([...(data.emails || []), ...workEmails, ...personalEmails, email].map((value) => cleanText(value).toLowerCase()).filter(isEmail))],
    workEmails,
    personalEmails,
    phones: [...new Set((data.phones || []).map(cleanText).filter(Boolean))],
    emailStatus: cleanText(data.emailStatus || data.email_status || ""),
    emailStatuses,
    profile: data.profile && typeof data.profile === "object" ? data.profile : null,
  };
}

export function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value));
}

export function resolveTheme(preference = "system", prefersDark = false) {
  if (preference === "light" || preference === "dark") return preference;
  return prefersDark ? "dark" : "light";
}
