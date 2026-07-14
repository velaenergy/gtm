export const GOOGLE_ACCOUNT_STORAGE_KEY = "velaGtmGoogleAccount";
export const GOOGLE_ACCOUNTS_STORAGE_KEY = "velaGtmGoogleAccounts";
export const GOOGLE_SELECTED_ACCOUNT_ID_STORAGE_KEY = "velaGtmSelectedGoogleAccountId";
export const GOOGLE_ACCOUNT_AUTH_MODE = "account-chooser";
export const GOOGLE_OAUTH_REDIRECT_PATH = "google";
export const GOOGLE_USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

const GOOGLE_OAUTH_CLIENT_ID = /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export function normalizeGoogleAccount(input = {}) {
  const id = String(input?.id || "").trim();
  const email = String(input?.email || "").trim().toLowerCase();
  const authMode = input?.authMode === GOOGLE_ACCOUNT_AUTH_MODE ? GOOGLE_ACCOUNT_AUTH_MODE : "";
  return id && email ? { id, email, ...(authMode ? { authMode } : {}) } : null;
}

export function normalizeGoogleAccounts(accounts = [], legacyAccount = null) {
  const normalized = [];
  for (const candidate of [legacyAccount, ...(Array.isArray(accounts) ? accounts : [])]) {
    if (candidate?.authMode === "chrome-profile") continue;
    const account = normalizeGoogleAccount(candidate);
    if (!account) continue;
    const duplicateIndex = normalized.findIndex((item) => item.id === account.id || item.email === account.email);
    if (duplicateIndex >= 0) normalized[duplicateIndex] = { ...normalized[duplicateIndex], ...account };
    else normalized.push(account);
  }
  return normalized;
}

export function selectedGoogleAccount(accounts = [], selectedAccountId = "", legacyAccount = null) {
  const normalized = normalizeGoogleAccounts(accounts, legacyAccount);
  const selectedId = String(selectedAccountId || legacyAccount?.id || "").trim();
  return normalized.find((account) => account.id === selectedId) || normalized[0] || null;
}

export function googleAccountById(accounts = [], accountId = "", legacyAccount = null) {
  const expectedId = String(accountId || "").trim();
  return normalizeGoogleAccounts(accounts, legacyAccount).find((account) => account.id === expectedId) || null;
}

export function upsertGoogleAccount(accounts = [], account = null) {
  return normalizeGoogleAccounts([...(Array.isArray(accounts) ? accounts : []), account]);
}

export function googleWebOAuthConfigured(clientId = "") {
  return GOOGLE_OAUTH_CLIENT_ID.test(String(clientId || "").trim());
}

export function googleOAuthStrategy({ webClientId = "" } = {}) {
  return googleWebOAuthConfigured(webClientId) ? GOOGLE_ACCOUNT_AUTH_MODE : "";
}

export function googleAuthStrategyForAccount({ account = null, webClientId = "" } = {}) {
  const normalized = normalizeGoogleAccount(account);
  return normalized && googleWebOAuthConfigured(webClientId) ? GOOGLE_ACCOUNT_AUTH_MODE : "";
}

export function googleOAuthErrorMessage(error, { redirectUri = "" } = {}) {
  const message = error instanceof Error ? error.message : String(error || "Google authorization failed.");
  if (/redirect_uri_mismatch/i.test(message)) {
    return redirectUri
      ? `Google rejected the OAuth redirect. Add this exact Authorized redirect URI to this Web application client in Google Cloud: ${redirectUri}`
      : "Google rejected the OAuth redirect. Copy the exact Authorized redirect URI from Settings into this Web application client in Google Cloud.";
  }
  if (/restricted to users within its organization/i.test(message)) {
    return "That Google account is outside this OAuth app's organization. Choose a Vela Workspace account, or change the Google Auth Platform audience to External and add the address as a test user.";
  }
  if (/user did not approve|access denied|denied by user/i.test(message)) return "Google connection was canceled before access was granted.";
  return message;
}

export function googleWebRedirectUri(identity) {
  if (!identity?.getRedirectURL) throw new Error("Chrome Identity cannot create the Google account-chooser redirect URL.");
  return identity.getRedirectURL(GOOGLE_OAUTH_REDIRECT_PATH);
}

function normalizedScopes(scopes = []) {
  return [...new Set((Array.isArray(scopes) ? scopes : [])
    .map((scope) => String(scope || "").trim())
    .filter(Boolean))];
}

