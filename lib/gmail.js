export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
export const GMAIL_DRAFTS_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
export const GMAIL_DRAFTS_WEB_URL = "https://mail.google.com/mail/#drafts";
export const GMAIL_PROFILE_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
export const GOOGLE_ACCOUNT_STORAGE_KEY = "velaGtmGoogleAccount";

const GOOGLE_OAUTH_CLIENT_ID = /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const EMAIL_LOCAL_PART = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const EMAIL_DOMAIN = /^(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i;

function safeHeader(value = "", label = "Header") {
  const raw = String(value);
  if (/[\r\n]/.test(raw)) throw new Error(`${label} cannot contain line breaks.`);
  return raw.trim();
}

function recipientEmail(value = "") {
  const recipient = safeHeader(value, "Recipient email");
  const parts = recipient.split("@");
  const local = parts[0] || "";
  const domain = parts[1] || "";
  const validLocal = EMAIL_LOCAL_PART.test(local) && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
  if (parts.length !== 2 || !validLocal || !EMAIL_DOMAIN.test(domain)) throw new Error("Enter one valid recipient email address.");
  return recipient;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64UrlEncode(value = "") {
  return bytesToBase64(new TextEncoder().encode(String(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function encodeMimeHeader(value = "") {
  const clean = safeHeader(value, "Subject");
  return /^[\x20-\x7E]*$/.test(clean) ? clean : `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(clean))}?=`;
}

export function buildMimeMessage({ to = "", subject = "", body = "" } = {}) {
  const recipient = recipientEmail(to);
  const normalizedBody = String(body).replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
  return [
    `To: ${recipient}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizedBody,
  ].join("\r\n");
}

export function gmailDraftPayload(message = {}) {
  return { message: { raw: base64UrlEncode(buildMimeMessage(message)) } };
}

export function gmailOAuthConfigured(manifest = {}) {
  const clientId = String(manifest.oauth2?.client_id || "").trim();
  return GOOGLE_OAUTH_CLIENT_ID.test(clientId) && !clientId.startsWith("REPLACE_WITH_");
}

export function googleOAuthErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "Google authorization failed.");
  if (/restricted to users within its organization/i.test(message)) {
    return "This Google OAuth app only allows organization accounts. Choose a Vela Workspace account, or change the Google Auth Platform audience to External and add this Gmail address as a test user.";
  }
  if (/user did not approve|access denied|denied by user/i.test(message)) return "Google connection was canceled before access was granted.";
  return message;
}

export async function listGoogleAccounts(identity) {
  if (!identity?.getAccounts) throw new Error("Update Chrome to choose among signed-in Google accounts.");
  const accounts = await identity.getAccounts();
  if (!accounts?.length) throw new Error("Sign in to at least one Google account in this Chrome profile, then try again.");
  const primary = identity.getProfileUserInfo
    ? await identity.getProfileUserInfo({ accountStatus: "ANY" }).catch(() => ({}))
    : {};
  return accounts.map((account, index) => ({
    id: account.id,
    label: account.id === primary.id && primary.email ? primary.email : `Signed-in Google account ${index + 1}`,
    primary: account.id === primary.id,
  }));
}

export async function getGmailAuthToken({ identity, manifest = {}, interactive = false, accountId = "" } = {}) {
  if (!gmailOAuthConfigured(manifest)) throw new Error("Add the Google OAuth client ID in manifest.json, then reload the extension.");
  if (!identity?.getAuthToken) throw new Error("Chrome Identity is unavailable.");

  let result;
  try {
    result = await identity.getAuthToken({
      interactive,
      enableGranularPermissions: true,
      ...(accountId ? { account: { id: accountId } } : {}),
    });
  } catch (error) {
    throw new Error(googleOAuthErrorMessage(error), { cause: error });
  }
  const token = typeof result === "string" ? result : result?.token;
  if (!token) throw new Error("Gmail authorization did not return an access token.");

  const grantedScopes = typeof result === "object" && Array.isArray(result?.grantedScopes) ? result.grantedScopes : null;
  if (grantedScopes && !grantedScopes.includes(GMAIL_COMPOSE_SCOPE)) {
    if (identity.removeCachedAuthToken) await identity.removeCachedAuthToken({ token }).catch(() => {});
    throw new Error("Gmail compose permission was not granted. Disconnect and reconnect Gmail.");
  }
  return token;
}

export async function getGmailProfile(token, { fetchImpl = globalThis.fetch } = {}) {
  if (!token) throw new Error("A Gmail access token is required.");
  const response = await fetchImpl(GMAIL_PROFILE_API_URL, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new GmailApiError(payload.error?.message || `Gmail returned ${response.status}.`, response.status);
  return { email: String(payload.emailAddress || "").trim(), historyId: payload.historyId || "" };
}

export async function disconnectGmail(identity) {
  if (!identity?.clearAllCachedAuthTokens) throw new Error("Chrome Identity cannot disconnect Gmail.");
  await identity.clearAllCachedAuthTokens();
}

export class GmailApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
  }
}

export async function createGmailDraft(token, message, { fetchImpl = globalThis.fetch } = {}) {
  if (!token) throw new Error("A Gmail access token is required.");
  if (typeof fetchImpl !== "function") throw new Error("Gmail requests are unavailable.");
  const response = await fetchImpl(GMAIL_DRAFTS_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(gmailDraftPayload(message)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new GmailApiError(payload.error?.message || `Gmail returned ${response.status}.`, response.status);
  return payload.id || "created";
}

export async function createGmailDraftWithRetry(
  message,
  { authState, removeCachedToken, getFreshToken, fetchImpl = globalThis.fetch } = {},
) {
  if (!authState?.token) throw new Error("A Gmail access token is required.");
  try {
    return await createGmailDraft(authState.token, message, { fetchImpl });
  } catch (error) {
    if (!(error instanceof GmailApiError) || error.status !== 401 || authState.refreshAttempted) throw error;
    authState.refreshAttempted = true;
    const invalidToken = authState.token;
    if (typeof removeCachedToken !== "function" || typeof getFreshToken !== "function") throw error;
    await removeCachedToken(invalidToken);
    authState.token = await getFreshToken();
    return createGmailDraft(authState.token, message, { fetchImpl });
  }
}

export function gmailDraftBatchSummary(created, failed) {
  const createdCount = Math.max(0, Number(created) || 0);
  const failedCount = Math.max(0, Number(failed) || 0);
  const createdLabel = `${createdCount} Gmail draft${createdCount === 1 ? "" : "s"}`;
  const failedLabel = `${failedCount} failed`;
  if (createdCount && failedCount) return `Created ${createdLabel}; ${failedLabel}. Nothing was sent.`;
  if (createdCount) return `Created ${createdLabel}. Open Gmail to review and send manually.`;
  if (failedCount) return `No Gmail drafts were created; ${failedLabel}.`;
  return "No Gmail drafts were created.";
}
