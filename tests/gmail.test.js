import assert from "node:assert/strict";
import test from "node:test";
import {
  GMAIL_COMPOSE_SCOPE,
  GMAIL_DRAFTS_API_URL,
  GMAIL_PROFILE_API_URL,
  GmailApiError,
  buildMimeMessage,
  createGmailDraft,
  createGmailDraftWithRetry,
  disconnectGmail,
  getGmailAuthToken,
  getGmailProfile,
  googleOAuthErrorMessage,
  listGoogleAccounts,
  gmailDraftBatchSummary,
  gmailDraftPayload,
  gmailOAuthConfigured,
} from "../lib/gmail.js";

test("builds a safe RFC-style text message", () => {
  const message = buildMimeMessage({ to: "person@example.com", subject: "Quick intro", body: "Hi there,\n\nHello." });
  assert.match(message, /^To: person@example\.com\r\n/);
  assert.match(message, /Content-Type: text\/plain/);
  assert.match(message, /Hi there,\r\n\r\nHello\./);
});

test("rejects malformed recipients and header injection", () => {
  assert.throws(
    () => buildMimeMessage({ to: "person@example.com\r\nBcc: bad@example.com", subject: "Quick intro", body: "Hello" }),
    /cannot contain line breaks/,
  );
  assert.throws(() => buildMimeMessage({ to: "first@example.com,second@example.com", body: "Hello" }), /one valid recipient/);
  assert.throws(() => buildMimeMessage({ to: "person@example.com", subject: "Hello\r\nBcc: bad@example.com" }), /cannot contain line breaks/);
});

test("encodes Unicode headers and normalizes all body line endings", () => {
  const message = buildMimeMessage({ to: "person@example.com", subject: "Power in Montréal", body: "one\rtwo\r\nthree\nfour" });
  assert.match(message, /Subject: =\?UTF-8\?B\?/);
  assert.match(message, /one\r\ntwo\r\nthree\r\nfour$/);
});

test("creates a Gmail drafts.create payload with base64url raw content", () => {
  const payload = gmailDraftPayload({ to: "person@example.com", subject: "Energy + infrastructure", body: "Hello" });
  assert.deepEqual(Object.keys(payload), ["message"]);
  assert.match(payload.message.raw, /^[A-Za-z0-9_-]+$/);
  const padded = payload.message.raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.message.raw.length / 4) * 4, "=");
  assert.match(Buffer.from(padded, "base64").toString("utf8"), /Subject: Energy \+ infrastructure/);
});

test("recognizes only configured Google OAuth client IDs", () => {
  assert.equal(gmailOAuthConfigured({ oauth2: { client_id: "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com" } }), false);
  assert.equal(gmailOAuthConfigured({ oauth2: { client_id: "123-example.apps.googleusercontent.com" } }), true);
  assert.equal(gmailOAuthConfigured({ oauth2: { client_id: "not-a-google-client" } }), false);
});

test("gets a noninteractive Chrome Identity token with gmail.compose granted", async () => {
  const calls = [];
  const token = await getGmailAuthToken({
    manifest: { oauth2: { client_id: "123-example.apps.googleusercontent.com" } },
    identity: {
      async getAuthToken(details) {
        calls.push(details);
        return { token: "access-token", grantedScopes: [GMAIL_COMPOSE_SCOPE] };
      },
    },
  });
  assert.equal(token, "access-token");
  assert.deepEqual(calls, [{ interactive: false, enableGranularPermissions: true }]);
});

test("targets the explicitly selected Chrome Google account", async () => {
  const calls = [];
  await getGmailAuthToken({
    manifest: { oauth2: { client_id: "123-example.apps.googleusercontent.com" } },
    interactive: true,
    accountId: "account-2",
    identity: { async getAuthToken(details) { calls.push(details); return { token: "selected-token", grantedScopes: [GMAIL_COMPOSE_SCOPE] }; } },
  });
  assert.deepEqual(calls, [{ interactive: true, enableGranularPermissions: true, account: { id: "account-2" } }]);
});

test("lists signed-in accounts and labels the primary email", async () => {
  const accounts = await listGoogleAccounts({
    async getAccounts() { return [{ id: "secondary" }, { id: "primary" }]; },
    async getProfileUserInfo(details) { assert.deepEqual(details, { accountStatus: "ANY" }); return { id: "primary", email: "owner@vela.energy" }; },
  });
  assert.deepEqual(accounts, [
    { id: "secondary", label: "Signed-in Google account 1", primary: false },
    { id: "primary", label: "owner@vela.energy", primary: true },
  ]);
});

test("turns an organization-only OAuth failure into actionable setup guidance", () => {
  assert.match(googleOAuthErrorMessage(new Error("This client is restricted to users within its organization")), /audience to External/);
});