function randomOAuthState(cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.getRandomValues) throw new Error("Secure randomness is unavailable for Google authorization.");
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildGoogleWebAuthUrl({ clientId = "", redirectUri = "", scopes = [], state = "", interactive = true, loginHint = "" } = {}) {
  if (!googleWebOAuthConfigured(clientId)) throw new Error("Add a valid Google Web OAuth client ID in Settings.");
  if (!/^https:\/\/[a-p]{32}\.chromiumapp\.org\//.test(redirectUri)) throw new Error("The Google OAuth redirect URL does not match this Chrome extension.");
  const requestedScopes = normalizedScopes(scopes);
  if (!requestedScopes.length) throw new Error("Google authorization requires at least one scope.");
  if (!state) throw new Error("Google authorization requires a state value.");

  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", String(clientId).trim());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("scope", requestedScopes.join(" "));
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", interactive ? "select_account" : "none");
  if (!interactive && String(loginHint || "").trim()) url.searchParams.set("login_hint", String(loginHint).trim().toLowerCase());
  return url.toString();
}

export function parseGoogleWebAuthResponse(responseUrl = "", { expectedState = "", requiredScopes = [] } = {}) {
  if (!responseUrl) throw new Error("Google authorization closed before returning to Vela.");
  const url = new URL(responseUrl);
  const params = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const [key, value] of fragment) params.set(key, value);

  if (!expectedState || params.get("state") !== expectedState) throw new Error("Google authorization returned an invalid state value.");
  const oauthError = params.get("error");
  if (oauthError) {
    const detail = params.get("error_description") || oauthError;
    if (["interaction_required", "login_required", "consent_required"].includes(oauthError)) {
      throw new Error("The selected Gmail session needs to be reconnected in Settings.");
    }
    throw new Error(googleOAuthErrorMessage(detail));
  }

  const token = params.get("access_token") || "";
  if (!token) throw new Error("Google authorization did not return an access token.");
  const returnedScopes = normalizedScopes(String(params.get("scope") || "").split(/\s+/));
  const missingScope = returnedScopes.length
    ? normalizedScopes(requiredScopes).find((scope) => !returnedScopes.includes(scope))
    : "";
  if (missingScope) throw new Error("The selected Google account did not grant Gmail send access.");
  return { token, expiresIn: Number(params.get("expires_in")) || 0, scopes: returnedScopes };
}

async function googleAccountForToken(token, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("Google account verification is unavailable.");
  const response = await fetchImpl(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_description || payload?.error?.message || "Google could not verify the selected sender account.");
  const id = String(payload?.sub || payload?.id || "").trim();
  const email = String(payload?.email || "").trim().toLowerCase();
  if (!id || !email) throw new Error("Google did not return the selected sender account.");
  return { id, email, authMode: GOOGLE_ACCOUNT_AUTH_MODE };
}

async function runGoogleWebAuth({ identity, clientId = "", scopes = [], interactive = false, loginHint = "", fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
  if (!identity?.launchWebAuthFlow) throw new Error("Chrome Identity cannot open the Google account chooser.");
  const redirectUri = googleWebRedirectUri(identity);
  const requestedScopes = normalizedScopes([...scopes, GOOGLE_USERINFO_EMAIL_SCOPE]);
  const state = randomOAuthState(cryptoImpl);
  const url = buildGoogleWebAuthUrl({ clientId, redirectUri, scopes: requestedScopes, state, interactive, loginHint });
  let responseUrl;
  try {
    responseUrl = await identity.launchWebAuthFlow({
      url,
      interactive,
      ...(!interactive ? { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 15000 } : {}),
    });
  } catch (error) {
    throw new Error(googleOAuthErrorMessage(error, { redirectUri }), { cause: error });
  }
  const authorization = parseGoogleWebAuthResponse(responseUrl, { expectedState: state, requiredScopes: requestedScopes });
  const account = await googleAccountForToken(authorization.token, fetchImpl);
  return { ...authorization, account };
}

export async function chooseGoogleAccount(options = {}) {
  const result = await runGoogleWebAuth({ ...options, interactive: true, loginHint: "" });
  return result.account;
}

export async function getGoogleWebAuthToken({ expectedEmail = "", ...options } = {}) {
  const result = await runGoogleWebAuth({ ...options, interactive: false, loginHint: expectedEmail });
  const normalizedExpected = String(expectedEmail || "").trim().toLowerCase();
  if (normalizedExpected && result.account.email !== normalizedExpected) {
    throw new Error(`Google authorized ${result.account.email}, not the selected sender ${normalizedExpected}. Choose the sender again in Settings.`);
  }
  return result.token;
}

export async function disconnectGoogle() {
  // Web OAuth access tokens are transient and are never persisted by Vela.
}
