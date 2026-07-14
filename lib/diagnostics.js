export const DIAGNOSTIC_STORAGE_KEY = "velaGtmDiagnostics";

const MAX_DIAGNOSTICS = 150;
const SAFE_DETAIL_KEYS = new Set([
  "provider", "code", "httpStatus", "tabContext", "profileKind", "memberIdPresent", "memberIdResolved",
  "candidateCount", "phoneCandidateCount", "creditsBefore", "creditsAfter", "requiresReveal", "clientVersion",
]);

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeLabel(value = "") {
  return clean(value).replace(/[^a-z0-9_.:-]+/gi, "_").slice(0, 80);
}

export function redactDiagnosticMessage(value = "") {
  return clean(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(?:bearer|token|csrf|cookie|authorization)\b\s*[:=]?\s*\S*/gi, "[redacted-secret]")
    .slice(0, 280);
}

export function classifyDiagnosticError(value = "", status = 0) {
  const message = clean(value).toLowerCase();
  if (/linkedin profile url|required.*linkedin profile|invalid linkedin/.test(message)) return "invalid_profile";
  if (/csrf/.test(message)) return "csrf_missing";
  if (/expired|sign in|login/.test(message)) return "login_required";
  if (/timed out|did not respond|too long/.test(message)) return "timeout";
  if (/sample response|sample fixture/.test(message)) return "api_sample_only";
  if (/no .*credits|credits exhausted|out of credits/.test(message)) return "credits_exhausted";
  if (/401|unauthorized|credentials|api key/.test(message) || Number(status) === 401) return "unauthorized";
  if (/no verified|did not return.*verified/.test(message)) return "no_verified_email";
  if (/contact info link|contact info.*not available/.test(message)) return "linkedin_contact_unavailable";
  return Number(status) > 0 ? `http_${Number(status)}` : "request_failed";
}

export function normalizeDiagnosticEvent(event = {}, now = new Date()) {
  const record = {
    id: globalThis.crypto?.randomUUID?.() || `${now.getTime()}-${Math.random().toString(16).slice(2)}`,
    at: now.toISOString(),
    area: safeLabel(event.area || "extension"),
    stage: safeLabel(event.stage || "unknown"),
    outcome: safeLabel(event.outcome || "info"),
  };
  for (const key of SAFE_DETAIL_KEYS) {
    const value = event[key];
    if (value == null || value === "") continue;
    if (typeof value === "number" && Number.isFinite(value)) record[key] = value;
    else if (typeof value === "boolean") record[key] = value;
    else record[key] = safeLabel(value);
  }
  if (!record.code && event.message) record.code = classifyDiagnosticError(event.message, event.httpStatus);
  return record;
}

export async function appendDiagnostic(event, { chromeApi = globalThis.chrome } = {}) {
  if (!chromeApi?.storage?.local) return null;
  try {
    const saved = await chromeApi.storage.local.get(DIAGNOSTIC_STORAGE_KEY);
    const current = Array.isArray(saved[DIAGNOSTIC_STORAGE_KEY]) ? saved[DIAGNOSTIC_STORAGE_KEY] : [];
    const record = normalizeDiagnosticEvent(event);
    await chromeApi.storage.local.set({ [DIAGNOSTIC_STORAGE_KEY]: [...current, record].slice(-MAX_DIAGNOSTICS) });
    return record;
  } catch {
    return null;
  }
}

export async function readDiagnostics({ chromeApi = globalThis.chrome } = {}) {
  if (!chromeApi?.storage?.local) return [];
  const saved = await chromeApi.storage.local.get(DIAGNOSTIC_STORAGE_KEY);
  return Array.isArray(saved[DIAGNOSTIC_STORAGE_KEY]) ? saved[DIAGNOSTIC_STORAGE_KEY] : [];
}

export async function clearDiagnostics({ chromeApi = globalThis.chrome } = {}) {
  if (chromeApi?.storage?.local) await chromeApi.storage.local.remove(DIAGNOSTIC_STORAGE_KEY);
}

export function formatDiagnostic(record = {}) {
  const details = [
    record.provider,
    record.code,
    record.httpStatus ? `HTTP ${record.httpStatus}` : "",
    record.tabContext,
    record.profileKind,
    Number.isFinite(record.candidateCount) ? `${record.candidateCount} candidates` : "",
    record.memberIdResolved === true ? "member ID resolved" : "",
  ].filter(Boolean);
  return `${record.at || "unknown time"} | ${record.area || "extension"} | ${record.stage || "unknown"} | ${record.outcome || "info"}${details.length ? ` | ${details.join(" | ")}` : ""}`;
}
