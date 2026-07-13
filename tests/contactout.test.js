import assert from "node:assert/strict";
import test from "node:test";

import { enrichLinkedInProfile, normalizeContactOutResponse } from "../server/contactout.mjs";
import { peopleSearch } from "../lib/contactout.js";

const response = {
  status_code: 200,
  profile: {
    full_name: "Alex Morgan",
    headline: "VP, Critical Operations",
    work_email: ["alex@grid.example"],
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
      return { ok: true, async json() { return response; } };
    },
  });
  assert.equal(result.emailType, "work");
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
