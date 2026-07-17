import test from "node:test";
import assert from "node:assert/strict";

import { buildWriterRequest, fullDraftQualityIssues, mergeEnrichedProfile, normalizeWorkNote, normalizeWriterResponse, openerQualityIssues, writerGenerationMode } from "../lib/ai-writer.js";
import { OUTREACH_SUBJECT } from "../lib/message.js";
import { buildOpenAIRequest, responseOutputText, writeOutreach } from "../server/openai-writer.mjs";

test("builds a bounded writer payload from visible profile data", () => {
  const request = buildWriterRequest(
    {
      name: "Alex Morgan",
      headline: "Grid operator",
      about: "I work on utility planning and grid reliability.",
      experiences: [{ title: "Founder", company: "Relay", details: " Builds grid software. " }],
    },
    { senderName: "Tarun", calendarUrl: "https://cal.com/team/velaenergy" },
    "their grid operations work",
    { subject: "Hello", body: "Draft" },
  );

  assert.equal(request.profile.experiences[0].details, "Builds grid software.");
  assert.equal(request.profile.about, "I work on utility planning and grid reliability.");
  assert.equal(request.sender.name, "Tarun");
  assert.equal(request.personalizationNote, "their grid operations work");
  assert.equal(request.currentOpener, "their grid operations work");
});

test("grounds the writer in richer ContactOut profile context", () => {
  const merged = mergeEnrichedProfile(
    { name: "Alex Morgan", headline: "Operator", experiences: [{ title: "Old role", company: "Old Co" }] },
    { emailSource: "ContactOut verified contact", profile: {
      linkedinUrl: "https://www.linkedin.com/in/alex-morgan",
      headline: "VP, Critical Operations",
      about: "Runs mission-critical infrastructure.",
      experiences: [{ title: "VP", company: "Grid Works", details: "Leads critical facilities." }],
      company: { name: "Grid Works", industry: "Data Centers" },
      industry: "Energy",
      skills: ["Power", "Critical Facilities"],
      source: "ContactOut",
    } },
  );
  const request = buildWriterRequest(merged, { senderName: "Tarun" });
  assert.equal(request.profile.headline, "VP, Critical Operations");
  assert.equal(merged.linkedinUrl, "https://www.linkedin.com/in/alex-morgan");
  assert.equal(request.profile.experiences[0].details, "Leads critical facilities.");
  assert.equal(request.profile.company.name, "Grid Works");
  assert.deepEqual(request.profile.skills, ["Power", "Critical Facilities"]);
});

test("enrichment upgrades first-name-only search results to the provider's full name", () => {
  const merged = mergeEnrichedProfile(
    { name: "Greg", headline: "Engineering leader" },
    { profile: { name: "Greg Miller", headline: "Sr Director, Engineering" } },
  );
  assert.equal(merged.name, "Greg Miller");
});

test("keeps richer LinkedIn role descriptions when provider experience is thinner", () => {
  const merged = mergeEnrichedProfile(
    {
      name: "Alex Morgan",
      about: "I build reliable infrastructure.",
      experiences: [{ title: "VP", company: "Grid Works", details: "Owns grid strategy and utility partnerships." }],
    },
    { profile: {
      headline: "VP, Critical Operations",
      experiences: [{ title: "VP", company: "Grid Works", dates: "2022 - Present", details: "" }],
    } },
  );
  assert.equal(merged.about, "I build reliable infrastructure.");
  assert.equal(merged.experiences[0].details, "Owns grid strategy and utility partnerships.");
});

test("[V47] enrichment preserves the actual LinkedIn profile URL", () => {
  const merged = mergeEnrichedProfile(
    { name: "Alex Morgan", experiences: [] },
    { profile: { linkedinUrl: "https://www.linkedin.com/in/alex-morgan", experiences: [] } },
  );
  assert.equal(merged.linkedinUrl, "https://www.linkedin.com/in/alex-morgan");
});

