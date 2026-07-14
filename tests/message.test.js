import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  TEMPLATES,
  applyTemplate,
  buildWorkNote,
  contactOutConnectionState,
  deliveryRecipientEmails,
  emailTemplates,
  gmailComposeUrl,
  inlinePhrase,
  mailtoComposeUrl,
  initialsFor,
  isEmail,
  migrateLegacyQuickIntroDraft,
  normalizeEnrichmentResponse,
  normalizeEmailTemplates,
  normalizeRecipientSelection,
  recipientSelectionContext,
  resolveTheme,
  templateVariables,
} from "../lib/message.js";

test("ContactOut connection failures distinguish signed-out from broken sessions", () => {
  assert.equal(contactOutConnectionState({ checking: true }), "checking");
  assert.equal(contactOutConnectionState({ connected: true }), "connected");
  assert.equal(contactOutConnectionState({ disabled: true }), "disabled");
  assert.equal(contactOutConnectionState({ code: "login_required", detail: "No ContactOut tab is signed in." }), "signed-out");
  assert.equal(contactOutConnectionState({ detail: "ContactOut returned HTTP 500." }), "error");
});

test("recipient selection defaults to exactly one verified address", () => {
  const recipients = ["primary@example.com", "alternate@example.com"];
  assert.equal(DEFAULT_SETTINGS.allowMultipleRecipients, false);
  assert.equal(DEFAULT_SETTINGS.deliveryMethod, "gmail");
  assert.deepEqual(
    normalizeRecipientSelection(recipients, recipients),
    ["primary@example.com"],
  );
  assert.deepEqual(
    normalizeRecipientSelection(recipients, [], { preferred: "alternate@example.com" }),
    ["alternate@example.com"],
  );
});

test("recipient selection keeps multiple addresses only after opt-in", () => {
  assert.deepEqual(
    normalizeRecipientSelection(
      ["primary@example.com", "alternate@example.com"],
      ["alternate@example.com", "primary@example.com"],
      { allowMultiple: true },
    ),
    ["alternate@example.com", "primary@example.com"],
  );
});

test("V22 selecting an alternate verified recipient promotes it into compose context", () => {
  assert.deepEqual(recipientSelectionContext("BEN.KURIAN@DWS.COM", {
    emails: ["benkurian@gmail.com", "ben.kurian@dws.com"],
    workEmails: ["ben.kurian@dws.com"],
    personalEmails: ["benkurian@gmail.com"],
    emailStatuses: {
      "benkurian@gmail.com": "verified",
      "ben.kurian@dws.com": "valid",
    },
  }, "Personal email confirmed by ContactOut"), {
    email: "ben.kurian@dws.com",
    emailVerified: true,
    emailType: "work",
    emailSource: "Work email selected · confirmed by ContactOut",
  });
});

test("V19 manual Gmail compose accepts a valid visible email while direct send stays verified-only", () => {
  const input = {
    currentEmail: "visible@example.com",
    verifiedEmails: [],
    selectedRecipients: [],
  };
  assert.deepEqual(deliveryRecipientEmails({ ...input, gmailConnected: false }), ["visible@example.com"]);
  assert.deepEqual(deliveryRecipientEmails({ ...input, gmailConnected: true }), []);
});

const profile = {
  name: "Joshua Rivera",
  headline: "Critical operations leader",
  experiences: [
    { title: "VP, Operations", company: "Stream Data Centers" },
    { title: "Data Center Operations", company: "AWS" },
    { title: "Nuclear Operator", company: "U.S. Navy" },
  ],
};

test("buildWorkNote turns experience into a specific, grammatical phrase", () => {
  assert.equal(
    buildWorkNote(profile),
    "your work as VP, Operations at Stream Data Centers, including your experience with AWS and U.S. Navy",
  );
});

