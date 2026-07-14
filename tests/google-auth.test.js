import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_ACCOUNT_AUTH_MODE,
  GOOGLE_CHROME_PROFILE_AUTH_MODE,
  GOOGLE_USERINFO_EMAIL_SCOPE,
  buildGoogleWebAuthUrl,
  chooseGoogleAccount,
  disconnectGoogle,
  getGoogleAuthToken,
  getGoogleWebAuthToken,
  getPrimaryGoogleAccount,
  googleOAuthErrorMessage,
  googleOAuthStrategy,
} from "../lib/google-auth.js";
import { GMAIL_SEND_SCOPE } from "../lib/gmail-send.js";

const MANIFEST = { oauth2: { client_id: "123-example.apps.googleusercontent.com" } };
const WEB_CLIENT_ID = "123-chooser.apps.googleusercontent.com";
const REDIRECT_URI = "https://mecnpdbecgmgjolcdldhkeplheojjpki.chromiumapp.org/google";
const FIXED_CRYPTO = {
  getRandomValues(bytes) {
    bytes.fill(7);
    return bytes;
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
      response.hash = new URLSearchParams({
        access_token: "chosen-gmail-token",
        expires_in: "3600",
        scope: request.searchParams.get("scope"),
        state: request.searchParams.get("state"),
      }).toString();
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
  assert.match(url.searchParams.get("scope"), /gmail\.send/);
});

test("V19 explains the exact redirect URI required for Google OAuth mismatch errors", () => {
  assert.equal(
    googleOAuthErrorMessage(new Error("Error 400: redirect_uri_mismatch"), { redirectUri: REDIRECT_URI }),
    `Google rejected the OAuth redirect. Add this exact Authorized redirect URI to this Web application client in Google Cloud: ${REDIRECT_URI}`,
  );
});

test("V20 never sends the manifest Chrome-extension client through Web OAuth", () => {
  assert.equal(
    googleOAuthStrategy({ manifest: MANIFEST, webClientId: MANIFEST.oauth2.client_id }),
    GOOGLE_CHROME_PROFILE_AUTH_MODE,
  );
  assert.equal(
    googleOAuthStrategy({ manifest: MANIFEST, webClientId: WEB_CLIENT_ID }),
    GOOGLE_ACCOUNT_AUTH_MODE,
  );
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

test("disconnecting an account-chooser sender does not clear unrelated Chrome profile grants", async () => {
  let cleared = false;
  await disconnectGoogle({ async clearAllCachedAuthTokens() { cleared = true; } }, { authMode: GOOGLE_ACCOUNT_AUTH_MODE });
  assert.equal(cleared, false);
});

test("requests only Gmail send for the primary Chrome profile account", async () => {
  const calls = [];
  const token = await getGoogleAuthToken({
    manifest: MANIFEST,
    scopes: [GMAIL_SEND_SCOPE],
    interactive: true,
    identity: {
      async getAuthToken(details) {
        calls.push(details);
        return { token: "gmail-token", grantedScopes: [GMAIL_SEND_SCOPE] };
      },
    },
  });
  assert.equal(token, "gmail-token");
  assert.deepEqual(calls, [{
    interactive: true,
    enableGranularPermissions: true,
    scopes: [GMAIL_SEND_SCOPE],
  }]);
});

test("rejects and evicts a token that did not receive Gmail send access", async () => {
  const removed = [];
  await assert.rejects(getGoogleAuthToken({
    manifest: MANIFEST,
    scope: GMAIL_SEND_SCOPE,
    identity: {
      async getAuthToken() { return { token: "wrong-token", grantedScopes: ["openid"] }; },
      async removeCachedAuthToken(details) { removed.push(details); },
    },
  }), /requested Google permission was not granted/);
  assert.deepEqual(removed, [{ token: "wrong-token" }]);
});

test("labels delivery with the primary Chrome profile email", async () => {
  const calls = [];
  const account = await getPrimaryGoogleAccount({
    async getProfileUserInfo(details) {
      calls.push(details);
      return { id: "gaia-123", email: "Tarun@Vela.Energy" };
    },
  });
  assert.deepEqual(calls, [{ accountStatus: "ANY" }]);
  assert.deepEqual(account, { id: "gaia-123", email: "tarun@vela.energy" });
});

test("requires Chrome itself to be signed in before connecting Gmail", async () => {
  await assert.rejects(
    getPrimaryGoogleAccount({ async getProfileUserInfo() { return { id: "", email: "" }; } }),
    /Sign in to Chrome itself/,
  );
});
