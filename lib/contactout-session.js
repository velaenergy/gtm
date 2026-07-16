import { normalizeContactOutResponse } from "./contactout.js";
import { appendDiagnostic } from "./diagnostics.js";

export const CONTACTOUT_SESSION_STORAGE_KEY = "velaContactOutSession";
export const CONTACTOUT_SESSION_SOURCE = "ContactOut browser session";
export const CONTACTOUT_CLIENT_VERSION = "5.6.18";

const CONTACTOUT_ORIGIN = "https://contactout.com";
const CONTACTOUT_APP_PATH = "/extension/app/";
const PENDING_REVEAL_TTL_MS = 10 * 60 * 1000;

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function normalizedLinkedInUrl(value = "") {
  try {
    const url = new URL(value);
    const vanity = url.pathname.match(/^\/in\/([^/]+)/i)?.[1];
    return vanity ? `https://www.linkedin.com/in/${vanity}/` : "";
  } catch {
    return "";
  }
}

function normalizedIdentityName(value = "") {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameIdentityName(left = "", right = "") {
  const leftParts = normalizedIdentityName(left).split(" ").filter(Boolean);
  const rightParts = normalizedIdentityName(right).split(" ").filter(Boolean);
  if (!leftParts.length || !rightParts.length) return true;
  return leftParts.join(" ") === rightParts.join(" ")
    || (leftParts[0] === rightParts[0] && leftParts.at(-1) === rightParts.at(-1));
}

function vanityFromUrl(value = "") {
  return normalizedLinkedInUrl(value).match(/\/in\/([^/]+)/i)?.[1]?.toLowerCase() || "";
}

function recordIdentity(record = {}, key = "") {
  const profileUrl = normalizedLinkedInUrl(record.profile_url || record.linkedin_url || record.linkedinUrl || key);
  return {
    profileUrl,
    vanity: clean(record.li_vanity || record.vanity || vanityFromUrl(profileUrl)).toLowerCase(),
    memberId: finiteNumber(record.member_id || record.memberId),
    fullName: clean(record.full_name || record.fullName || record.name),
  };
}

export function selectContactOutSessionRecord(profiles = {}, descriptor = {}) {
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) return null;
  const expected = recordIdentity(descriptor);
  const matches = [];
  for (const [key, record] of Object.entries(profiles)) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const actual = recordIdentity(record, key);
    if (expected.memberId && actual.memberId && expected.memberId !== actual.memberId) continue;
    if (expected.profileUrl && actual.profileUrl && expected.profileUrl !== actual.profileUrl) continue;
    if (expected.vanity && actual.vanity && expected.vanity !== actual.vanity) continue;
    let score = 0;
    if (expected.memberId && actual.memberId === expected.memberId) score += 100;
    if (expected.profileUrl && actual.profileUrl === expected.profileUrl) score += 80;
    if (expected.vanity && actual.vanity === expected.vanity) score += 50;
    if (score && sameIdentityName(expected.fullName, actual.fullName)) score += 10;
    if (score) matches.push({ record, score });
  }
  return matches.sort((left, right) => right.score - left.score)[0]?.record || null;
}

function assertContactOutSessionRevealIdentity(raw = {}, pending = {}) {
  const descriptor = pending.descriptor || {
    profile_url: pending.profile?.url,
    full_name: pending.profile?.name,
    member_id: pending.profile?.memberId || pending.profile?.member_id,
  };
  const expected = recordIdentity(descriptor);
  const actual = recordIdentity(raw);
  const mismatched = (expected.memberId && actual.memberId && expected.memberId !== actual.memberId)
    || (expected.profileUrl && actual.profileUrl && expected.profileUrl !== actual.profileUrl)
    || (expected.vanity && actual.vanity && expected.vanity !== actual.vanity)
    || !sameIdentityName(expected.fullName, actual.fullName);
  if (mismatched) {
    throw new ContactOutSessionError(
      "ContactOut returned contact data for a different LinkedIn profile. Vela discarded it instead of adding the address.",
      "profile_mismatch",
      409,
    );
  }
}

export class ContactOutSessionError extends Error {
  constructor(message, code = "session_error", status = 0) {
    super(message);
    this.name = "ContactOutSessionError";
    this.code = code;
    this.status = status;
  }
}

