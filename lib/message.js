export const DEFAULT_SETTINGS = Object.freeze({
  endpointUrl: "",
  apiToken: "",
  writerEndpointUrl: "",
  writerToken: "",
  googleWebClientId: "185496922277-dnn33q788othssrcu92719cbo34e21o0.apps.googleusercontent.com",
  contactOutSessionEnabled: true,
  contactOutApiKey: "",
  apolloApiKey: "",
  openAIApiKey: "",
  openAIModel: "gpt-5.4-mini",
  includeContactOutPhone: false,
  allowMultipleRecipients: false,
  deliveryMethod: "gmail",
  autoEnrich: true,
  aiGenerationMode: "personalization",
  templateSubject: "",
  templateBody: "",
  emailTemplates: [],
  theme: "system",
  senderName: "Tarun",
  calendarUrl: "https://cal.com/team/velaenergy",
});

const PICK_YOUR_BRAIN_INTRO = Object.freeze({
  subject: "Quick intro + would love to pick your brain",
  body: `Hi {{firstName}},

Came across your profile and was really impressed by {{workNoteInline}}.

A bit about me: I'm {{senderName}}, CEO of Vela Energy. Tony (my co-founder) and I both come from energy-intensive backgrounds. I’m a nationally recognized inventor in energy, and Tony actually left his role at Tesla to build Vela with me full-time. We recently raised $1.3M from a16z Speedrun and Z Fellows to build AI agent products that help large energy loads get powered on faster.

Super interested in learning more about your work, and would love to pick your brain as we build this out. Would you have 20-30 minutes in the coming week for a chat? {{calendarUrl}}

Looking forward to hearing from you.

Best,
{{senderName}}`,
});

const PREVIOUS_PICK_YOUR_BRAIN_INTRO = Object.freeze({
  ...PICK_YOUR_BRAIN_INTRO,
  body: PICK_YOUR_BRAIN_INTRO.body.replace("{{workNoteInline}}", "{{workNote}}"),
});

const PREVIOUS_QUICK_INTRO = Object.freeze({
  subject: "Quick intro — would value your perspective",
  body: `Hi {{firstName}},

I'm {{senderName}}, CEO of Vela Energy. My cofounder Tony Li and I recently raised a $1.3M pre-seed round from a16z Speedrun and Z Fellows. We both come from energy-intensive backgrounds: I'm a nationally recognized inventor in energy, and Tony left Tesla to build Vela with me full-time.

{{workNote}}

We're building AI agents that help large energy loads get powered on faster, and I'd really value your perspective as we build. Would you have 20-30 minutes for a call sometime next week? {{calendarUrl}}

Best,
{{senderName}}`,
});

export const TEMPLATES = Object.freeze([
  {
    id: "quick-intro",
    name: "Quick intro + pick your brain",
    eyebrow: "Founder introduction",
    ...PICK_YOUR_BRAIN_INTRO,
  },
  {
    id: "operator-intro",
    name: "Operator intro",
    eyebrow: "Energy + infrastructure",
    subject: "A quick question about {{shortRole}}",
    body: `Hi {{firstName}},

I'm {{senderName}}, CEO of Vela Energy. We're building AI agents that help large energy loads navigate utilities, interconnection, and power procurement so they can get energized faster.

{{workNote}}

Would you be open to a 20-minute conversation next week? {{calendarUrl}}

Best,
{{senderName}}`,
  },
  {
    id: "follow-up",
    name: "Warm follow-up",
    eyebrow: "Short and direct",
    subject: "Re: quick Vela introduction",
    body: `Hi {{firstName}},

Just following up in case my earlier note got buried.

{{workNote}}

Would a quick 20-minute call next week work? {{calendarUrl}}

Best,
{{senderName}}`,
  },
]);

export function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

export function normalizeRecipientSelection(recipients = [], selected = [], { allowMultiple = false, preferred = "" } = {}) {
  const available = [...new Set((Array.isArray(recipients) ? recipients : [])
    .map((email) => cleanText(email).toLowerCase())
    .filter(isEmail))];
  const allowed = new Set(available);
  const chosen = [...new Set((Array.isArray(selected) ? selected : [...(selected || [])])
    .map((email) => cleanText(email).toLowerCase())
    .filter((email) => allowed.has(email)))];
  const preferredEmail = cleanText(preferred).toLowerCase();
  const normalized = chosen.length
    ? chosen
    : available.length
      ? [allowed.has(preferredEmail) ? preferredEmail : available[0]]
      : [];
  return allowMultiple ? normalized : normalized.slice(0, 1);
}

export function emailVerificationState(status = "", verified = false) {
  const normalized = cleanText(status).toLowerCase().replace(/[\s-]+/g, "_");
  if (verified || ["verified", "valid"].includes(normalized)) return "verified";
  if (["checking", "pending", "processing", "queued", "in_progress"].includes(normalized)) return "pending";
  if (["invalid", "disposable"].includes(normalized)) return "blocked";
  return "unverified";
}

