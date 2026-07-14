import assert from "node:assert/strict";
import test from "node:test";

import { searchPeopleWithProviders } from "../lib/people-search.js";

test("uses ContactOut People Search first and marks provider-sourced prospects", async () => {
  const result = await searchPeopleWithProviders(
    { job_title: ["Critical Operations"] },
    { contactOutApiKey: "contactout", apolloApiKey: "apollo" },
    {
      contactOutSearch: async (_filters, options) => {
        assert.equal(options.apiKey, "contactout");
        return { total: 1, prospects: [{ url: "https://www.linkedin.com/in/alex-morgan", name: "Alex Morgan" }] };
      },
      apolloSearch: async () => { throw new Error("Apollo should not run after a match"); },
    },
  );

  assert.equal(result.providerLabel, "ContactOut");
  assert.equal(result.prospects[0].source, "ContactOut People Search");
  assert.deepEqual(result.attempts, [{ provider: "CONTACTOUT", ok: true, count: 1 }]);
});

test("falls back from ContactOut to Apollo when the first provider fails", async () => {
  const result = await searchPeopleWithProviders(
    { keyword: "data center power" },
    { contactOutApiKey: "contactout", apolloApiKey: "apollo" },
    {
      contactOutSearch: async () => { throw new Error("ContactOut unavailable"); },
      apolloSearch: async (_filters, options) => {
        assert.equal(options.apiKey, "apollo");
        return { total: 1, prospects: [{ url: "https://www.linkedin.com/in/maya-chen", name: "Maya Chen" }] };
      },
    },
  );

  assert.equal(result.providerLabel, "Apollo");
  assert.equal(result.prospects[0].source, "Apollo People Search");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ok, false);
  assert.equal(result.attempts[1].ok, true);
});

test("requires an explicit contact-data provider instead of silently using LinkedIn", async () => {
  await assert.rejects(
    searchPeopleWithProviders({}, {}),
    /Connect ContactOut or Apollo in Settings/,
  );
});