export function buildContactOutSessionProfile(profile = {}) {
  const profileUrl = normalizedLinkedInUrl(profile.url);
  if (!profileUrl) throw new ContactOutSessionError("A regular LinkedIn profile URL is required for ContactOut.", "invalid_profile");
  const memberId = finiteNumber(profile.memberId || profile.member_id);
  const pastCompanies = [...new Set((profile.experiences || [])
    .map((experience) => finiteNumber(experience.companyId || experience.company_id))
    .filter((value) => value > 0))]
    .slice(0, 8);
  return {
    profile_url: profileUrl,
    li_vanity: profileUrl.match(/\/in\/([^/]+)/i)?.[1] || "",
    full_name: clean(profile.name),
    headline: clean(profile.headline),
    location: clean(profile.location),
    company: clean(profile.experiences?.[0]?.company),
    companies: [],
    member_id: memberId,
    past_companies: pastCompanies,
    profile_type: "regular",
  };
}

export function summarizeContactOutSessionUser(payload = {}) {
  const userId = finiteNumber(payload.user_id);
  if (!userId) throw new ContactOutSessionError("ContactOut did not return a signed-in user. Finish login and try again.", "login_required");
  const restrictions = payload.restrictions && typeof payload.restrictions === "object"
    ? Object.fromEntries(Object.entries(payload.restrictions).map(([key, value]) => [key, clean(value?.message)]).filter(([, value]) => value))
    : {};
  return {
    connected: true,
    userId,
    uuid: clean(payload.uuid),
    name: clean(payload.name),
    email: clean(payload.email),
    premium: !["", "0", "false", "no"].includes(clean(payload.premium).toLowerCase()),
    allowSearch: Boolean(payload.allow_search),
    credits: {
      email: finiteNumber(payload.credit),
      phone: finiteNumber(payload.phoneCredit),
      export: finiteNumber(payload.ats_export_limit),
    },
    restrictions,
  };
}

function verifiedInternalEmail(candidate = {}, verificationStatus = "") {
  const confidence = clean(candidate.confidence_level).toLowerCase();
  if (!candidate.is_guess && ["high", "verified", "valid"].includes(confidence)) return true;
  return ["verified", "valid"].includes(clean(verificationStatus).toLowerCase());
}

function internalEmailStatus(candidate = {}, verificationStatus = "") {
  if (verifiedInternalEmail(candidate, verificationStatus)) return "verified";
  const status = clean(verificationStatus).toLowerCase().replace(/[\s-]+/g, "_");
  return ["checking", "pending", "processing", "queued", "in_progress", "accept_all", "unknown", "invalid", "disposable"].includes(status)
    ? status
    : "unverified";
}

export function normalizeContactOutSessionReveal(payload = {}, pending = {}) {
  const raw = payload.profile || {};
  assertContactOutSessionRevealIdentity(raw, pending);
  const emails = (Array.isArray(raw.emails) ? raw.emails : []).filter((candidate) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(candidate.value)));
  const workEmails = emails.filter((candidate) => Number(candidate.type) === 2);
  const personalEmails = emails.filter((candidate) => Number(candidate.type) === 1);
  const workStatuses = Object.fromEntries(workEmails.map((candidate) => [clean(candidate.value).toLowerCase(), internalEmailStatus(candidate, pending.verificationStatus)]));
  const personalStatuses = Object.fromEntries(personalEmails.map((candidate) => [clean(candidate.value).toLowerCase(), internalEmailStatus(candidate, pending.verificationStatus)]));
  const phones = pending.includePhone
    ? (Array.isArray(raw.phones) ? raw.phones : []).map((candidate) => clean(candidate.value)).filter(Boolean)
    : [];
  const profile = pending.profile || {};
  const normalized = normalizeContactOutResponse({
    profile: {
      full_name: clean(raw.full_name || profile.name),
      headline: clean(profile.headline),
      location: clean(profile.location),
      work_email: workEmails.map((candidate) => clean(candidate.value).toLowerCase()),
      work_email_status: workStatuses,
      personal_email: personalEmails.map((candidate) => clean(candidate.value).toLowerCase()),
      personal_email_status: personalStatuses,
      phone: phones,
    },
  }, CONTACTOUT_SESSION_SOURCE);
  return {
    ...normalized,
    source: CONTACTOUT_SESSION_SOURCE,
    profile: normalized.profile ? {
      ...normalized.profile,
      about: clean(profile.about).slice(0, 1200),
      experiences: Array.isArray(profile.experiences) ? profile.experiences.slice(0, 6) : [],
    } : null,
    credits: {
      before: finiteNumber(pending.creditsBefore),
      after: finiteNumber(payload.userCredits?.email ?? payload.credit),
      phone: finiteNumber(payload.userCredits?.phone),
    },
  };
}

