import assert from "node:assert/strict";
import test from "node:test";

import { searchPeopleWithProviders } from "../lib/people-search.js";

test("uses Apollo as the only people discovery source", async () => {
  const result = await searchPeopleWithProviders(
    { job_title: ["Critical Operations"] },
    { contactOutApiKey: "contactout", apolloApiKey: "apollo" },
    {
      apolloSearch: async (_filters, options) => {
        assert.equal(options.apiKey, "apollo");
        return { total: 1, prospects: [{ url: "https://www.linkedin.com/in/alex-morgan", name: "Alex Morgan" }] };
      },
    },
  );

  assert.equal(result.providerLabel, "Apollo");
  assert.equal(result.prospects[0].source, "Apollo People Search");
  assert.deepEqual(result.attempts, [{ provider: "APOLLO", ok: true, count: 1 }]);
});

test("requires Apollo instead of falling back to ContactOut or LinkedIn", async () => {
  await assert.rejects(
    searchPeopleWithProviders({}, { contactOutApiKey: "contactout" }),
    /Connect Apollo in Settings/,
  );
});
