import { responseOutputText } from "./openai-writer.mjs";

const SEARCH_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    strategy: { type: "string" },
    searches: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          query: { type: "string" },
          rationale: { type: "string" },
          facets: { type: "array", items: { type: "string" }, maxItems: 5 },
          filters: {
            type: "object",
            additionalProperties: false,
            properties: {
              job_title: { type: "array", items: { type: "string" }, maxItems: 8 },
              seniority: { type: "array", items: { type: "string" }, maxItems: 5 },
              skills: { type: "array", items: { type: "string" }, maxItems: 8 },
              location: { type: "array", items: { type: "string" }, maxItems: 5 },
              industry: { type: "array", items: { type: "string" }, maxItems: 5 },
              company: { type: "array", items: { type: "string" }, maxItems: 8 },
              keyword: { type: "string" },
            },
            required: ["job_title", "seniority", "skills", "location", "industry", "company", "keyword"],
          },
        },
        required: ["label", "query", "rationale", "facets", "filters"],
      },
    },
  },
  required: ["strategy", "searches"],
};

export function buildSearchPlanRequest(brief, model = "gpt-5.4-mini") {
  return {
    model,
    store: false,
    instructions: `You are Vela Energy's GTM research agent. Convert a prospecting brief into 2-4 focused people-search strategies. Prioritize direct operating responsibility, relevant infrastructure or energy exposure, and enough specificity to avoid generic results. Each strategy needs a concise LinkedIn keyword query and ContactOut People Search filters. Only include companies or locations explicitly stated by the user; otherwise use empty arrays. Seniority accepts only these exact values: Owner / Founder, CXO, Partner, VP, Head, Director, Manager, Senior, Entry, Intern. Use only values from that list. Explain the strategy in plain language.`,
    input: String(brief || "").trim(),
    max_output_tokens: 900,
    text: { format: { type: "json_schema", name: "vela_search_plan", strict: true, schema: SEARCH_PLAN_SCHEMA } },
  };
}

export async function planProspectSearch(brief, { apiKey, model = "gpt-5.4-mini", fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured on the Vela GTM server.");
  if (String(brief || "").trim().length < 8) throw new Error("A more specific prospecting brief is required.");
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildSearchPlanRequest(brief, model)),
  });
  if (!response.ok) throw new Error(`OpenAI search planning failed (${response.status}).`);
  const output = responseOutputText(await response.json());
  if (!output) throw new Error("OpenAI returned no search plan.");
  const plan = JSON.parse(output);
  if (!plan.strategy || !Array.isArray(plan.searches) || !plan.searches.length) throw new Error("OpenAI returned an incomplete search plan.");
  return plan;
}