// This function is serialized by chrome.scripting and executes in ContactOut's own page.
// It deliberately returns only the response body and never returns any cookie value.
export async function contactOutPageRequest(path, request = {}) {
  const method = String(request.method || "GET").toUpperCase();
  const headers = { Accept: "application/json", ...(request.headers || {}) };
  if (method !== "GET") {
    const tokenPair = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith("XSRF-TOKEN="));
    if (!tokenPair) return { ok: false, status: 419, error: "ContactOut's CSRF session is missing. Sign in again." };
    let token = tokenPair.slice("XSRF-TOKEN=".length);
    try { token = decodeURIComponent(token); } catch { /* The raw token is still the browser-issued value. */ }
    headers["Content-Type"] = "application/json";
    headers["x-xsrf-token"] = token;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(request.timeoutMs) || 15000));
  try {
    const response = await fetch(new URL(path, location.origin), {
      method,
      credentials: "include",
      cache: "no-store",
      headers,
      body: request.body == null ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { /* Login pages and Cloudflare challenges are HTML. */ }
    return {
      ok: response.ok && data !== null,
      status: response.status,
      data,
      finalPath: new URL(response.url).pathname,
      error: data?.message || (!data ? "ContactOut returned a login page or browser challenge." : ""),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.name === "AbortError"
        ? "ContactOut did not respond within 15 seconds."
        : error instanceof Error ? error.message : "ContactOut request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function sessionState(chromeApi) {
  const stored = await chromeApi.storage.local.get(CONTACTOUT_SESSION_STORAGE_KEY);
  const value = stored[CONTACTOUT_SESSION_STORAGE_KEY] || {};
  const pendingReveals = Object.fromEntries(Object.entries(value.pendingReveals || {})
    .filter(([, pending]) => Date.now() - finiteNumber(pending.createdAt) < PENDING_REVEAL_TTL_MS));
  return {
    installationId: clean(value.installationId) || randomId(),
    pendingReveals,
  };
}

async function saveSessionState(chromeApi, value) {
  await chromeApi.storage.local.set({ [CONTACTOUT_SESSION_STORAGE_KEY]: value });
}

async function waitForTab(chromeApi, tabId, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const tab = await chromeApi.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new ContactOutSessionError("ContactOut took too long to load.", "page_timeout");
}

function isContactOutAppTab(tab = {}, installationId = "") {
  try {
    const url = new URL(tab.url || "");
    return url.pathname.startsWith(CONTACTOUT_APP_PATH)
      && (!installationId || url.searchParams.get("uuid") === installationId);
  } catch {
    return false;
  }
}

async function contactOutTab(chromeApi, { createPage = false, requireAppPage = false, installationId = "" } = {}) {
  const tabs = await chromeApi.tabs.query({ url: `${CONTACTOUT_ORIGIN}/*` });
  const eligible = requireAppPage ? tabs.filter((tab) => isContactOutAppTab(tab, installationId)) : tabs;
  const tab = eligible.find((candidate) => candidate.id && candidate.status === "complete") || eligible.find((candidate) => candidate.id);
  if (tab?.id) {
    await appendDiagnostic({ area: "contactout", stage: "bridge_tab", outcome: "reused", tabContext: requireAppPage ? "extension_app" : "contactout_page" }, { chromeApi });
    return tab.status === "complete" ? tab : waitForTab(chromeApi, tab.id);
  }
  if (!createPage) throw new ContactOutSessionError("Open ContactOut and finish signing in before checking the session.", "login_required");
  const path = requireAppPage
    ? `${CONTACTOUT_APP_PATH}?source=popup&uuid=${encodeURIComponent(installationId)}`
    : "/login/callback?login=1";
  const created = await chromeApi.tabs.create({ url: `${CONTACTOUT_ORIGIN}${path}`, active: false });
  await appendDiagnostic({ area: "contactout", stage: "bridge_tab", outcome: "created", tabContext: requireAppPage ? "extension_app" : "login_callback" }, { chromeApi });
  return waitForTab(chromeApi, created.id);
}

async function pageRequest(chromeApi, tabId, path, request = {}) {
  const results = await chromeApi.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: contactOutPageRequest,
    args: [path, request],
  });
  const result = results?.[0]?.result;
  await appendDiagnostic({
    area: "contactout",
    stage: path.split("?")[0].replace(/^\/api\/?/, "") || "request",
    outcome: result?.ok ? "ok" : "error",
    httpStatus: result?.status || 0,
    clientVersion: request.body?.version,
    message: result?.ok ? "" : result?.error,
  }, { chromeApi });
  if (!result?.ok) {
    const loginRequired = result?.finalPath?.startsWith("/login") || [401, 419].includes(result?.status);
    throw new ContactOutSessionError(
      loginRequired ? "Your ContactOut browser session expired. Sign in again to continue." : result?.error || `ContactOut returned ${result?.status || "an invalid response"}.`,
      loginRequired ? "login_required" : "request_failed",
      result?.status || 0,
    );
  }
  return result.data;
}

async function connectedContext({ chromeApi = globalThis.chrome, createPage = false, requireAppPage = false } = {}) {
  if (!chromeApi?.tabs || !chromeApi?.scripting || !chromeApi?.storage?.local) throw new ContactOutSessionError("Load Vela GTM as a Chrome extension to use the ContactOut session.", "extension_required");
  const state = await sessionState(chromeApi);
  const version = CONTACTOUT_CLIENT_VERSION;
  const tab = await contactOutTab(chromeApi, { createPage, requireAppPage, installationId: state.installationId });
  const params = new URLSearchParams({ uuid: state.installationId, version });
  const payload = await pageRequest(chromeApi, tab.id, `/api/user/info?${params.toString()}`);
  const account = summarizeContactOutSessionUser(payload);
  const installationId = account.uuid || state.installationId;
  const nextState = { ...state, installationId };
  await saveSessionState(chromeApi, nextState);
  return { account, state: nextState, tab, version };
}

export async function openContactOutSessionLogin({ chromeApi = globalThis.chrome } = {}) {
  if (!chromeApi?.tabs) throw new ContactOutSessionError("Load Vela GTM as a Chrome extension to connect ContactOut.", "extension_required");
  const tab = await chromeApi.tabs.create({ url: `${CONTACTOUT_ORIGIN}/login`, active: true });
  return { opened: true, tabId: tab.id };
}

export async function contactOutSessionStatus(options = {}) {
  const { account } = await connectedContext(options);
  return account;
}

function boundedProfile(profile = {}) {
  return {
    name: clean(profile.name),
    headline: clean(profile.headline),
    location: clean(profile.location),
    about: clean(profile.about).slice(0, 1200),
    experiences: (Array.isArray(profile.experiences) ? profile.experiences : []).slice(0, 6).map((experience) => ({
      title: clean(experience.title),
      company: clean(experience.company),
      dates: clean(experience.dates),
      location: clean(experience.location),
      details: clean(experience.details).slice(0, 700),
    })),
  };
}

async function pollVerification(chromeApi, tabId, context, jobId, attempts = 4) {
  if (!jobId) return "";
  let status = "checking";
  for (let attempt = 0; attempt < attempts && status === "checking"; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 700));
    const result = await pageRequest(chromeApi, tabId, "/api/email/verify/status", {
      method: "POST",
      body: { job_id: jobId, track_id: null, user: context.account.userId, uuid: context.state.installationId, version: context.version },
    });
    status = clean(result.email_status).toLowerCase() || status;
  }
  return status;
}

