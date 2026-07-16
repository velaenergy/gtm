import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResearchAgentRequest,
  buildSearchPlanRequest,
  planProspectSearch,
  respondToResearchMessage,
} from "../server/search-planner.mjs";

test("builds a strict, non-stored search planning request", () => {
  const request = buildSearchPlanRequest("data center power operators");
  assert.equal(request.store, false);
  assert.equal(request.model, "gpt-5.4-mini");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.properties.searches.minItems, 1);
  assert.equal(request.text.format.schema.properties.searches.maxItems, 1);
});

test("normalizes a structured Vela search plan", async () => {
  const plan = await planProspectSearch("data center power operators", {
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, async json() { return { output_text: JSON.stringify({ strategy: "Target operators", searches: [{ label: "Ops", query: "critical operations data center", rationale: "Direct responsibility", facets: ["operations"], filters: { job_title: ["Critical Operations"], seniority: ["manager"], skills: [], location: [], industry: [], company: [], keyword: "data center power" } }] }) }; } }),
  });
  assert.equal(plan.searches[0].query, "critical operations data center");
});

test("[V34] research assistant keeps ordinary conversation out of plan mode", async () => {
  const request = buildResearchAgentRequest("hey, how are you?", {
    history: [{ role: "user", content: "Can you explain how approvals work?" }, { role: "assistant", content: "Yes." }],
  });
  assert.equal(request.store, false);
  assert.equal(request.input.length, 3);
  assert.match(request.instructions, /Never turn ordinary conversation into a research plan/);
  assert.deepEqual(request.text.format.schema.properties.mode.enum, ["chat", "plan", "execute"]);

  const turn = await respondToResearchMessage("hey, how are you?", {
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, async json() { return { output_text: JSON.stringify({ mode: "chat", reply: "Doing well. What are you working on?", strategy: "", searches: [] }) }; } }),
  });
  assert.equal(turn.mode, "chat");
  assert.equal(turn.plan, null);
});

test("[V34] research assistant only executes when a pending plan exists", async () => {
  const fetchImpl = async () => ({ ok: true, async json() { return { output_text: JSON.stringify({ mode: "execute", reply: "Starting it now.", strategy: "", searches: [] }) }; } });
  const withoutPlan = await respondToResearchMessage("run it", { apiKey: "test-key", fetchImpl });
  assert.equal(withoutPlan.mode, "chat");
  assert.match(withoutPlan.reply, /isn’t a research plan ready/);

  const pendingPlan = { strategy: "Target operators", searches: [{ label: "Ops", query: "data center operators", rationale: "Direct responsibility", facets: [], filters: { job_title: ["Data Center Operations"], seniority: ["director"], skills: [], location: [], industry: [], company: [], keyword: "" } }] };
  const withPlan = await respondToResearchMessage("run it", { apiKey: "test-key", pendingPlan, fetchImpl });
  assert.equal(withPlan.mode, "execute");
});
