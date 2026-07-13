import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchPlanRequest, planProspectSearch } from "../server/search-planner.mjs";

test("builds a strict, non-stored search planning request", () => {
  const request = buildSearchPlanRequest("data center power operators");
  assert.equal(request.store, false);
  assert.equal(request.model, "gpt-5.4-mini");
  assert.equal(request.text.format.strict, true);
});

test("normalizes a structured Vela search plan", async () => {
  const plan = await planProspectSearch("data center power operators", {
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, async json() { return { output_text: JSON.stringify({ strategy: "Target operators", searches: [{ label: "Ops", query: "critical operations data center", rationale: "Direct responsibility", facets: ["operations"], filters: { job_title: ["Critical Operations"], seniority: ["manager"], skills: [], location: [], industry: [], company: [], keyword: "data center power" } }] }) }; } }),
  });
  assert.equal(plan.searches[0].query, "critical operations data center");
});
