import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPABASE_SESSION_STORAGE_KEY,
  activityRecordFromRow,
  activityRowsForDelivery,
  claimRecipientSend,
  completeRecipientSend,
  currentTeamMembership,
  deactivateGmailAccount,
  deleteSharedProspects,
  duplicateRecipientMatches,
  duplicateActivity,
  gtmMessageRecordFromRow,
  isVelaEmail,
  recordGtmEmailMessages,
  recordSharedActivity,
  requireApprovedSender,
  sharedActivity,
  sharedApprovedSenders,
  sharedGtmEmailMessages,
  sharedGtmMailboxSyncStates,
  sharedOutreachTemplates,
  sharedTeamProfiles,
  sharedResearchRuns,
  signInWithGoogleTokens,
  setTeamMemberActive,
  syncGmailAccount,
  syncOutreachTemplates,
  syncProspects,
  syncResearchRun,
  upsertGtmMailboxSyncState,
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

test("stores canonical GTM Gmail messages and maps them back to analytics records", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access", refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "riddhiman.rana@velaenergy.ai" },
  };
  const calls = [];
  const message = {
    gmailAccountId: "google-riddhiman", gmailMessageId: "message-1", gmailThreadId: "thread-1", gmailHistoryId: "100",
    direction: "incoming", messageKind: "reply", templateId: "template-1", classificationSource: "thread_reply",
    senderEmail: "person@example.com", recipientEmails: ["riddhiman.rana@velaenergy.ai"], subject: "Re: Seeking advice",
    bodyText: "Happy to chat.", occurredAt: "2026-07-16T12:00:00.000Z",
  };
  const saved = await recordGtmEmailMessages([message], {
    storage,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url: String(url), options, body });
      return jsonResponse(body.map((row) => ({ id: "row-1", ...row, gmail_accounts: { email: "riddhiman.rana@velaenergy.ai" }, team_profiles: { id: "user-1", email: "riddhiman.rana@velaenergy.ai", full_name: "Riddhiman Rana", avatar_url: "https://example.com/riddhiman.jpg" } })));
    },
  });
  assert.equal(calls[0].body[0].captured_by, "user-1");
  assert.equal(calls[0].body[0].message_kind, "reply");
  assert.match(calls[0].url, /on_conflict=gmail_account_id,gmail_message_id/);
  assert.equal(saved[0].accountEmail, "riddhiman.rana@velaenergy.ai");
  assert.equal(saved[0].operatorName, "Riddhiman Rana");
  assert.equal(saved[0].operatorEmail, "riddhiman.rana@velaenergy.ai");
  assert.equal(saved[0].bodyText, "Happy to chat.");
  assert.equal(gtmMessageRecordFromRow(calls[0].body[0]).gmailMessageId, "message-1");
});

test("reads paginated GTM history without bodies and upserts mailbox cursors", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access", refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "riddhiman.rana@velaenergy.ai" },
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("gtm_mailbox_sync_state") && options.method === "GET") return jsonResponse([{ gmail_account_id: "google-riddhiman", last_history_id: "99", sync_status: "complete" }]);
    if (String(url).includes("gtm_mailbox_sync_state")) return jsonResponse(JSON.parse(options.body));
    return jsonResponse([{ gmail_account_id: "google-riddhiman", gmail_message_id: "message-1", gmail_thread_id: "thread-1", sender_email: "person@example.com", message_kind: "reply", occurred_at: "2026-07-16T12:00:00.000Z" }]);
  };
  const messages = await sharedGtmEmailMessages({ storage, fetchImpl });
  const states = await sharedGtmMailboxSyncStates({ storage, fetchImpl });
  const cursor = await upsertGtmMailboxSyncState("google-riddhiman", { lastHistoryId: "100", syncStatus: "complete", messagesScanned: 20, gtmMessagesFound: 4, repliesFound: 1, bouncesFound: 1 }, { storage, fetchImpl });
  assert.equal(messages[0].bodyText, "");
  assert.equal(states[0].last_history_id, "99");
  assert.equal(cursor.last_history_id, "100");
  assert.equal(JSON.parse(calls.find((call) => call.options.method === "POST").options.body)[0].updated_by, "user-1");
  assert.equal(calls.some((call) => call.url.includes("body_text")), false);
  assert.equal(calls.some((call) => call.url.includes("gtm_email_messages_captured_by_fkey")), true);
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

