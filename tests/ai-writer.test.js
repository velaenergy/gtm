import test from "node:test";
import assert from "node:assert/strict";

import { buildWriterRequest, mergeEnrichedProfile, normalizeWorkNote, normalizeWriterResponse, openerQualityIssues } from "../lib/ai-writer.js";
import { buildOpenAIRequest, responseOutputText, writeOutreach } from "../server/openai-writer.mjs";

test("builds a bounded writer payload from visible profile data", () => {
  const request = buildWriterRequest(
    {
      name: "Alex Morgan",
      headline: "Grid operator",
      experiences: [{ title: "Founder", company: "Relay", details: " Builds grid software. " }],
    },
    { senderName: "Tarun", calendarUrl: "https://cal.com/team/velaenergy" },
    "their grid operations work",
    { subject: "Hello", body: "Draft" },
  );

  assert.equal(request.profile.experiences[0].details, "Builds grid software.");
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

test("uses gpt-5.4-mini and strict structured output without storing the response", () => {
  const request = buildOpenAIRequest({ profile: { name: "Alex" } });
  assert.equal(request.model, "gpt-5.4-mini");
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.match(request.instructions, /standalone, ready-to-send opener/);
  assert.match(request.instructions, /Do not default to praise/);
  assert.match(request.instructions, /When context is thin, be honest and specific/);
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
});

test("reads Responses API output and normalizes the server envelope", async () => {
  const result = await writeOutreach(
    { profile: { name: "Alex" } },
    {
      apiKey: "test-key",
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers.Authorization, "Bearer test-key");
        return {
          ok: true,
          async json() {
            return { output: [{ content: [{ type: "output_text", text: '{"subject":"Hi","body":"Hello","workNote":"I saw you lead grid operations at Relay and wanted to ask where interconnection delays create the most friction."}' }] }] };
          },
        };
      },
    },
  );
  assert.deepEqual(result, { subject: "Hi", body: "Hello", workNote: "I saw you lead grid operations at Relay and wanted to ask where interconnection delays create the most friction." });
  assert.equal(responseOutputText({ output_text: "direct" }), "direct");
  assert.deepEqual(normalizeWriterResponse({ data: result, model: "gpt-5.4-mini" }), {
    ...result,
    model: "gpt-5.4-mini",
  });
});