test("V27 an explicit rewrite sends the template as a guide and requests a complete email", () => {
  assert.equal(writerGenerationMode("personalization", { explicitRewrite: true }), "full");
  assert.equal(writerGenerationMode("full", { explicitRewrite: true }), "full");
  assert.equal(writerGenerationMode("personalization"), "full");
  const request = buildWriterRequest(
    { name: "Ben Kurian", headline: "Global Head of Cybersecurity" },
    { senderName: "Tarun", aiGenerationMode: "full" },
    "You lead cybersecurity across DWS.",
    { subject: "Current subject", body: "Hi Ben,\n\nCurrent full draft." },
    {
      generationMode: "full",
      recipient: { email: "ben.kurian@dws.com", type: "work", source: "ContactOut", verified: true },
      template: {
        id: "quick-intro",
        name: "Quick intro",
        eyebrow: "Founder introduction",
        subject: "Template subject {{firstName}}",
        body: "Template body {{workNote}}",
        renderedSubject: "Template subject Ben",
        renderedBody: "Template body You lead cybersecurity across DWS.",
      },
    },
  );
  assert.equal(request.generationMode, "full");
  assert.equal(request.recipient.email, "ben.kurian@dws.com");
  assert.equal(request.recipient.type, "work");
  assert.equal(request.currentDraft.body, "Hi Ben,\n\nCurrent full draft.");
  assert.deepEqual(request.template, {
    id: "quick-intro",
    name: "Quick intro",
    purpose: "Founder introduction",
    subjectPattern: OUTREACH_SUBJECT,
    bodyBlueprint: "Template body {{workNote}}",
    renderedSubject: OUTREACH_SUBJECT,
    renderedBody: "Template body You lead cybersecurity across DWS.",
  });
});