test("imported history keeps the importer separate from the actual sender", () => {
  const record = activityRecordFromRow({
    client_event_id: "import-1:one@example.com:sent",
    recipient_email: "one@example.com",
    status: "sent",
    delivery_mode: "imported",
    actor_id: "user-1",
    metadata: { actor_email: "riddhiman@velaenergy.ai" },
    team_profiles: { id: "user-1", email: "riddhiman@velaenergy.ai", full_name: "Riddhiman Rana" },
  });
  assert.equal(record.operatorId, "");
  assert.equal(record.operatorEmail, "");
  assert.equal(record.operatorName, "");
});

test("V41 includes canonical Gmail history in duplicate-recipient checks", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access", refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  const urls = [];
  const records = await duplicateActivity(["Person@Example.com"], {
    storage,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return String(url).includes("gtm_email_messages")
        ? jsonResponse([{ id: "row-1", gmail_message_id: "gmail-1", recipient_emails: ["person@example.com"], subject: "Earlier outreach", occurred_at: "2026-07-01T12:00:00.000Z", gmail_accounts: { email: "tony@velaenergy.ai" } }])
        : jsonResponse([]);
    },
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "gmail");
  assert.deepEqual(records[0].recipients, ["person@example.com"]);
  assert.equal(duplicateRecipientMatches(["person@example.com"], records)[0].status, "sent");
  assert.equal(urls.some((url) => url.includes("recipient_emails=ov.")), true);
});

test("atomically claims and completes a shared recipient send through RPC", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access", refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return jsonResponse(String(url).includes("claim_recipient_send")
      ? { claimed: true, recipient: "person@example.com", claim_id: "44444444-4444-4444-8444-444444444444" }
      : true);
  };
  const claim = await claimRecipientSend({ recipient: "Person@Example.com", claimId: "44444444-4444-4444-8444-444444444444", senderEmail: "Tony@VelaEnergy.ai", prospectIdentity: "linkedin:person" }, { storage, fetchImpl });
  const completed = await completeRecipientSend({ recipient: "person@example.com", claimId: "44444444-4444-4444-8444-444444444444", outcome: "sent" }, { storage, fetchImpl });
  assert.equal(claim.claimed, true);
  assert.equal(completed, true);
  assert.deepEqual(calls[0].body, {
    p_recipient_email: "person@example.com",
    p_claim_id: "44444444-4444-4444-8444-444444444444",
    p_sender_email: "tony@velaenergy.ai",
    p_prospect_identity: "linkedin:person",
    p_force: false,
  });
  assert.deepEqual(calls[1].body, {
    p_recipient_email: "person@example.com",
    p_claim_id: "44444444-4444-4444-8444-444444444444",
    p_outcome: "sent",
  });
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

test("[V36] upserts large historical imports in bounded batches", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  const calls = [];
  const records = Array.from({ length: 1201 }, (_, index) => ({
    id: `import-${index}`,
    status: "sent",
    mode: "imported",
    recipients: [`person${index}@example.com`],
    completedAt: "2026-07-15T12:00:00.000Z",
  }));

  await recordSharedActivity(records, {
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options, body: JSON.parse(options.body) });
      return jsonResponse([]);
    },
  });

  assert.deepEqual(calls.map((call) => call.body.length), [500, 500, 201]);
  assert.ok(calls.every((call) => call.url.includes("on_conflict=client_event_id")));
  assert.ok(calls.every((call) => call.options.headers.Prefer.includes("resolution=merge-duplicates")));
});

