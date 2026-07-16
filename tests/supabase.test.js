import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPABASE_SESSION_STORAGE_KEY,
  activityRecordFromRow,
  activityRowsForDelivery,
  currentTeamMembership,
  duplicateRecipientMatches,
  isVelaEmail,
  requireApprovedSender,
  sharedActivity,
  sharedApprovedSenders,
  sharedOutreachTemplates,
  sharedTeamProfiles,
  sharedResearchRuns,
  signInWithGoogleTokens,
  setTeamMemberActive,
  syncGmailAccount,
  syncOutreachTemplates,
  syncResearchRun,
} from "../lib/supabase.js";

function memoryStorage() {
  const values = {};
  return {
    values,
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, next); },
    async remove(key) { delete values[key]; },
  };
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(payload); } };
}

test("limits team membership to the velaenergy.ai Google domain", () => {
  assert.equal(isVelaEmail("tarun@vela.energy"), false);
  assert.equal(isVelaEmail("tony@velaenergy.ai"), true);
  assert.equal(isVelaEmail("person@gmail.com"), false);
  assert.equal(isVelaEmail("attacker@vela.energy.example"), false);
});

test("exchanges a Google ID token for a stored Supabase session", async () => {
  const storage = memoryStorage();
  const calls = [];
  const session = await signInWithGoogleTokens({
    idToken: "google-id-token",
    accessToken: "google-access-token",
    nonce: "secure-google-nonce",
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        access_token: "supabase-access",
        refresh_token: "supabase-refresh",
        expires_in: 3600,
        user: { id: "user-1", email: "Tarun@VelaEnergy.ai", user_metadata: { full_name: "Tarun" } },
      });
    },
  });
  assert.equal(session.user.email, "tarun@velaenergy.ai");
  assert.equal(storage.values[SUPABASE_SESSION_STORAGE_KEY].accessToken, "supabase-access");
  assert.match(calls[0].url, /grant_type=id_token/);
  assert.deepEqual(JSON.parse(calls[0].options.body), { provider: "google", id_token: "google-id-token", access_token: "google-access-token", nonce: "secure-google-nonce" });
});

test("rejects a non-Vela Supabase identity even after token exchange", async () => {
  await assert.rejects(signInWithGoogleTokens({
    idToken: "google-id-token",
    nonce: "secure-google-nonce",
    fetchImpl: async () => jsonResponse({
      access_token: "supabase-access",
      refresh_token: "supabase-refresh",
      user: { id: "user-1", email: "person@gmail.com" },
    }),
  }), /Vela Energy Google account/);
});

test("maps one delivery into recipient-level activity rows without storing Google tokens", () => {
  const rows = activityRowsForDelivery({
    id: "delivery-1",
    accountId: "google-1",
    senderEmail: "sender@vela.energy",
    recipients: ["One@Example.com", "two@example.com"],
    subject: "Hello",
    status: "sent",
    mode: "immediate",
    completedAt: "2026-07-16T01:00:00.000Z",
  }, { user: { id: "user-1", email: "sender@vela.energy" } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].recipient_email, "one@example.com");
  assert.equal(rows[0].actor_id, "user-1");
  assert.equal(JSON.stringify(rows).includes("token"), false);
});

test("normalizes Supabase activity and produces recipient-specific duplicate warnings", () => {
  const record = activityRecordFromRow({
    client_event_id: "delivery-1:one@example.com:sent",
    recipient_email: "one@example.com",
    status: "sent",
    occurred_at: "2026-07-16T01:00:00.000Z",
    gmail_accounts: { email: "sender@vela.energy" },
  });
  const matches = duplicateRecipientMatches(["ONE@example.com", "new@example.com"], [record]);
  assert.equal(record.source, "supabase");
  assert.deepEqual(matches, [{
    recipient: "one@example.com",
    status: "sent",
    at: "2026-07-16T01:00:00.000Z",
    senderEmail: "sender@vela.energy",
    subject: "",
    source: "supabase",
  }]);
});

test("[V32] reads every ordered Supabase activity page instead of stopping at 1000", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  const urls = [];
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({ id: `row-${index}`, client_event_id: `event-${index}`, recipient_email: `person${index}@example.com`, status: "sent", occurred_at: `2026-07-15T00:${String(index % 60).padStart(2, "0")}:00.000Z` }));
  const secondPage = [{ id: "row-1000", client_event_id: "event-1000", recipient_email: "person1000@example.com", status: "sent" }, { id: "row-1001", client_event_id: "event-1001", recipient_email: "person1001@example.com", status: "sent" }];
  const records = await sharedActivity({
    storage,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return jsonResponse(String(url).includes("offset=1000") ? secondPage : firstPage);
    },
  });
  assert.equal(records.length, 1002);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /order=occurred_at\.desc,id\.desc/);
  assert.match(urls[0], /limit=1000&offset=0/);
  assert.match(urls[1], /limit=1000&offset=1000/);
});