test("uses gpt-5.4-mini and strict structured output without storing the response", () => {
  const request = buildOpenAIRequest({ profile: { name: "Alex" } });
  assert.equal(request.model, "gpt-5.4-mini");
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.match(request.instructions, /complete, natural first-touch outreach email/i);
  assert.match(request.instructions, /fixed subject "Quick intro \+ seeking advice"/i);
  assert.equal(Object.hasOwn(request.text.format.schema.properties, "subject"), false);
  assert.match(request.instructions, /Do not hard-wrap lines inside a paragraph/i);
  assert.match(request.instructions, /regular ASCII hyphen/i);
  assert.match(request.instructions, /Do not say "grab any time here"/i);
  assert.match(request.instructions, /I came across your profile and/i);
  assert.match(request.instructions, /Do not recite the prospect's job title or position/i);
  assert.match(request.instructions, /Do not default to praise/);
  assert.match(request.instructions, /Do not summarize a resume into a flattering thesis/i);
  assert.match(request.instructions, /That mix of/i);
  assert.match(request.instructions, /When context is thin, be honest and general/);
  assert.match(request.instructions, /About section and each role description/i);
});

test("normalizes the complete opener as a ready-to-send sentence", () => {
  assert.equal(normalizeWorkNote("Opener: you lead site selection at VectorGrid"), "You lead site selection at VectorGrid.");
  assert.equal(normalizeWorkNote("How is power availability changing where your team can build?"), "How is power availability changing where your team can build?");
});

test("rejects short and generic AI outreach patterns", () => {
  assert.deepEqual(openerQualityIssues("I was really impressed by your background."), [
    "The opener is too short to feel meaningfully personalized.",
    "Do not default to saying you are impressed.",
  ]);
  assert.match(openerQualityIssues("Your work leading site selection across energy markets and critical infrastructure teams.").join(" "), /legacy personalization fragment/);
  assert.deepEqual(openerQualityIssues("You lead site selection at VectorGrid, and I wanted to ask how power availability is changing which markets your team can pursue."), []);
  assert.deepEqual(openerQualityIssues("I came across your profile and wanted to ask how power availability is changing the markets your team can pursue."), []);
  assert.match(openerQualityIssues("Hi Ben, I’m reaching out because you lead cybersecurity across DWS and I wanted to ask how your team approaches critical infrastructure risk.").join(" "), /greeting/i);
  assert.match(openerQualityIssues("Your current role at Wells Fargo and teaching experience, suggests you can explain complex systems.").join(" "), /inline template slot/i);
});

test("V27 validates natural complete drafts and required sender details", () => {
  const input = { sender: { name: "Tarun", calendarUrl: "https://cal.example/vela" } };
  assert.match(fullDraftQualityIssues({ subject: "Hi", body: "Too short", workNote: "Grid operations" }, input).join(" "), /too short/i);
  assert.match(fullDraftQualityIssues({
    subject: OUTREACH_SUBJECT,
    body: "Hi Alex,\n\nThis paragraph has enough words to make the accidental fixed-width\nline break visible even though it should flow naturally in Gmail. It continues with Vela context and a clear request for a short conversation next week.\n\nWould you have 20 minutes? https://cal.example/vela\n\nBest,\nTarun",
    workNote: "Alex leads grid operations at Relay.",
  }, input).join(" "), /fixed-width line breaks/i);
  assert.deepEqual(fullDraftQualityIssues({
    subject: OUTREACH_SUBJECT,
    body: "Hi Alex,\n\nI came across your profile and saw some of the grid operations work you’ve been doing around interconnection timing. I wanted to ask where large loads tend to lose the most time.\n\nI’m Tarun, one of the founders of Vela Energy, an early-stage startup building AI agents that help large energy users get powered on faster. Would you be open to a 20-minute conversation next week? https://cal.example/vela\n\nBest,\nTarun",
    workNote: "Alex leads grid operations at Relay.",
  }, input), []);
  assert.match(fullDraftQualityIssues({
    subject: OUTREACH_SUBJECT,
    body: "Hi Alex,\n\nYou are the VP of Grid Operations at Relay, where interconnection timing shapes which projects can move. I wanted to compare notes on the places large loads lose the most time.\n\nI’m Tarun, one of the founders of Vela Energy, an early-stage startup building AI agents that help large energy users get powered on faster. Would you be open to a 20-minute conversation next week? https://cal.example/vela\n\nBest,\nTarun",
    workNote: "Alex leads grid operations at Relay.",
  }, input).join(" "), /came across your profile.*job title or position/i);
  assert.match(fullDraftQualityIssues({
    subject: OUTREACH_SUBJECT,
    body: "Hi Alex,\n\nYou lead grid operations at Relay, where interconnection timing shapes which projects can move. I wanted to compare notes on the places large loads lose the most time.\n\nI’m Tarun, building Vela to help energy-intensive teams navigate utilities and power procurement. I'd really appreciate it if we could meet for 20–30 minutes. Grab any time here: https://cal.example/vela\n\nBest,\nTarun",
    workNote: "Alex leads grid operations at Relay.",
  }, input).join(" "), /regular hyphen.*grab any time here/i);
  assert.match(fullDraftQualityIssues({
    subject: OUTREACH_SUBJECT,
    body: "Hi April,\n\nI saw your background in procurement across EDP Renewables and now CyrusOne, especially the move from O&M procurement into infrastructure power procurement. That mix of renewables and large-load energy buying is exactly the kind of experience we'd like to learn from.\n\nI’m Tarun, building Vela Energy. We’re still learning how teams like yours source power, and I’d appreciate 20-30 minutes to ask a few questions from your side of the table.\n\nIf you're open to it: https://cal.example/vela\n\nBest,\nTarun",
    workNote: "April works in infrastructure power procurement at CyrusOne.",
  }, input).join(" "), /resume-style synthesis/i);
});

test("uses the canonical subject while keeping model-written body structure", async () => {
  const generated = {
    body: "Hi Alex,\n\nI came across your profile and saw some of the grid operations work you’ve been doing around interconnection. I wanted to ask where large-load projects tend to hit the most avoidable delays.\n\nI’m Tarun, one of the founders of Vela Energy, an early-stage startup building AI agents that help energy-intensive teams get powered on faster.\n\nWould you be open to a 20-minute conversation next week? https://cal.com/team/velaenergy\n\nBest,\nTarun",
    workNote: "Alex leads grid operations at Relay and works through interconnection delays for large energy users.",
  };
  const result = await writeOutreach(
    {
      profile: { name: "Alex" },
      sender: { name: "Tarun", calendarUrl: "https://cal.com/team/velaenergy" },
      currentDraft: { subject: "Template subject", body: "Hi Alex,\n\nTemplate body.\n\nBest,\nTarun" },
    },
    {
      apiKey: "test-key",
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers.Authorization, "Bearer test-key");
        return {
          ok: true,
          async json() {
            return { output: [{ content: [{ type: "output_text", text: JSON.stringify(generated) }] }] };
          },
        };
      },
    },
  );
  assert.deepEqual(result, { ...generated, subject: OUTREACH_SUBJECT });
  assert.equal(responseOutputText({ output_text: "direct" }), "direct");
  assert.deepEqual(normalizeWriterResponse({ data: result, model: "gpt-5.4-mini" }), {
    ...result,
    model: "gpt-5.4-mini",
  });
});