export async function previewContactOutSession(profile, { chromeApi = globalThis.chrome, includePhone = false } = {}) {
  await appendDiagnostic({ area: "contactout", stage: "preview_start", outcome: "info", profileKind: normalizedLinkedInUrl(profile?.url) ? "linkedin_profile" : "invalid_profile", memberIdPresent: finiteNumber(profile?.memberId || profile?.member_id) > 0 }, { chromeApi });
  const context = await connectedContext({ chromeApi, createPage: true, requireAppPage: true });
  const descriptor = buildContactOutSessionProfile(profile);
  const response = await pageRequest(chromeApi, context.tab.id, "/api/v5/profiles/encrypted", {
    method: "POST",
    body: {
      profiles: [descriptor],
      profile_type: "regular",
      user: context.account.userId,
      uuid: context.state.installationId,
      version: context.version,
    },
  });
  if (response.success === false) throw new ContactOutSessionError(clean(response.message) || "ContactOut could not inspect this profile.", "lookup_failed", finiteNumber(response.status));
  const restricted = response.data?.userRestrictedInfo;
  if (restricted?.flag) throw new ContactOutSessionError(clean(restricted.message) || "This ContactOut account cannot reveal contact information.", "account_restricted");
  const profiles = response.data?.profiles && typeof response.data.profiles === "object" ? response.data.profiles : {};
  const records = Object.values(profiles);
  const record = selectContactOutSessionRecord(profiles, descriptor);
  if (records.length && !record) {
    throw new ContactOutSessionError(
      "ContactOut matched a different LinkedIn profile. Vela stopped before revealing or saving any address.",
      "profile_mismatch",
      409,
    );
  }
  const matchedRecord = record || {};
  const emailCandidates = Array.isArray(matchedRecord.emails) ? matchedRecord.emails : [];
  const phoneCandidates = Array.isArray(matchedRecord.phones) ? matchedRecord.phones : [];
  const creditsBefore = finiteNumber(response.userCredits?.email ?? response.data?.credits ?? context.account.credits.email);
  const resolvedDescriptor = {
    ...descriptor,
    profile_url: normalizedLinkedInUrl(matchedRecord.profile_url) || descriptor.profile_url,
    li_vanity: clean(matchedRecord.li_vanity) || descriptor.li_vanity,
    full_name: clean(matchedRecord.full_name) || descriptor.full_name,
    member_id: finiteNumber(matchedRecord.member_id) || descriptor.member_id,
    companies: (Array.isArray(matchedRecord.companies) ? matchedRecord.companies : descriptor.companies).map((value) => finiteNumber(value)).filter((value) => value > 0).slice(0, 8),
  };
  await appendDiagnostic({
    area: "contactout", stage: "encrypted_preview", outcome: records.length ? "match" : "no_match",
    httpStatus: finiteNumber(response.status), profileKind: "linkedin_profile", memberIdPresent: descriptor.member_id > 0,
    memberIdResolved: resolvedDescriptor.member_id > 0, candidateCount: emailCandidates.length,
    phoneCandidateCount: phoneCandidates.length, creditsBefore,
  }, { chromeApi });
  if (!emailCandidates.length && !(includePhone && phoneCandidates.length)) {
    return {
      requiresReveal: false,
      source: CONTACTOUT_SESSION_SOURCE,
      email: "",
      emails: [],
      phones: [],
      profile: null,
      credits: { before: creditsBefore, after: creditsBefore, phone: context.account.credits.phone },
    };
  }
  if (emailCandidates.length && creditsBefore <= 0) throw new ContactOutSessionError("The signed-in ContactOut account has no email reveal credits remaining.", "credits_exhausted", 402);
  const verifyJobId = finiteNumber(emailCandidates.find((candidate) => finiteNumber(candidate.job_id) > 0)?.job_id);
  const verificationStatus = await pollVerification(chromeApi, context.tab.id, context, verifyJobId);
  const revealToken = randomId();
  const pending = {
    createdAt: Date.now(),
    accountUserId: context.account.userId,
    descriptor: resolvedDescriptor,
    profile: boundedProfile(profile),
    includePhone: Boolean(includePhone),
    verifyJobId,
    verificationStatus,
    creditsBefore,
  };
  const nextState = {
    ...context.state,
    pendingReveals: { ...context.state.pendingReveals, [revealToken]: pending },
  };
  await saveSessionState(chromeApi, nextState);
  return {
    requiresReveal: true,
    revealToken,
    source: CONTACTOUT_SESSION_SOURCE,
    profileUrl: descriptor.profile_url,
    candidateCounts: { email: emailCandidates.length, phone: includePhone ? phoneCandidates.length : 0 },
    estimatedCredits: { email: emailCandidates.length ? 1 : 0, phone: 0 },
    credits: { before: creditsBefore, phone: context.account.credits.phone },
  };
}

