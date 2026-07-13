import test from "node:test";
import assert from "node:assert/strict";

import {
  TEMPLATES,
  applyTemplate,
  buildWorkNote,
  gmailComposeUrl,
  initialsFor,
  isEmail,
  normalizeEnrichmentResponse,
  resolveTheme,
  templateVariables,
} from "../lib/message.js";

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
  const variables = templateVariables(profile, { senderName: "Tarun", calendarUrl: "https://cal.com/team/velaenergy" });
  const message = applyTemplate(TEMPLATES[0], variables);
  assert.match(message.subject, /Quick intro/);
  assert.match(message.body, /^Hi Joshua,/);
  assert.match(message.body, /a16z Speedrun and Z Fellows/);
  assert.match(message.body, /20-30 minutes/);
  assert.doesNotMatch(message.body, /20[–—]30/);
  assert.doesNotMatch(message.body, /{{\w+}}/);
});

test("gmailComposeUrl safely encodes message fields", () => {
  const url = new URL(gmailComposeUrl({ to: "josh@example.com", subject: "A + B", body: "Hi Josh,\nTalk soon?" }));
  assert.equal(url.hostname, "mail.google.com");
  assert.equal(url.searchParams.get("to"), "josh@example.com");
  assert.equal(url.searchParams.get("su"), "A + B");
  assert.equal(url.searchParams.get("body"), "Hi Josh,\nTalk soon?");
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
