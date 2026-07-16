import { peopleSearchViaApollo } from "./apollo.js";
import { PROVIDER } from "./provider-priority.js";

export async function searchPeopleWithProviders(filters = {}, settings = {}, implementations = {}) {
  if (!settings.apolloApiKey) throw new Error("Connect Apollo in Settings before discovering people.");
  const apolloSearch = implementations.apolloSearch || peopleSearchViaApollo;
  try {
    const result = await apolloSearch(filters, { apiKey: settings.apolloApiKey });
    const prospects = Array.isArray(result?.prospects)
      ? result.prospects.map((prospect) => ({ ...prospect, source: prospect.source || "Apollo People Search" }))
      : [];
    return { ...result, prospects, provider: PROVIDER.APOLLO, providerLabel: "Apollo", attempts: [{ provider: PROVIDER.APOLLO, ok: true, count: prospects.length }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apollo People Search failed.";
    throw new Error(`Apollo: ${message}`);
  }
}