export async function revealContactOutSession(revealToken, { chromeApi = globalThis.chrome } = {}) {
  const state = await sessionState(chromeApi);
  const pending = state.pendingReveals[revealToken];
  if (!pending) throw new ContactOutSessionError("This ContactOut reveal approval expired. Preview the profile again.", "approval_expired");
  // Claim the approval before the paid call so retries or double-clicks cannot reuse it.
  delete state.pendingReveals[revealToken];
  await saveSessionState(chromeApi, state);
  const context = await connectedContext({ chromeApi, createPage: true, requireAppPage: true });
  if (context.account.userId !== pending.accountUserId) throw new ContactOutSessionError("The active ContactOut account changed after approval. Preview the profile again.", "account_changed");
  const body = {
    ...pending.descriptor,
    user: context.account.userId,
    uuid: context.state.installationId,
    version: context.version,
  };
  body.verify_job_id = pending.verifyJobId || null;
  const response = await pageRequest(chromeApi, context.tab.id, "/api/v5/profiles/reveal", {
    method: "POST",
    headers: { "x-reveal-source": "12" },
    body,
  });
  const result = normalizeContactOutSessionReveal(response, pending);
  await appendDiagnostic({
    area: "contactout", stage: "reveal_complete", outcome: result.email ? "verified" : "no_verified_email",
    httpStatus: finiteNumber(response.status), candidateCount: result.emails?.length || 0,
    creditsBefore: result.credits?.before, creditsAfter: result.credits?.after, memberIdResolved: pending.descriptor.member_id > 0,
  }, { chromeApi });
  return result;
}
