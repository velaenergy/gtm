import { contactOutAccountStatus, enrichViaContactOut, peopleSearch } from "./lib/contactout.js";
import { writeOutreach } from "./server/openai-writer.mjs";
import { planProspectSearch } from "./server/search-planner.mjs";

async function settings() {
  const stored = await chrome.storage.local.get("velaGtmSettings");
  return stored.velaGtmSettings || {};
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type?.startsWith("VELA_GTM_PROVIDER_")) return false;
  (async () => {
    const configured = await settings();
    if (message.type === "VELA_GTM_PROVIDER_CONTACTOUT") {
      return enrichViaContactOut(message.profile, { apiKey: configured.contactOutApiKey, includePhone: configured.includeContactOutPhone });
    }
    if (message.type === "VELA_GTM_PROVIDER_CONTACTOUT_STATUS") {
      return contactOutAccountStatus({ apiKey: configured.contactOutApiKey });
    }
    if (message.type === "VELA_GTM_PROVIDER_WRITE") {
      return writeOutreach(message.input, { apiKey: configured.openAIApiKey, model: configured.openAIModel || "gpt-5.4-mini" });
    }
    if (message.type === "VELA_GTM_PROVIDER_PLAN_SEARCH") {
      return planProspectSearch(message.brief, { apiKey: configured.openAIApiKey, model: configured.openAIModel || "gpt-5.4-mini" });
    }
    if (message.type === "VELA_GTM_PROVIDER_PEOPLE_SEARCH") {
      return peopleSearch(message.filters, { apiKey: configured.contactOutApiKey });
    }
    throw new Error("Unknown Vela provider action.");
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Provider request failed." }));
  return true;
});
