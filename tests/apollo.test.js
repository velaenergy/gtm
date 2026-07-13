import assert from "node:assert/strict";
import test from "node:test";
import { apolloAccountStatus, enrichViaApollo, peopleSearchViaApollo } from "../lib/apollo.js";

test("Apollo people match uses x-api-key and only promotes verified email", async () => {
  const result = await enrichViaApollo({ url: "https://www.linkedin.com/in/alex-morgan", name: "Alex Morgan", experiences: [{ company: "Grid Works" }] }, {
    apiKey: "apollo-secret",
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, "https://api.apollo.io");
      assert.equal(url.pathname, "/api/v1/people/bulk_match");
      assert.equal(url.searchParams.get("reveal_personal_emails"), "true");
      assert.equal(options.headers["x-api-key"], "apollo-secret");
      assert.equal(JSON.parse(options.body).details[0].linkedin_url, "https://www.linkedin.com/in/alex-morgan");
      return { ok: true, status: 200, async json() { return { matches: [{ name: "Alex Morgan", title: "VP Operations", email: "alex@grid.example", email_status: "verified", employment_history: [{ organization_name: "Grid Works", title: "VP Operations", current: true }] }] }; } };
    },
  });
  assert.equal(result.email, "alex@grid.example");
  assert.equal(result.emailStatus, "verified");
  assert.equal(result.profile.company.name, "Grid Works");
});

test("Apollo people search maps filters and keeps LinkedIn profiles only", async () => {
  const result = await peopleSearchViaApollo({ job_title: ["Critical Operations"], location: ["Seattle"], keyword: "data center power" }, {
    apiKey: "apollo-secret",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.person_titles, ["Critical Operations"]);
      assert.deepEqual(body.person_locations, ["Seattle"]);
      assert.equal(body.q_keywords, "data center power");
      return { ok: true, status: 200, async json() { return { total_entries: 2, people: [{ linkedin_url: "https://www.linkedin.com/in/alex-morgan", name: "Alex Morgan", title: "VP Operations" }, { linkedin_url: "https://example.com/not-linkedin", name: "Ignore" }] }; } };
    },
  });
  assert.equal(result.total, 2);
  assert.equal(result.prospects.length, 1);
  assert.equal(result.prospects[0].url, "https://www.linkedin.com/in/alex-morgan");
});

test("Apollo rate limits honor Retry-After once", async () => {
  let calls = 0;
  const delays = [];
  const result = await apolloAccountStatus({
    apiKey: "apollo-secret",
    sleepImpl: async (delay) => delays.push(delay),
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(url.pathname, "/v1/auth/health");
      if (calls === 1) return { ok: false, status: 429, headers: { get: () => "2" }, async json() { return {}; } };
      return { ok: true, status: 200, async json() { return { healthy: true }; } };
    },
  });
  assert.deepEqual(result, { healthy: true });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});
