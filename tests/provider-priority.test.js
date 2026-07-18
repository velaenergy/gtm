import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDER,
  configuredEnrichmentProviders,
  enrichmentProvidersForAttempt,
  configuredManualEnrichmentProviders,
  configuredSearchProviders,
  preferredProvider,
  preferredSearchProvider,
  providerLabel,
} from "../lib/provider-priority.js";

test("prefers Apollo when both enrichment providers are configured", () => {
  assert.deepEqual(
    configuredEnrichmentProviders({ contactOutApiKey: "contactout", apolloApiKey: "apollo" }),
    [PROVIDER.APOLLO, PROVIDER.CONTACTOUT],
  );
  assert.equal(preferredProvider({ contactOutApiKey: "contactout", apolloApiKey: "apollo" }), PROVIDER.APOLLO);
});

test("uses Apollo first and never uses ContactOut for people discovery", () => {
  const settings = { contactOutSessionEnabled: true, contactOutApiKey: "contactout", apolloApiKey: "apollo" };
  assert.deepEqual(configuredEnrichmentProviders(settings), [PROVIDER.APOLLO, PROVIDER.CONTACTOUT_SESSION, PROVIDER.CONTACTOUT]);
  assert.equal(preferredProvider(settings), PROVIDER.APOLLO);
  assert.deepEqual(configuredSearchProviders({ contactOutSessionEnabled: true }), []);
  assert.equal(preferredSearchProvider(settings), PROVIDER.APOLLO);
});

test("falls back to Apollo when ContactOut is not configured", () => {
  assert.deepEqual(configuredEnrichmentProviders({ apolloApiKey: "apollo" }), [PROVIDER.APOLLO]);
  assert.equal(providerLabel(PROVIDER.APOLLO), "Apollo");
});

test("[V55] manual LinkedIn lookup tries ContactOut before Apollo", () => {
  const settings = { contactOutSessionEnabled: true, contactOutApiKey: "contactout", apolloApiKey: "apollo" };
  assert.deepEqual(configuredManualEnrichmentProviders(settings), [
    PROVIDER.CONTACTOUT_SESSION,
    PROVIDER.CONTACTOUT,
    PROVIDER.APOLLO,
  ]);
  assert.deepEqual(configuredManualEnrichmentProviders({ apolloApiKey: "apollo" }), [PROVIDER.APOLLO]);
});

test("[V67] declining ContactOut keeps Apollo-only drafting available", () => {
  const settings = { contactOutSessionEnabled: true, contactOutApiKey: "contactout", apolloApiKey: "apollo" };
  assert.deepEqual(enrichmentProvidersForAttempt(settings, { contactOutDefault: false }), [PROVIDER.APOLLO]);
  assert.deepEqual(enrichmentProvidersForAttempt(settings, { contactOutDefault: false, hasInitialApolloResult: true }), []);
  assert.deepEqual(enrichmentProvidersForAttempt(settings, { contactOutDefault: true, hasInitialApolloResult: true }), [
    PROVIDER.CONTACTOUT_SESSION,
    PROVIDER.CONTACTOUT,
  ]);
});