test("reads workspace members in join order through the authenticated team session", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  const calls = [];
  const members = await sharedTeamProfiles({
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse([{ id: "user-1", email: "tarun@velaenergy.ai", full_name: "Tarun Batchu" }]);
    },
  });
  assert.equal(members[0].full_name, "Tarun Batchu");
  assert.match(calls[0].url, /team_profiles\?select=/);
  assert.match(calls[0].url, /order=created_at\.asc/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer supabase-access");
});

test("reads the current workspace role and calls the admin member-access RPC", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-admin", email: "tony@velaenergy.ai" },
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("team_profiles?select=")) return jsonResponse([{ id: "user-admin", email: "tony@velaenergy.ai", role: "admin", is_active: true }]);
    return jsonResponse({ id: "user-member", is_active: false });
  };
  const membership = await currentTeamMembership({ storage, fetchImpl });
  const removed = await setTeamMemberActive("user-member", false, { storage, fetchImpl });
  assert.equal(membership.role, "admin");
  assert.equal(removed.is_active, false);
  const rpc = calls.find((call) => call.url.includes("/rpc/set_team_member_active"));
  assert.deepEqual(JSON.parse(rpc.options.body), { target_user_id: "user-member", target_active: false });
  assert.equal(rpc.options.headers.Authorization, "Bearer supabase-access");
});

test("syncs and reads shared research-run ownership and audit counts", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access", refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  const calls = [];
  const row = { id: "c9b97072-6be5-40cb-94e8-2a41b27af59f", brief: "Find operators", status: "auditing", requested_count: 100, total_found: 7_700_000, found_count: 82, audited_count: 20, strong_count: 8, created_by: "user-1" };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(url.includes("order=updated_at") ? [{ ...row, team_profiles: { full_name: "Tarun" } }] : [row]);
  };
  const synced = await syncResearchRun({ id: row.id, brief: row.brief, status: "auditing", totalFound: 7_700_000, foundCount: 82, auditedCount: 20, strongCount: 8 }, { storage, fetchImpl });
  const runs = await sharedResearchRuns({ storage, fetchImpl });
  assert.equal(synced.foundCount, 82);
  assert.equal(synced.totalFound, 7_700_000);
  assert.equal(runs[0].operatorName, "Tarun");
  const body = JSON.parse(calls.find((call) => call.options.method === "POST").options.body)[0];
  assert.equal(body.created_by, "user-1");
  assert.equal(body.requested_count, 100);
  assert.equal(body.total_found, 7_700_000);
});

test("[V35] research-run sync survives a not-yet-applied total_found migration", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access", refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  const calls = [];
  const row = { id: "c9b97072-6be5-40cb-94e8-2a41b27af59f", brief: "Find operators", status: "searching", requested_count: 100, found_count: 0, created_by: "user-1" };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = options.body ? JSON.parse(options.body)[0] : null;
    if ((url.includes("select=") || body) && (url.includes("total_found") || Object.hasOwn(body || {}, "total_found"))) {
      return jsonResponse({ code: "PGRST204", message: "Could not find the 'total_found' column of 'research_runs' in the schema cache" }, 400);
    }
    return jsonResponse(url.includes("select=") ? [{ ...row, team_profiles: { full_name: "Tarun" } }] : [row]);
  };
  const synced = await syncResearchRun({ id: row.id, brief: row.brief, status: "searching", totalFound: 7_700_000 }, { storage, fetchImpl });
  const runs = await sharedResearchRuns({ storage, fetchImpl });
  assert.equal(synced.totalFound, 7_700_000);
  assert.equal(runs[0].operatorName, "Tarun");
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 2);
  assert.equal(Object.hasOwn(JSON.parse(calls.findLast((call) => call.options.method === "POST").options.body)[0], "total_found"), false);
});

