import assert from "node:assert/strict";
import test from "node:test";
import { apolloAccountStatus, broadenApolloPeopleFilters, enrichViaApollo, peopleSearchViaApollo, searchApolloPeopleWithRecovery, titlesOnlyApolloPeopleFilters } from "../lib/apollo.js";

test("Apollo people match uses x-api-key and only promotes verified email", async () => {
  const result = await enrichViaApollo({ url: "https://www.linkedin.com/in/alex-morgan", name: "Alex Morgan", experiences: [{ company: "Grid Works" }] }, {
    apiKey: "apollo-secret",
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, "https://api.apollo.io");
      assert.equal(url.pathname, "/v1/people/bulk_enrich");
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

test("Apollo people search maps filters and keeps API-ID results without requiring LinkedIn", async () => {
  const result = await peopleSearchViaApollo({ job_title: ["Critical Operations"], location: ["Seattle"], keyword: "data center power" }, {
    apiKey: "apollo-secret",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.person_titles, ["Critical Operations"]);
      assert.deepEqual(body.person_locations, ["Seattle"]);
      assert.equal(body.q_keywords, "data center power");
      assert.equal(body.per_page, 100);
      return { ok: true, status: 200, async json() { return { total_entries: 2, people: [{ linkedin_url: "https://www.linkedin.com/in/alex-morgan", name: "Alex Morgan", title: "VP Operations" }, { linkedin_url: "https://example.com/not-linkedin", name: "Ignore" }] }; } };
    },
  });
  assert.equal(result.total, 2);
  assert.equal(result.prospects.length, 2);
  assert.equal(result.prospects[0].url, "https://www.linkedin.com/in/alex-morgan");
});

test("Apollo people search keeps ID-only results and caps one page at 100", async () => {
  const result = await peopleSearchViaApollo({ limit: 500 }, {
    apiKey: "apollo-secret",
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, "/api/v1/mixed_people/api_search");
      assert.equal(JSON.parse(options.body).per_page, 100);
      return { ok: true, status: 200, async json() { return { total_entries: 1, people: [{ id: "apollo-1", first_name: "Avery", last_name_obfuscated: "Sm***", title: "VP Power" }] }; } };
    },
  });
  assert.equal(result.prospects.length, 1);
  assert.equal(result.prospects[0].providerId, "apollo-1");
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

test("[V33] Apollo zero results get one safe broader attempt before becoming empty", async () => {
  const calls = [];
  let retries = 0;
  const result = await searchApolloPeopleWithRecovery({
    job_title: ["VP Critical Operations"],
    company: ["Northstar"],
    location: ["Seattle"],
    seniority: ["vp"],
    industry: ["data centers"],
    skills: ["power"],
    keyword: "grid interconnection",
  }, {
    search: async (filters) => {
      calls.push(filters);
      return calls.length === 1 ? { total: 0, prospects: [] } : { total: 4, prospects: [{ providerId: "apollo-1" }] };
    },
    onRetry: async () => { retries += 1; },
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.broadened, true);
  assert.equal(result.data.prospects.length, 1);
  assert.equal(retries, 1);
  assert.deepEqual(calls[1].company, ["Northstar"]);
  assert.deepEqual(calls[1].location, ["Seattle"]);
  assert.equal(calls[1].keyword, undefined);
  assert.equal(calls[1].industry, undefined);
  assert.equal(calls[1].include_similar_titles, true);
});

test("[V33] title-only retry is explicit and drops every non-title audience constraint", () => {
  const filters = titlesOnlyApolloPeopleFilters({ job_title: ["Energy Director"], location: ["Texas"], company: ["Vela"], seniority: ["director"], keyword: "power" });
  assert.deepEqual(filters.job_title, ["Energy Director"]);
  assert.equal(filters.include_similar_titles, true);
  assert.equal(filters.location, undefined);
  assert.equal(filters.company, undefined);
  assert.equal(filters.seniority, undefined);
  assert.equal(filters.keyword, undefined);
  assert.deepEqual(broadenApolloPeopleFilters({ company: ["Vela"], keyword: "power" }).company, ["Vela"]);
});