test("reads the connected Gmail address from the selected token", async () => {
  const calls = [];
  const profile = await getGmailProfile("selected-token", { async fetchImpl(url, options) {
    calls.push({ url, options });
    return { ok: true, status: 200, async json() { return { emailAddress: "sender@example.com", historyId: "42" }; } };
  } });
  assert.deepEqual(profile, { email: "sender@example.com", historyId: "42" });
  assert.equal(calls[0].url, GMAIL_PROFILE_API_URL);
  assert.equal(calls[0].options.headers.Authorization, "Bearer selected-token");
});

test("rejects a token without gmail.compose and removes it from Chrome's cache", async () => {
  const removed = [];
  await assert.rejects(
    getGmailAuthToken({
      manifest: { oauth2: { client_id: "123-example.apps.googleusercontent.com" } },
      identity: {
        async getAuthToken() { return { token: "wrong-scope-token", grantedScopes: ["openid"] }; },
        async removeCachedAuthToken(details) { removed.push(details); },
      },
    }),
    /compose permission was not granted/,
  );
  assert.deepEqual(removed, [{ token: "wrong-scope-token" }]);
});

test("disconnects Gmail by clearing Chrome Identity's cached authorization", async () => {
  let cleared = 0;
  await disconnectGmail({ async clearAllCachedAuthTokens() { cleared += 1; } });
  assert.equal(cleared, 1);
});

test("posts the exact Gmail drafts.create request", async () => {
  const calls = [];
  const id = await createGmailDraft("access-token", { to: "person@example.com", subject: "Hello", body: "Body" }, {
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() { return { id: "draft-123" }; } };
    },
  });
  assert.equal(id, "draft-123");
  assert.equal(calls[0].url, GMAIL_DRAFTS_API_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer access-token");
  assert.ok(JSON.parse(calls[0].options.body).message.raw);
});

test("evicts one invalid token and retries a Gmail 401 exactly once", async () => {
  const authorizations = [];
  const removed = [];
  let requests = 0;
  const authState = { token: "expired-token", refreshAttempted: false };
  const id = await createGmailDraftWithRetry(
    { to: "person@example.com", subject: "Hello", body: "Body" },
    {
      authState,
      async removeCachedToken(token) { removed.push(token); },
      async getFreshToken() { return "fresh-token"; },
      async fetchImpl(_url, options) {
        requests += 1;
        authorizations.push(options.headers.Authorization);
        if (requests === 1) return { ok: false, status: 401, async json() { return { error: { message: "Invalid Credentials" } }; } };
        return { ok: true, status: 200, async json() { return { id: "draft-after-refresh" }; } };
      },
    },
  );
  assert.equal(id, "draft-after-refresh");
  assert.deepEqual(removed, ["expired-token"]);
  assert.deepEqual(authorizations, ["Bearer expired-token", "Bearer fresh-token"]);
  assert.equal(authState.refreshAttempted, true);
  assert.equal(authState.token, "fresh-token");
});

test("stops after the single Gmail 401 retry is also rejected", async () => {
  let removals = 0;
  let refreshes = 0;
  let requests = 0;
  const authState = { token: "expired-token", refreshAttempted: false };
  await assert.rejects(
    createGmailDraftWithRetry(
      { to: "person@example.com", subject: "Hello", body: "Body" },
      {
        authState,
        async removeCachedToken() { removals += 1; },
        async getFreshToken() { refreshes += 1; return "also-invalid"; },
        async fetchImpl() {
          requests += 1;
          return { ok: false, status: 401, async json() { return { error: { message: "Invalid Credentials" } }; } };
        },
      },
    ),
    (error) => error instanceof GmailApiError && error.status === 401,
  );
  assert.equal(requests, 2);
  assert.equal(removals, 1);
  assert.equal(refreshes, 1);
  assert.equal(authState.refreshAttempted, true);
});

test("does not evict or retry a Gmail 403", async () => {
  let removals = 0;
  let refreshes = 0;
  let requests = 0;
  const authState = { token: "valid-token", refreshAttempted: false };
  await assert.rejects(
    createGmailDraftWithRetry(
      { to: "person@example.com", subject: "Hello", body: "Body" },
      {
        authState,
        async removeCachedToken() { removals += 1; },
        async getFreshToken() { refreshes += 1; return "unused"; },
        async fetchImpl() {
          requests += 1;
          return { ok: false, status: 403, async json() { return { error: { message: "Access denied" } }; } };
        },
      },
    ),
    (error) => error instanceof GmailApiError && error.status === 403 && error.message === "Access denied",
  );
  assert.equal(requests, 1);
  assert.equal(removals, 0);
  assert.equal(refreshes, 0);
  assert.equal(authState.refreshAttempted, false);
});

test("reports partial Gmail draft batches accurately", () => {
  assert.equal(gmailDraftBatchSummary(3, 0), "Created 3 Gmail drafts. Open Gmail to review and send manually.");
  assert.equal(gmailDraftBatchSummary(2, 1), "Created 2 Gmail drafts; 1 failed. Nothing was sent.");
  assert.equal(gmailDraftBatchSummary(0, 2), "No Gmail drafts were created; 2 failed.");
});