export function contactEmailCandidates({ currentEmail = "", currentEmailVerified = false, contactDetails = {} } = {}) {
  const normalizeEmails = (...groups) => [...new Set(groups.flat()
    .map((email) => cleanText(email).toLowerCase())
    .filter(isEmail))];
  const workEmails = new Set(normalizeEmails(contactDetails.workEmails || [], contactDetails.unverifiedWorkEmails || []));
  const personalEmails = new Set(normalizeEmails(contactDetails.personalEmails || [], contactDetails.unverifiedPersonalEmails || []));
  const statuses = Object.fromEntries(Object.entries(contactDetails.emailStatuses || {})
    .map(([email, status]) => [cleanText(email).toLowerCase(), cleanText(status)]));
  const normalizedCurrent = cleanText(currentEmail).toLowerCase();
  const emails = normalizeEmails(
    contactDetails.emails || [],
    contactDetails.unverifiedEmails || [],
    [...workEmails],
    [...personalEmails],
    normalizedCurrent,
  );

  return emails.map((email) => {
    const status = statuses[email] || (email === normalizedCurrent && currentEmailVerified ? "verified" : "");
    const verification = emailVerificationState(status, email === normalizedCurrent && currentEmailVerified);
    return {
      email,
      status,
      verification,
      selectable: verification !== "blocked",
      type: workEmails.has(email) ? "work" : personalEmails.has(email) ? "personal" : "other",
    };
  });
}

export function recipientSelectionContext(email = "", contactDetails = {}, priorSource = "") {
  const selected = cleanText(email).toLowerCase();
  const statuses = contactDetails?.emailStatuses || {};
  const status = cleanText(statuses[selected] || statuses[email]).toLowerCase();
  const emailVerified = isEmail(selected) && ["verified", "valid"].includes(status);
  const workEmails = new Set([...(contactDetails?.workEmails || []), ...(contactDetails?.unverifiedWorkEmails || [])].map((value) => cleanText(value).toLowerCase()));
  const personalEmails = new Set([...(contactDetails?.personalEmails || []), ...(contactDetails?.unverifiedPersonalEmails || [])].map((value) => cleanText(value).toLowerCase()));
  const emailType = workEmails.has(selected) ? "work" : personalEmails.has(selected) ? "personal" : "other";
  const provider = cleanText(priorSource).match(/ContactOut|Apollo/i)?.[0] || "provider";
  const typeLabel = emailType === "work" ? "Work" : emailType === "personal" ? "Personal" : "Contact";
  const verification = emailVerificationState(status);
  return {
    email: selected,
    emailVerified,
    emailType,
    emailSource: emailVerified
      ? `${typeLabel} email selected · confirmed by ${provider}`
      : verification === "pending"
        ? `${typeLabel} email selected · ${provider} verification in progress`
        : `${typeLabel} email selected · not fully verified by ${provider}`,
  };
}

export function deliveryRecipientEmails({
  deliveryMethod = "gmail",
  gmailConnected = false,
  currentEmail = "",
  verifiedEmails = [],
  visibleEmails = [],
  selectedRecipients = [],
  allowMultiple = false,
} = {}) {
  const manualHandoff = deliveryMethod === "mailto" || !gmailConnected;
  const current = isEmail(currentEmail) ? String(currentEmail).trim().toLowerCase() : "";
  const verified = [...new Set(verifiedEmails.map((email) => cleanText(email).toLowerCase()).filter(isEmail))];
  const selected = [...new Set((Array.isArray(selectedRecipients) ? selectedRecipients : [...(selectedRecipients || [])])
    .map((email) => cleanText(email).toLowerCase())
    .filter(isEmail))];
  if (!manualHandoff && selected.some((email) => !verified.includes(email))) return [];
  const candidates = manualHandoff
    ? [...new Set([current, ...visibleEmails, ...verified].map((email) => cleanText(email).toLowerCase()).filter(isEmail))]
    : verified;
  return normalizeRecipientSelection(candidates, selectedRecipients, {
    allowMultiple,
    preferred: current,
  });
}

