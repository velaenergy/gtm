import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDER,
  configuredEnrichmentProviders,
  configuredSearchProviders,
  preferredProvider,
  preferredSearchProvider,
  providerLabel,
} from "../lib/provider-priority.js";

test("prefers ContactOut when both enrichment providers are configured", () => {
  assert.deepEqual(
    configuredEnrichmentProviders({ contactOutApiKey: "contactout", apolloApiKey: "apollo" }),
    [PROVIDER.CONTACTOUT, PROVIDER.APOLLO],
  );
  assert.equal(preferredProvider({ contactOutApiKey: "contactout", apolloApiKey: "apollo" }), PROVIDER.CONTACTOUT);
});

test("uses the browser session first for enrichment but not undocumented People Search", () => {
  const settings = { contactOutSessionEnabled: true, contactOutApiKey: "contactout", apolloApiKey: "apollo" };
  assert.deepEqual(configuredEnrichmentProviders(settings), [PROVIDER.CONTACTOUT_SESSION, PROVIDER.CONTACTOUT, PROVIDER.APOLLO]);
  assert.equal(preferredProvider(settings), PROVIDER.CONTACTOUT_SESSION);
  assert.deepEqual(configuredSearchProviders({ contactOutSessionEnabled: true }), []);
  assert.equal(preferredSearchProvider(settings), PROVIDER.CONTACTOUT);
});

test("falls back to Apollo when ContactOut is not configured", () => {
  assert.deepEqual(configuredEnrichmentProviders({ apolloApiKey: "apollo" }), [PROVIDER.APOLLO]);
  assert.equal(providerLabel(PROVIDER.APOLLO), "Apollo");
});
