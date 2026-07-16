export const PROVIDER = Object.freeze({
  CONTACTOUT_SESSION: "CONTACTOUT_SESSION",
  CONTACTOUT: "CONTACTOUT",
  APOLLO: "APOLLO",
});

export function configuredEnrichmentProviders(settings = {}) {
  return [
    settings.apolloApiKey ? PROVIDER.APOLLO : "",
    settings.contactOutSessionEnabled ? PROVIDER.CONTACTOUT_SESSION : "",
    settings.contactOutApiKey ? PROVIDER.CONTACTOUT : "",
  ].filter(Boolean);
}

export function configuredSearchProviders(settings = {}) {
  return settings.apolloApiKey ? [PROVIDER.APOLLO] : [];
}

export function providerLabel(provider = "") {
  if (provider === PROVIDER.CONTACTOUT_SESSION) return "ContactOut session";
  if (provider === PROVIDER.CONTACTOUT) return "ContactOut";
  if (provider === PROVIDER.APOLLO) return "Apollo";
  return "Provider";
}

export function preferredProvider(settings = {}) {
  return configuredEnrichmentProviders(settings)[0] || "";
}

export function preferredSearchProvider(settings = {}) {
  return configuredSearchProviders(settings)[0] || "";
}
