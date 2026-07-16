export const RUNTIME_PROTOCOL_VERSION = 1;
export const RUNTIME_CAPABILITIES_MESSAGE = "VELA_GTM_RUNTIME_CAPABILITIES";

export const PROVIDER_ACTION = Object.freeze({
  CONTACTOUT: "VELA_GTM_PROVIDER_CONTACTOUT",
  CONTACTOUT_STATUS: "VELA_GTM_PROVIDER_CONTACTOUT_STATUS",
  CONTACTOUT_SESSION: "VELA_GTM_PROVIDER_CONTACTOUT_SESSION",
  CONTACTOUT_SESSION_REVEAL: "VELA_GTM_PROVIDER_CONTACTOUT_SESSION_REVEAL",
  APOLLO: "VELA_GTM_PROVIDER_APOLLO",
  APOLLO_STATUS: "VELA_GTM_PROVIDER_APOLLO_STATUS",
  WRITE: "VELA_GTM_PROVIDER_WRITE",
  PLAN_SEARCH: "VELA_GTM_PROVIDER_PLAN_SEARCH",
  RESEARCH_MESSAGE: "VELA_GTM_PROVIDER_RESEARCH_MESSAGE",
  VERIFY_TARGET: "VELA_GTM_PROVIDER_VERIFY_TARGET",
  PEOPLE_SEARCH: "VELA_GTM_PROVIDER_PEOPLE_SEARCH",
});

export const RUNTIME_RELOAD_MESSAGE = "Vela’s Research page is newer than its background service. Reload Vela GTM in chrome://extensions, then reopen Workspace.";

export function runtimeCapabilities(extensionVersion = "") {
  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    extensionVersion: String(extensionVersion || ""),
    providerActions: Object.values(PROVIDER_ACTION),
  };
}

export function runtimeMismatchMessage(message = "") {
  const detail = String(message || "").trim();
  return /unknown vela provider action/i.test(detail) ? RUNTIME_RELOAD_MESSAGE : detail;
}
