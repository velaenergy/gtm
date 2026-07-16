import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_ACCOUNT_AUTH_MODE,
  GOOGLE_ACCOUNTS_STORAGE_KEY,
  GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY,
  GOOGLE_USERINFO_EMAIL_SCOPE,
  buildGoogleWebAuthUrl,
  authorizeGoogleAccount,
  chooseGoogleAccount,
  disconnectGoogle,
  getGoogleWebAuthToken,
  googleAccountById,
  googleAuthStrategyForAccount,
  googleOAuthErrorMessage,
  googleOAuthStrategy,
  normalizeGoogleAccounts,
  selectedGoogleAccount,
  upsertGoogleAccount,
} from "../lib/google-auth.js";
import { GMAIL_SEND_SCOPE } from "../lib/gmail-send.js";
import { DEFAULT_SETTINGS } from "../lib/message.js";

const WEB_CLIENT_ID = "123-chooser.apps.googleusercontent.com";
const REDIRECT_URI = "https://mecnpdbecgmgjolcdldhkeplheojjpki.chromiumapp.org/google";
const FIXED_CRYPTO = {
  getRandomValues(bytes) {
    bytes.fill(7);
    return bytes;
  },
  subtle: {
    async digest(algorithm, value) {
      assert.equal(algorithm, "SHA-256");
      assert.ok(value.byteLength > 0);
      return new Uint8Array(32).fill(9).buffer;
    },
  },
};

function chooserIdentity(calls = []) {
  return {
    getRedirectURL(path) {
      assert.equal(path, "google");
      return REDIRECT_URI;
    },
    async launchWebAuthFlow(details) {
      calls.push(details);
      const request = new URL(details.url);
      const response = new URL(request.searchParams.get("redirect_uri"));
      const payload = {
        access_token: "chosen-gmail-token",
        expires_in: "3600",
        scope: request.searchParams.get("scope"),
        state: request.searchParams.get("state"),
      };
      if (request.searchParams.get("response_type")?.includes("id_token")) payload.id_token = "chosen-google-id-token";
      response.hash = new URLSearchParams(payload).toString();
      return response.toString();
    },
  };
}

function accountFetch(email = "sender@vela.energy") {
  return async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer chosen-gmail-token");
    return { ok: true, async json() { return { sub: "gaia-selected", email }; } };
  };
}

test("builds an explicit Google account chooser authorization request", () => {
  const url = new URL(buildGoogleWebAuthUrl({
    clientId: WEB_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: [GMAIL_SEND_SCOPE, GOOGLE_USERINFO_EMAIL_SCOPE],
    state: "secure-state",
    interactive: true,
  }));
  assert.equal(url.searchParams.get("response_type"), "token");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(url.searchParams.get("hd"), "velaenergy.ai");
  assert.match(url.searchParams.get("scope"), /gmail\.send/);
});

test("requests an ID token when the Google chooser also signs into Vela", () => {
  const url = new URL(buildGoogleWebAuthUrl({
    clientId: WEB_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: [GMAIL_SEND_SCOPE, "openid", "email"],
    state: "secure-state",
    nonce: "hashed-google-nonce",
    interactive: true,
    includeIdToken: true,
  }));
  assert.equal(url.searchParams.get("response_type"), "id_token token");
  assert.equal(url.searchParams.get("nonce"), "hashed-google-nonce");
});

test("sends Google the hashed nonce and returns the raw nonce for Supabase verification", async () => {
  const calls = [];
  const authorization = await authorizeGoogleAccount({
    identity: chooserIdentity(calls),
    clientId: WEB_CLIENT_ID,
    scopes: [],
    includeIdToken: true,
    fetchImpl: accountFetch("tony@velaenergy.ai"),
    cryptoImpl: FIXED_CRYPTO,
  });
  const request = new URL(calls[0].url);
  assert.equal(authorization.nonce, "07".repeat(32));
  assert.equal(request.searchParams.get("nonce"), "09".repeat(32));
  assert.notEqual(authorization.nonce, request.searchParams.get("nonce"));
  assert.equal(authorization.idToken, "chosen-google-id-token");
});

test("V19 explains the exact redirect URI required for Google OAuth mismatch errors", () => {
  assert.equal(
    googleOAuthErrorMessage(new Error("Error 400: redirect_uri_mismatch"), { redirectUri: REDIRECT_URI }),
    `Google rejected the OAuth redirect. Add this exact Authorized redirect URI to this Web application client in Google Cloud: ${REDIRECT_URI}`,
  );
});

test("replaces Chrome's non-interactive navigation error with a reconnect action", () => {
  assert.equal(
    googleOAuthErrorMessage(new Error("User interaction required. Try setting abortOnLoadForNonInteractive and timeoutMsForNonInteractive if multiple navigations are required.")),
    "The selected Gmail session needs to be reconnected in Settings.",
  );
});

test("uses the built-in Web OAuth client as the only Google authorization strategy", () => {
  assert.equal(googleOAuthStrategy({ webClientId: WEB_CLIENT_ID }), GOOGLE_ACCOUNT_AUTH_MODE);
  assert.equal(googleOAuthStrategy({ webClientId: "" }), "");
  assert.equal(DEFAULT_SETTINGS.googleWebClientId, "185496922277-dnn33q788othssrcu92719cbo34e21o0.apps.googleusercontent.com");
});