test("[V44] upserts every large prospect import in bounded batches", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  const calls = [];
  const prospects = Array.from({ length: 1201 }, (_, index) => ({
    email: `person${index}@example.com`,
    name: `Person ${index}`,
    source: "GTM LOG.xlsx",
  }));

  await syncProspects(prospects, {
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options, body: JSON.parse(options.body) });
      return jsonResponse([]);
    },
  });

  assert.deepEqual(calls.map((call) => call.body.length), [500, 500, 201]);
  assert.ok(calls.every((call) => call.url.includes("on_conflict=identity_key")));
  assert.ok(calls.every((call) => call.options.headers.Prefer.includes("resolution=merge-duplicates")));
});

test("[V59] deletes only the selected approval prospects from shared storage", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  const calls = [];
  await deleteSharedProspects([
    { url: "https://www.linkedin.com/in/greg-miller", email: "greg@example.com" },
    { email: "dane.barhoover@kiewit.com" },
  ], {
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(options.method === "DELETE" ? [
        { identity_key: "linkedin:https://www.linkedin.com/in/greg-miller" },
        { identity_key: "email:dane.barhoover@kiewit.com" },
      ] : []);
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(calls[0].options.headers.Prefer, "return=representation");
  assert.equal(calls[1].options.method, "GET");
  assert.match(calls[0].url, /select=identity_key/);
  assert.match(decodeURIComponent(calls[0].url), /linkedin:https:\/\/www\.linkedin\.com\/in\/greg-miller/);
  assert.match(decodeURIComponent(calls[0].url), /email:greg@example\.com/);
  assert.match(decodeURIComponent(calls[0].url), /email:dane\.barhoover@kiewit\.com/);
  assert.doesNotMatch(calls[0].url, /identity_key=not\.is\.null/);
});

test("[V69] clearing approvals succeeds when shared rows are already absent", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };

  const calls = [];
  await assert.doesNotReject(deleteSharedProspects(Array.from({ length: 119 }, (_, index) => ({
    email: `already-absent-${index}@example.com`,
  })), {
    storage,
    fetchImpl: async (_url, options) => {
      calls.push(options.method);
      return jsonResponse([]);
    },
  }));
  assert.deepEqual(calls, ["DELETE", "DELETE", "GET", "GET"]);
});

test("[V69] clearing approvals fails closed when a shared identity remains", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "tarun@velaenergy.ai" },
  };
  let calls = 0;

  await assert.rejects(deleteSharedProspects([
    { email: "still-there@example.com" },
  ], {
    storage,
    fetchImpl: async (_url, options) => {
      calls += 1;
      return jsonResponse(options.method === "DELETE" ? [] : [{ identity_key: "email:still-there@example.com" }]);
    },
  }), /still contains 1 matching approval/);
  assert.equal(calls, 2);
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
  assert.equal(body.requested_count, 300);
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
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 3);
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

test("[V52] removing a Gmail sender atomically deactivates shared account and delivery authorization", async () => {
  const storage = memoryStorage();
  storage.values[SUPABASE_SESSION_STORAGE_KEY] = {
    accessToken: "supabase-access",
    refreshToken: "supabase-refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "riddhiman.rana@velaenergy.ai" },
  };
  const calls = [];
  const removed = await deactivateGmailAccount({ id: "google-riddhiman", email: "Riddhiman.Rana@VelaEnergy.ai" }, {
    storage,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) });
      return jsonResponse({ id: "google-riddhiman", email: "riddhiman.rana@velaenergy.ai", isActive: false });
    },
  });

  assert.deepEqual(removed, { id: "google-riddhiman", email: "riddhiman.rana@velaenergy.ai", isActive: false });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /rpc\/deactivate_gmail_sender/);
  assert.deepEqual(calls[0].body, {
    p_account_id: "google-riddhiman",
    p_account_email: "riddhiman.rana@velaenergy.ai",
  });
  assert.equal(calls[0].method, "POST");
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