export function contactOutConnectionState({ connected = false, checking = false, disabled = false, code = "", detail = "" } = {}) {
  if (disabled) return "disabled";
  if (checking) return "checking";
  if (connected) return "connected";
  if (code === "login_required" || /sign[ -]?in|log[ -]?in/i.test(detail)) return "signed-out";
  return detail ? "error" : "signed-out";
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

export function inlinePhrase(value = "") {
  const clean = cleanText(value).replace(/[.!?]+$/, "");
  return clean.replace(/^([A-Z])(?=[a-z])/, (initial) => initial.toLowerCase());
}

export function templateVariables(profile = {}, settings = {}, workNote = "", template = {}) {
  const resolvedNote = cleanText(workNote);
  return {
    firstName: getFirstName(profile.name),
    senderName: cleanText(template.senderName) || cleanText(settings.senderName) || DEFAULT_SETTINGS.senderName,
    calendarUrl: cleanText(template.calendarUrl) || cleanText(settings.calendarUrl) || DEFAULT_SETTINGS.calendarUrl,
    workNote: resolvedNote,
    workNoteInline: inlinePhrase(resolvedNote),
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

export function outreachTemplate(settings = {}) {
  return emailTemplates(settings)[0];
}

function templateId(value = "", index = 0) {
  const normalized = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || `template-${index + 1}`;
}

export function normalizeEmailTemplates(value = []) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((template, index) => {
    if (!template || typeof template !== "object") return null;
    const name = cleanText(template.name) || `Template ${index + 1}`;
    let id = templateId(template.id || name, index);
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return {
      id,
      name,
      eyebrow: cleanText(template.eyebrow) || "Saved template",
      senderName: cleanText(template.senderName),
      calendarUrl: cleanText(template.calendarUrl),
      subject: String(template.subject || "").trim(),
      body: String(template.body || "").trim(),
    };
  }).filter((template) => template && template.subject && template.body).slice(0, 20);
}

export function emailTemplates(settings = {}) {
  const saved = normalizeEmailTemplates(settings.emailTemplates);
  const senderName = cleanText(settings.senderName) || DEFAULT_SETTINGS.senderName;
  const calendarUrl = cleanText(settings.calendarUrl) || DEFAULT_SETTINGS.calendarUrl;
  const withSender = (template) => ({
    ...template,
    senderName: cleanText(template.senderName) || senderName,
    calendarUrl: cleanText(template.calendarUrl) || calendarUrl,
  });
  if (saved.length) {
    return saved.map((template) => {
      const untouchedQuickIntro = template.id === "quick-intro" && (
        (template.subject === PREVIOUS_QUICK_INTRO.subject && template.body === PREVIOUS_QUICK_INTRO.body)
        || (template.subject === PREVIOUS_PICK_YOUR_BRAIN_INTRO.subject && template.body === PREVIOUS_PICK_YOUR_BRAIN_INTRO.body)
      );
      return untouchedQuickIntro
        ? withSender({ ...TEMPLATES[0], senderName: template.senderName, calendarUrl: template.calendarUrl })
        : withSender(template);
    });
  }
  const defaults = TEMPLATES.map((template) => withSender(template));
  if (String(settings.templateSubject || "").trim()) defaults[0].subject = String(settings.templateSubject).trim();
  if (String(settings.templateBody || "").trim()) defaults[0].body = String(settings.templateBody).trim();
  return defaults;
}

export function migrateLegacyQuickIntroDraft(draft = {}, variables = {}) {
  for (const previousTemplate of [PREVIOUS_QUICK_INTRO, PREVIOUS_PICK_YOUR_BRAIN_INTRO]) {
    const previous = applyTemplate(previousTemplate, variables);
    if (String(draft.subject || "") === previous.subject && String(draft.body || "") === previous.body) {
      return applyTemplate(TEMPLATES[0], variables);
    }
  }
  return draft;
}

export function gmailComposeUrl({ to = "", subject = "", body = "" } = {}) {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (cleanText(to)) params.set("to", cleanText(to));
  if (subject) params.set("su", subject);
  if (body) params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function mailtoComposeUrl({ to = "", subject = "", body = "" } = {}) {
  const recipient = encodeURIComponent(cleanText(to)).replace(/%40/gi, "@");
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${recipient}${params.length ? `?${params.join("&")}` : ""}`;
}

export function normalizeEnrichmentResponse(payload = {}) {
  const data = payload?.data || payload?.person || payload?.contact || payload || {};
  const email = cleanText(data.email || data.workEmail || data.work_email || "").toLowerCase();
  const workEmails = [...new Set((data.workEmails || data.work_emails || []).map((value) => cleanText(value).toLowerCase()).filter(isEmail))];
  const personalEmails = [...new Set((data.personalEmails || data.personal_emails || []).map((value) => cleanText(value).toLowerCase()).filter(isEmail))];
  const unverifiedEmails = [...new Set((data.unverifiedEmails || data.unverified_emails || []).map((value) => cleanText(value).toLowerCase()).filter(isEmail))];
  const unverifiedWorkEmails = [...new Set((data.unverifiedWorkEmails || data.unverified_work_emails || []).map((value) => cleanText(value).toLowerCase()).filter(isEmail))];
  const unverifiedPersonalEmails = [...new Set((data.unverifiedPersonalEmails || data.unverified_personal_emails || []).map((value) => cleanText(value).toLowerCase()).filter(isEmail))];
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
    unverifiedEmails,
    unverifiedWorkEmails,
    unverifiedPersonalEmails,
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