test("keeps OAuth strategy bound to an explicitly connected Gmail account", () => {
  assert.equal(googleAuthStrategyForAccount({
    account: { id: "chooser", email: "chooser@example.com", authMode: GOOGLE_ACCOUNT_AUTH_MODE },
    webClientId: WEB_CLIENT_ID,
  }), GOOGLE_ACCOUNT_AUTH_MODE);
  assert.equal(googleAuthStrategyForAccount({
    account: { id: "chooser", email: "chooser@example.com", authMode: GOOGLE_ACCOUNT_AUTH_MODE },
  }), "");
});

test("drops legacy Chrome-profile senders so they reconnect through the chooser", () => {
  assert.deepEqual(normalizeGoogleAccounts([
    { id: "legacy", email: "legacy@example.com", authMode: "chrome-profile" },
    { id: "chooser", email: "chooser@example.com", authMode: GOOGLE_ACCOUNT_AUTH_MODE },
  ]), [
    { id: "chooser", email: "chooser@example.com", authMode: GOOGLE_ACCOUNT_AUTH_MODE },
  ]);
});

test("V21 migrates and deduplicates connected Gmail accounts without tokens", () => {
  const legacy = { id: "gaia-tarun", email: "Tarun@VelaEnergy.ai", authMode: GOOGLE_ACCOUNT_AUTH_MODE, token: "never-copy" };
  const accounts = normalizeGoogleAccounts([
    { id: "gaia-tony", email: "tony@velaenergy.ai", authMode: GOOGLE_ACCOUNT_AUTH_MODE },
    { id: "gaia-tarun", email: "tarun@velaenergy.ai", authMode: GOOGLE_ACCOUNT_AUTH_MODE },
  ], legacy);
  assert.deepEqual(accounts, [
    { id: "gaia-tarun", email: "tarun@velaenergy.ai", authMode: GOOGLE_ACCOUNT_AUTH_MODE },
    { id: "gaia-tony", email: "tony@velaenergy.ai", authMode: GOOGLE_ACCOUNT_AUTH_MODE },
  ]);
  assert.equal("token" in accounts[0], false);
  assert.equal(GOOGLE_ACCOUNTS_STORAGE_KEY, "velaGtmGoogleAccounts");
  assert.equal(GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY, "velaGtmSelectedGoogleAccountId");
});

test("V21 keeps compose sender selection explicit while adding accounts", () => {
  const accounts = upsertGoogleAccount(
    [{ id: "gaia-tarun", email: "tarun@velaenergy.ai", authMode: GOOGLE_ACCOUNT_AUTH_MODE }],
    { id: "gaia-tony", email: "Tony@VelaEnergy.ai", authMode: GOOGLE_ACCOUNT_AUTH_MODE },
  );
  assert.equal(selectedGoogleAccount(accounts, "gaia-tony").email, "tony@velaenergy.ai");
  assert.equal(selectedGoogleAccount(accounts, "missing").email, "tarun@velaenergy.ai");
  assert.equal(googleAccountById(accounts, "gaia-tony").email, "tony@velaenergy.ai");
  assert.equal(googleAccountById(accounts, "missing"), null, "delivery must not rotate to another connected sender");
});

test("connects and labels the Google account explicitly chosen by the user", async () => {
  const calls = [];
  const account = await chooseGoogleAccount({
    identity: chooserIdentity(calls),
    clientId: WEB_CLIENT_ID,
    scopes: [GMAIL_SEND_SCOPE],
    fetchImpl: accountFetch(),
    cryptoImpl: FIXED_CRYPTO,
  });
  assert.deepEqual(account, { id: "gaia-selected", email: "sender@vela.energy", authMode: GOOGLE_ACCOUNT_AUTH_MODE });
  assert.equal(calls[0].interactive, true);
  assert.equal(new URL(calls[0].url).searchParams.get("prompt"), "select_account");
});

test("silent authorization remains bound to the selected sender", async () => {
  const calls = [];
  await assert.rejects(getGoogleWebAuthToken({
    identity: chooserIdentity(calls),
    clientId: WEB_CLIENT_ID,
    scopes: [GMAIL_SEND_SCOPE],
    expectedEmail: "sender@vela.energy",
    fetchImpl: accountFetch("different@vela.energy"),
    cryptoImpl: FIXED_CRYPTO,
  }), /not the selected sender/);
  const request = new URL(calls[0].url);
  assert.equal(calls[0].interactive, false);
  assert.equal(calls[0].abortOnLoadForNonInteractive, false);
  assert.equal(request.searchParams.get("prompt"), "none");
  assert.equal(request.searchParams.get("login_hint"), "sender@vela.energy");
});

test("user-triggered token authorization opens the account chooser", async () => {
  const calls = [];
  const token = await getGoogleWebAuthToken({
    identity: chooserIdentity(calls),
    clientId: WEB_CLIENT_ID,
    scopes: [GMAIL_SEND_SCOPE],
    expectedEmail: "sender@vela.energy",
    interactive: true,
    fetchImpl: accountFetch("sender@vela.energy"),
    cryptoImpl: FIXED_CRYPTO,
  });
  const request = new URL(calls[0].url);
  assert.equal(token, "chosen-gmail-token");
  assert.equal(calls[0].interactive, true);
  assert.equal("abortOnLoadForNonInteractive" in calls[0], false);
  assert.equal(request.searchParams.get("prompt"), "select_account");
  assert.equal(request.searchParams.get("login_hint"), null);
});

test("disconnecting an account-chooser sender never touches a Chrome profile token cache", async () => {
  let cleared = false;
  await disconnectGoogle({ async clearAllCachedAuthTokens() { cleared = true; } }, { authMode: GOOGLE_ACCOUNT_AUTH_MODE });
  assert.equal(cleared, false);
});
