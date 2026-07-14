import test from "node:test";
import assert from "node:assert/strict";

import { buildWriterRequest, mergeEnrichedProfile, normalizeWorkNote, normalizeWriterResponse, openerQualityIssues, writerGenerationMode } from "../lib/ai-writer.js";
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
  assert.equal(request.profile.experiences[0].details, "Leads critical facilities.");
  assert.equal(request.profile.company.name, "Grid Works");
  assert.deepEqual(request.profile.skills, ["Power", "Critical Facilities"]);
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

test("V27 an explicit rewrite keeps the template draft and requests personalization only", () => {
  assert.equal(writerGenerationMode("personalization", { explicitRewrite: true }), "personalization");
  assert.equal(writerGenerationMode("full", { explicitRewrite: true }), "personalization");
  assert.equal(writerGenerationMode("personalization"), "personalization");
  const request = buildWriterRequest(
    { name: "Ben Kurian", headline: "Global Head of Cybersecurity" },
    { senderName: "Tarun", aiGenerationMode: "personalization" },
    "You lead cybersecurity across DWS.",
    { subject: "Current subject", body: "Hi Ben,\n\nCurrent full draft." },
    {
      generationMode: "personalization",
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
  assert.equal(request.generationMode, "personalization");
  assert.equal(request.recipient.email, "ben.kurian@dws.com");
  assert.equal(request.recipient.type, "work");
  assert.equal(request.currentDraft.body, "Hi Ben,\n\nCurrent full draft.");
  assert.deepEqual(request.template, {
    id: "quick-intro",
    name: "Quick intro",
    purpose: "Founder introduction",
    subjectPattern: "Template subject {{firstName}}",
    bodyBlueprint: "Template body {{workNote}}",
    renderedSubject: "Template subject Ben",
    renderedBody: "Template body You lead cybersecurity across DWS.",
  });
});

test("uses gpt-5.4-mini and strict structured output without storing the response", () => {
  const request = buildOpenAIRequest({ profile: { name: "Alex" } });
  assert.equal(request.model, "gpt-5.4-mini");
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.match(request.instructions, /only the workNote personalization slot/i);
  assert.match(request.instructions, /subject and body verbatim/i);
  assert.match(request.instructions, /Do not default to praise/);
  assert.match(request.instructions, /When context is thin, be honest and specific/);
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
  assert.match(openerQualityIssues("Hi Ben, I’m reaching out because you lead cybersecurity across DWS and I wanted to ask how your team approaches critical infrastructure risk.").join(" "), /greeting/i);
  assert.match(openerQualityIssues("Your current role at Wells Fargo and teaching experience, suggests you can explain complex systems.").join(" "), /inline template slot/i);
});

test("V27 ignores model-written email copy and preserves the rendered template", async () => {
  const result = await writeOutreach(
    {
      profile: { name: "Alex" },
      currentDraft: { subject: "Template subject", body: "Hi Alex,\n\nTemplate body.\n\nBest,\nTarun" },
    },
    {
      apiKey: "test-key",
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers.Authorization, "Bearer test-key");
        return {
          ok: true,
          async json() {
            return { output: [{ content: [{ type: "output_text", text: '{"subject":"AI changed this","body":"AI rewrote everything","workNote":"Your grid operations work at Relay and experience navigating interconnection delays for large energy users."}' }] }] };
          },
        };
      },
    },
  );
  assert.deepEqual(result, {
    subject: "Template subject",
    body: "Hi Alex,\n\nTemplate body.\n\nBest,\nTarun",
    workNote: "Your grid operations work at Relay and experience navigating interconnection delays for large energy users.",
  });
  assert.equal(responseOutputText({ output_text: "direct" }), "direct");
  assert.deepEqual(normalizeWriterResponse({ data: result, model: "gpt-5.4-mini" }), {
    ...result,
    model: "gpt-5.4-mini",
  });
});