test("reads the database sender roster and rejects mailboxes outside it", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "riddhiman.rana@velaenergy.ai" },
  };
  const fetchImpl = async (url) => jsonResponse(url.includes("email=eq.tony%40velaenergy.ai")
    ? [{ email: "tony@velaenergy.ai" }]
    : url.includes("email=eq.other%40velaenergy.ai") ? [] : [
      { email: "tarun@velaenergy.ai", display_name: "Tarun", is_active: true },
      { email: "tony@velaenergy.ai", display_name: "Tony", is_active: true },
    ]);
  const senders = await sharedApprovedSenders({ storage, fetchImpl });
  assert.deepEqual(senders.map((sender) => sender.email), ["tarun@velaenergy.ai", "tony@velaenergy.ai"]);
  assert.equal(await requireApprovedSender("Tony@VelaEnergy.ai", { storage, fetchImpl }), "tony@velaenergy.ai");
  await assert.rejects(requireApprovedSender("other@velaenergy.ai", { storage, fetchImpl }), /not enabled for sending/);
});

test("adds a chosen Vela Gmail account to the sender roster before syncing its metadata", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "riddhiman.rana@velaenergy.ai" },
  };
  const calls = [];
  await syncGmailAccount({ id: "google-riddhiman", email: "Riddhiman.Rana@VelaEnergy.ai", displayName: "Riddhiman Rana" }, {
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return jsonResponse(options.body ? JSON.parse(options.body) : []);
    },
  });
  assert.match(calls[0].url, /approved_senders\?on_conflict=email/);
  assert.equal(calls[0].body[0].email, "riddhiman.rana@velaenergy.ai");
  assert.equal(calls[0].body[0].created_by, "user-1");
  assert.match(calls[1].url, /gmail_accounts\?on_conflict=id/);
  assert.equal(calls[1].body[0].email, "riddhiman.rana@velaenergy.ai");
});

test("turns Gmail account RLS internals into an actionable connection error", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "member@velaenergy.ai" },
  };
  let request = 0;
  await assert.rejects(syncGmailAccount({ id: "google-member", email: "member@velaenergy.ai" }, {
    storage,
    fetchImpl: async () => {
      request += 1;
      return request === 1
        ? jsonResponse([{ email: "member@velaenergy.ai" }])
        : jsonResponse({ code: "42501", message: 'new row violates row-level security policy for table "gmail_accounts"' }, 403);
    },
  }), /active @velaenergy\.ai workspace account/);
});

test("hydrates hosted outreach templates into the extension model", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tony@velaenergy.ai" },
  };
  const templates = await sharedOutreachTemplates({
    storage,
    fetchImpl: async (url) => jsonResponse(url.includes("follow_up_templates") ? [{
      id: "tony-follow-up-1", name: "Tony follow up #1", body: "Hi again", writer_mode: "gaps",
    }] : [{
      id: "tony", name: "Tony", subject: "Hello {{company}}", body: "Hi {{firstName}}", sender_name: "Tony",
      calendar_url: "https://cal.com/team/velaenergy", writer_mode: "gaps", follow_up_cadence_days: 3,
      follow_up_template_ids: ["tony-follow-up-1"],
    }]),
  });
  assert.equal(templates.emailTemplates[0].senderName, "Tony");
  assert.equal(templates.emailTemplates[0].followUpCadenceDays, 3);
  assert.deepEqual(templates.emailTemplates[0].followUpTemplateIds, ["tony-follow-up-1"]);
  assert.equal(templates.followUpTemplates[0].writerMode, "gaps");
});

test("upserts shared templates and removes rows deleted in settings", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tony@velaenergy.ai" },
  };
  const calls = [];
  await syncOutreachTemplates({
    emailTemplates: [{
      id: "tony", name: "Tony", subject: "Hello", body: "Hi", senderName: "Tony",
      calendarUrl: "https://cal.com/team/velaenergy", writerMode: "gaps", followUpCadenceDays: 3,
      followUpTemplateIds: ["tony-follow-up-1"],
    }],
    followUpTemplates: [{ id: "tony-follow-up-1", name: "Tony follow up #1", body: "Hi again", writerMode: "gaps" }],
  }, {
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "GET" && url.includes("email_templates?select=id")) return jsonResponse([{ id: "tony" }, { id: "tarun" }]);
      if (options.method === "GET" && url.includes("follow_up_templates?select=id")) return jsonResponse([{ id: "tony-follow-up-1" }, { id: "tarun-follow-up-1" }]);
      return jsonResponse(null);
    },
  });
  const emailUpsert = calls.find((call) => call.options.method === "POST" && call.url.includes("email_templates"));
  assert.equal(JSON.parse(emailUpsert.options.body)[0].calendar_url, "https://cal.com/team/velaenergy");
  assert.equal(calls.some((call) => call.options.method === "DELETE" && call.url.includes("email_templates") && call.url.includes("tarun")), true);
  assert.equal(calls.some((call) => call.options.method === "DELETE" && call.url.includes("follow_up_templates") && call.url.includes("tarun-follow-up-1")), true);
});