test("the default outreach play resolves all variables", () => {
  const opener = "You have led operations across Stream Data Centers, AWS, and the Navy; I wanted to ask where large loads lose the most time getting powered.";
  const inlineOpener = "you have led operations across Stream Data Centers, AWS, and the Navy; I wanted to ask where large loads lose the most time getting powered";
  const variables = templateVariables(profile, { senderName: "Tarun", calendarUrl: "https://cal.com/team/velaenergy" }, opener);
  const message = applyTemplate(TEMPLATES[0], variables);
  assert.match(message.subject, /Quick intro/);
  assert.match(message.body, /^Hi Joshua,/);
  assert.match(message.body, /a16z Speedrun and Z Fellows/);
  assert.ok(message.body.indexOf(inlineOpener) < message.body.indexOf("I'm Tarun, CEO"));
  assert.match(message.body, /really impressed by/i);
  assert.match(message.body, /Tony \(my co-founder\)/);
  assert.match(message.body, /AI agent products that help large energy loads get powered on faster/);
  assert.match(message.body, /would love to pick your brain/i);
  assert.match(message.body, /20-30 minutes/);
  assert.doesNotMatch(message.body, /\[[^\]]+\]\(https?:\/\//);
  assert.doesNotMatch(message.body, /20[–—]30/);
  assert.doesNotMatch(message.body, /{{\w+}}/);
});

test("inline personalization is grammatical inside the pick-your-brain template", () => {
  const workNote = "Your current role in information security at Atlantic Union Bank seems directly relevant to how large systems stay reliable under pressure..";
  assert.equal(
    inlinePhrase(workNote),
    "your current role in information security at Atlantic Union Bank seems directly relevant to how large systems stay reliable under pressure",
  );
  const variables = templateVariables({ name: "Micah" }, DEFAULT_SETTINGS, workNote);
  const message = applyTemplate(TEMPLATES[0], variables);
  assert.match(message.body, /impressed by your current role/);
  assert.doesNotMatch(message.body, /\.\./);
});

test("migrates only the untouched legacy quick-intro template", () => {
  const legacyBody = `Hi {{firstName}},

Came across your profile and was really impressed by {{workNote}}.

A bit about me: I'm {{senderName}}, CEO of Vela Energy. Tony (my co-founder) and I both come from energy-intensive backgrounds. I’m a nationally recognized inventor in energy, and Tony actually left his role at Tesla to build Vela with me full-time. We recently raised $1.3M from a16z Speedrun and Z Fellows to build AI agent products that help large energy loads get powered on faster.

Super interested in learning more about your work, and would love to pick your brain as we build this out. Would you have 20-30 minutes in the coming week for a chat? {{calendarUrl}}

Looking forward to hearing from you.

Best,
{{senderName}}`;
  const [migrated] = emailTemplates({ emailTemplates: [{
    id: "quick-intro",
    name: "Quick intro",
    eyebrow: "Pick their brain",
    subject: "Quick intro + would love to pick your brain",
    body: legacyBody,
  }] });
  assert.equal(migrated.subject, TEMPLATES[0].subject);
  assert.equal(migrated.body, TEMPLATES[0].body);

  const [custom] = emailTemplates({ emailTemplates: [{
    id: "quick-intro",
    name: "Quick intro",
    subject: "Quick intro + would love to pick your brain",
    body: `${legacyBody}\n\nCustom line`,
  }] });
  assert.match(custom.body, /Custom line$/);

  const variables = templateVariables(profile, { senderName: "Tarun", calendarUrl: "https://cal.com/team/velaenergy" });
  const migratedDraft = migrateLegacyQuickIntroDraft(
    applyTemplate({ subject: "Quick intro + would love to pick your brain", body: legacyBody }, variables),
    variables,
  );
  assert.equal(migratedDraft.subject, TEMPLATES[0].subject);
  assert.match(migratedDraft.body, /I'm Tarun, CEO of Vela Energy/);
});

test("updates the prior untouched built-in quick intro without overwriting custom templates", () => {
  const previousBody = `Hi {{firstName}},

I'm {{senderName}}, CEO of Vela Energy. My cofounder Tony Li and I recently raised a $1.3M pre-seed round from a16z Speedrun and Z Fellows. We both come from energy-intensive backgrounds: I'm a nationally recognized inventor in energy, and Tony left Tesla to build Vela with me full-time.

{{workNote}}

We're building AI agents that help large energy loads get powered on faster, and I'd really value your perspective as we build. Would you have 20-30 minutes for a call sometime next week? {{calendarUrl}}

Best,
{{senderName}}`;
  const [updated] = emailTemplates({ emailTemplates: [{
    id: "quick-intro",
    name: "Quick intro",
    subject: "Quick intro — would value your perspective",
    body: previousBody,
  }] });
  assert.equal(updated.subject, "Quick intro + would love to pick your brain");
  assert.match(updated.body, /Tony \(my co-founder\)/);

  const [custom] = emailTemplates({ emailTemplates: [{
    id: "quick-intro",
    name: "My custom intro",
    subject: "A custom subject",
    body: `${previousBody}\n\nCustom closing`,
  }] });
  assert.equal(custom.subject, "A custom subject");
  assert.match(custom.body, /Custom closing$/);
});

test("gmailComposeUrl safely encodes message fields", () => {
  const url = new URL(gmailComposeUrl({ to: "josh@example.com", subject: "A + B", body: "Hi Josh,\nTalk soon?" }));
  assert.equal(url.hostname, "mail.google.com");
  assert.equal(url.searchParams.get("to"), "josh@example.com");
  assert.equal(url.searchParams.get("su"), "A + B");
  assert.equal(url.searchParams.get("body"), "Hi Josh,\nTalk soon?");
});

test("mailtoComposeUrl safely encodes a default email-app draft", () => {
  const url = new URL(mailtoComposeUrl({ to: "josh@example.com", subject: "A + B", body: "Hi Josh,\nTalk soon?" }));
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, "josh@example.com");
  assert.equal(url.searchParams.get("subject"), "A + B");
  assert.equal(url.searchParams.get("body"), "Hi Josh,\nTalk soon?");
});

test("normalizes reusable named templates and keeps stable unique IDs", () => {
  const templates = normalizeEmailTemplates([
    { id: "operator", name: "Operator", subject: "Hi {{firstName}}", body: "About {{shortRole}}" },
    { id: "operator", name: "Follow up", subject: "Following up", body: "Hi again" },
    { id: "incomplete", name: "Incomplete", subject: "", body: "Missing subject" },
  ]);
  assert.deepEqual(templates.map((template) => template.id), ["operator", "operator-2"]);
  assert.equal(emailTemplates({ emailTemplates: templates })[1].name, "Follow up");
});

test("keeps sender identity and calendar URL with each email template", () => {
  const [template] = emailTemplates({
    senderName: "Legacy sender",
    calendarUrl: "https://cal.example/legacy",
    emailTemplates: [{
      id: "founder-note",
      name: "Founder note",
      senderName: "Maya",
      calendarUrl: "https://cal.example/maya",
      subject: "Hello {{firstName}}",
      body: "Best, {{senderName}} — {{calendarUrl}}",
    }],
  });
  const variables = templateVariables(profile, DEFAULT_SETTINGS, "", template);
  assert.equal(template.senderName, "Maya");
  assert.equal(template.calendarUrl, "https://cal.example/maya");
  assert.equal(applyTemplate(template, variables).body, "Best, Maya — https://cal.example/maya");
});

test("normalizes common enrichment response shapes and confidence scales", () => {
  assert.deepEqual(normalizeEnrichmentResponse({ data: { work_email: "JOSH@EXAMPLE.COM", email_confidence: 0.92, summary: "  Runs critical ops. " } }), {
    email: "josh@example.com",
    note: "Runs critical ops.",
    confidence: 92,
    emailSource: "",
    emails: ["josh@example.com"],
    workEmails: [],
    personalEmails: [],
    phones: [],
    emailStatus: "",
    emailStatuses: {},
    profile: null,
  });
});

test("preserves per-address ContactOut verification statuses", () => {
  const result = normalizeEnrichmentResponse({
    email: "alex@grid.example",
    emails: ["alex@grid.example"],
    emailStatus: "verified",
    emailStatuses: { "ALEX@GRID.EXAMPLE": "verified" },
  });
  assert.equal(result.emailStatus, "verified");
  assert.deepEqual(result.emailStatuses, { "alex@grid.example": "verified" });
});

test("email and initials helpers handle normal and empty values", () => {
  assert.equal(initialsFor("Joshua Rivera"), "JR");
  assert.equal(initialsFor(""), "VG");
  assert.equal(isEmail("josh@example.com"), true);
  assert.equal(isEmail("not an email"), false);
});

test("theme preference resolves explicit and system modes", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("unexpected", false), "light");
});
