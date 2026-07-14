import { peopleSearchViaApollo } from "./apollo.js";
import { peopleSearch as peopleSearchViaContactOut } from "./contactout.js";
import {
  PROVIDER,
  configuredSearchProviders,
  providerLabel,
} from "./provider-priority.js";

function providerSearch(provider, implementations) {
  return provider === PROVIDER.CONTACTOUT
    ? implementations.contactOutSearch
    : implementations.apolloSearch;
}

function providerApiKey(provider, settings = {}) {
  return provider === PROVIDER.CONTACTOUT ? settings.contactOutApiKey : settings.apolloApiKey;
}

export async function searchPeopleWithProviders(filters = {}, settings = {}, implementations = {}) {
  const providers = configuredSearchProviders(settings);
  if (!providers.length) throw new Error("Connect ContactOut or Apollo in Settings before searching providers.");

  const searches = {
    contactOutSearch: implementations.contactOutSearch || peopleSearchViaContactOut,
    apolloSearch: implementations.apolloSearch || peopleSearchViaApollo,
  };
  const attempts = [];

  for (const provider of providers) {
    const label = providerLabel(provider);
    try {
      const result = await providerSearch(provider, searches)(filters, { apiKey: providerApiKey(provider, settings) });
      const prospects = Array.isArray(result?.prospects)
        ? result.prospects.map((prospect) => ({ ...prospect, source: prospect.source || `${label} People Search` }))
        : [];
      attempts.push({ provider, ok: true, count: prospects.length });
      if (prospects.length) return { ...result, prospects, provider, providerLabel: label, attempts };
    } catch (error) {
      attempts.push({
        provider,
        ok: false,
        count: 0,
        error: error instanceof Error ? error.message : `${label} People Search failed.`,
      });
    }
  }

  if (attempts.some((attempt) => attempt.ok)) {
    return { total: 0, prospects: [], provider: "", providerLabel: "", attempts };
  }
  throw new Error(attempts.map((attempt) => `${providerLabel(attempt.provider)}: ${attempt.error}`).join(" "));
}
