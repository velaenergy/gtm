import assert from "node:assert/strict";
import test from "node:test";

import { enrichLinkedInProfile, normalizeContactOutResponse } from "../server/contactout.mjs";
import { contactOutAccountStatus, normalizePeopleSearchFilters, peopleSearch } from "../lib/contactout.js";

const response = {
  status_code: 200,
  profile: {
    full_name: "Alex Morgan",
    headline: "VP, Critical Operations",
    work_email: ["alex@grid.example"],
    work_email_status: { "alex@grid.example": "verified" },
    personal_email: ["alex@gmail.example"],
    location: "Virginia",
    summary: "Runs mission-critical infrastructure.",
    company: { name: "Grid Works", industry: "Data Centers", domain: "grid.example" },
    skills: ["Critical Facilities", "Power"],
    experience: [{ title: "VP", company_name: "Grid Works", start_date_year: 2022, is_current: true }],
  },
};

test("prefers ContactOut work email and normalizes bounded professional context", () => {
  const result = normalizeContactOutResponse(response);
  assert.equal(result.email, "alex@grid.example");
  assert.equal(result.emailType, "work");
  assert.equal(result.emailStatus, "verified");
  assert.deepEqual(result.emailStatuses, { "alex@grid.example": "verified" });
  assert.equal(result.profile.experiences[0].dates, "2022 – Present");
  assert.deepEqual(result.profile.skills, ["Critical Facilities", "Power"]);
});

test("calls Contact Info first with verified work email and the token header", async () => {
  const result = await enrichLinkedInProfile({ url: "https://www.linkedin.com/in/alex-morgan", name: "Alex Morgan" }, {
    apiKey: "server-secret",
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, "https://api.contactout.com");
      assert.equal(url.searchParams.get("profile"), "https://www.linkedin.com/in/alex-morgan");
      assert.equal(url.pathname, "/v1/people/linkedin");
      assert.equal(url.searchParams.get("email_type"), "personal,work");
      assert.equal(options.headers.token, "server-secret");
      assert.equal(options.headers.authorization, "basic");
      return { ok: true, async json() { return response; } };
    },
  });
  assert.equal(result.emailType, "work");
});

test("honors Retry-After once when ContactOut rate limits a lookup", async () => {
  let calls = 0;
  const delays = [];
  const result = await enrichLinkedInProfile({ url: "https://www.linkedin.com/in/alex-morgan" }, {
    apiKey: "server-secret",
    sleepImpl: async (delay) => delays.push(delay),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 429, headers: { get: () => "2" }, async json() { return { status_code: 429 }; } };
      return { ok: true, status: 200, async json() { return response; } };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
  assert.equal(result.email, "alex@grid.example");
});

test("checks ContactOut account usage without exposing the token", async () => {
  const result = await contactOutAccountStatus({
    apiKey: "server-secret",
    fetchImpl: async (url, options) => {
      assert.equal(String(url), "https://api.contactout.com/v1/stats");
      assert.equal(options.headers.authorization, "basic");
      assert.equal(options.headers.token, "server-secret");
      return { ok: true, status: 200, async json() { return { status_code: 200, usage: { count: 12, quota: 100, remaining: 88 } }; } };
    },
  });
  assert.deepEqual(result.usage, { count: 12, quota: 100, remaining: 88 });
});

test("does not accept non-profile LinkedIn URLs", async () => {
  await assert.rejects(
    enrichLinkedInProfile({ url: "https://www.linkedin.com/company/vela" }, { apiKey: "server-secret" }),
    /regular LinkedIn profile URL/i,
  );
});

test("falls back to People Enrich when Contact Info has no match", async () => {
  const calls = [];
  const result = await enrichLinkedInProfile({ url: "https://www.linkedin.com/in/alex-morgan", name: "Alex Morgan" }, {
    apiKey: "server-secret",
    fetchImpl: async (url, options) => {
      calls.push(String(url));
      if (String(url).includes("/v1/people/linkedin?")) return { ok: false, status: 404, async json() { return { status_code: 404, message: "Not Found" }; } };
      assert.equal(options.method, "POST");
      assert.match(options.body, /work_email/);
      return { ok: true, async json() { return response; } };
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/v1\/people\/enrich/);
  assert.equal(result.email, "alex@grid.example");
});

test("People Search returns queue-ready LinkedIn prospects without revealing contacts", async () => {
  const result = await peopleSearch({ job_title: ["Critical Operations"], keyword: "data center power" }, {
    apiKey: "server-secret",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.reveal_info, false);
      assert.equal(body.page_size, 10);
      return { ok: true, async json() { return { metadata: { total_results: 1 }, profiles: { "https://www.linkedin.com/in/alex-morgan": response.profile } }; } };
    },
  });
  assert.equal(result.total, 1);
  assert.equal(result.prospects[0].name, "Alex Morgan");
});

test("normalizes planned seniority into ContactOut's accepted enum values", () => {
  assert.deepEqual(
    normalizePeopleSearchFilters({ seniority: ["vice president", "c-suite", "manager", "principal", "Founder"] }).seniority,
    ["VP", "CXO", "Manager", "Owner / Founder"],
  );
});

test("People Search never sends invalid seniority values", async () => {
  await peopleSearch({ seniority: ["vice president", "principal", "director-level"] }, {
    apiKey: "server-secret",
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body).seniority, ["VP", "Director"]);
      return { ok: true, async json() { return { metadata: { total_results: 0 }, profiles: {} }; } };
    },
  });
});
