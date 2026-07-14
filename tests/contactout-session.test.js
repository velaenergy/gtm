import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTACTOUT_CLIENT_VERSION,
  buildContactOutSessionProfile,
  normalizeContactOutSessionReveal,
  previewContactOutSession,
  revealContactOutSession,
  summarizeContactOutSessionUser,
} from "../lib/contactout-session.js";

test("builds the bounded profile contract used by ContactOut's browser flow", () => {
  assert.deepEqual(buildContactOutSessionProfile({
    url: "https://www.linkedin.com/in/alex-morgan/?trk=profile",
    memberId: 123456,
    name: "Alex Morgan",
    headline: "VP, Critical Operations",
    location: "Seattle",
    experiences: [{ company: "Grid Works", companyId: 88 }],
  }), {
    profile_url: "https://www.linkedin.com/in/alex-morgan/",
    li_vanity: "alex-morgan",
    full_name: "Alex Morgan",
    headline: "VP, Critical Operations",
    location: "Seattle",
    company: "Grid Works",
    companies: [],
    member_id: 123456,
    past_companies: [88],
    profile_type: "regular",
  });
});

test("summarizes session identity without returning browser credentials", () => {
  const result = summarizeContactOutSessionUser({
    user_id: 42,
    uuid: "install-id",
    name: "Vela User",
    email: "vela@example.com",
    premium: "1",
    allow_search: true,
    credit: 12,
    phoneCredit: 3,
    ats_export_limit: 20,
    restrictions: { phone: { message: "Phone unavailable" } },
  });
  assert.deepEqual(result.credits, { email: 12, phone: 3, export: 20 });
  assert.equal(result.connected, true);
  assert.equal("contactout_session" in result, false);
  assert.deepEqual(result.restrictions, { phone: "Phone unavailable" });
});

test("only promotes high-confidence non-guessed session emails", () => {
  const result = normalizeContactOutSessionReveal({
    profile: {
      full_name: "Alex Morgan",
      emails: [
        { value: "alex@grid.example", type: 2, confidence_level: "high", is_guess: false },
        { value: "guess@gmail.example", type: 1, confidence_level: "high", is_guess: true },
      ],
    },
    userCredits: { email: 11, phone: 2 },
  }, {
    creditsBefore: 12,
    verificationStatus: "protected",
    includePhone: false,
    profile: { name: "Alex Morgan", headline: "VP, Critical Operations", experiences: [] },
  });
  assert.equal(result.email, "alex@grid.example");
  assert.deepEqual(result.workEmails, ["alex@grid.example"]);
  assert.deepEqual(result.personalEmails, []);
  assert.equal(result.emailStatuses["guess@gmail.example"], "unverified");
  assert.deepEqual(result.credits, { before: 12, after: 11, phone: 2 });
});

test("V17 mirrors ContactOut's preview-to-reveal descriptor contract", async () => {
  const stored = {};
  const calls = [];
  let createdUrl = "";
  const chromeApi = {
    storage: { local: {
      async get(key) { return { [key]: stored[key] }; },
      async set(values) { Object.assign(stored, values); },
    } },
    tabs: {
      async query() { return []; },
      async create({ url }) { createdUrl = url; return { id: 7, url, status: "complete" }; },
      async get() { return { id: 7, url: createdUrl, status: "complete" }; },
    },
    scripting: {
      async executeScript({ args: [path, request] }) {
        calls.push({ path, request });
        let data;
        if (path.startsWith("/api/user/info")) data = { user_id: 42, uuid: "server-installation-id", credit: 12, phoneCredit: 0, premium: "1" };
        else if (path === "/api/v5/profiles/encrypted") data = {
          success: true,
          status: 200,
          data: { profiles: { profile: { profile_url: "https://www.linkedin.com/in/alex-morgan/", li_vanity: "alex-morgan", member_id: 98765, full_name: "Alex Morgan", companies: [], emails: [{ value: "a***@example.com", type: 2, confidence_level: "high", is_guess: false }] } }, credits: 12, userRestrictedInfo: { flag: false } },
          userCredits: { email: 12, phone: 0 },
        };
        else data = { status: 200, profile: { emails: [{ value: "alex@example.com", type: 2, confidence_level: "high", is_guess: false }] }, userCredits: { email: 11, phone: 0 } };
        return [{ result: { ok: true, status: 200, data, finalPath: path.split("?")[0] } }];
      },
    },
  };

  const preview = await previewContactOutSession({ url: "https://www.linkedin.com/in/alex-morgan/", name: "Alex Morgan", experiences: [] }, { chromeApi });
  await revealContactOutSession(preview.revealToken, { chromeApi });

  assert.match(createdUrl, /^https:\/\/contactout\.com\/extension\/app\/\?source=popup&uuid=/);
  assert.match(calls[0].path, new RegExp(`version=${CONTACTOUT_CLIENT_VERSION.replaceAll(".", "\\.")}`));
  assert.equal(calls[1].request.body.version, CONTACTOUT_CLIENT_VERSION);
  assert.notEqual(calls[1].request.body.version, "0.6.0");
  const reveal = calls.find((call) => call.path === "/api/v5/profiles/reveal");
  assert.equal(reveal.request.body.member_id, 98765);
  assert.equal(reveal.request.body.verify_job_id, null);
  assert.equal(reveal.request.headers["x-reveal-source"], "12");
});
