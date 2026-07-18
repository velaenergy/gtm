import { responseOutputText } from "./openai-writer.mjs";

const SEARCH_ITEM_SCHEMA = {
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
        job_title: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 8 },
        seniority: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 5 },
        skills: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 8 },
        location: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 5 },
        industry: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 5 },
        company: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 1 },
        keyword: { type: "string", maxLength: 250 },
      },
      required: ["job_title", "seniority", "skills", "location", "industry", "company", "keyword"],
    },
  },
  required: ["label", "query", "rationale", "facets", "filters"],
};

const SEARCH_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    strategy: { type: "string" },
    searches: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: SEARCH_ITEM_SCHEMA,
    },
  },
  required: ["strategy", "searches"],
};

const RESEARCH_AGENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["chat", "plan", "execute"] },
    reply: { type: "string" },
    strategy: { type: "string" },
    searches: { type: "array", minItems: 0, maxItems: 1, items: SEARCH_ITEM_SCHEMA },
  },
  required: ["mode", "reply", "strategy", "searches"],
};

function recentConversation(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => ["user", "assistant"].includes(item?.role) && String(item?.content || "").trim())
    .slice(-12)
    .map((item) => ({ role: item.role, content: String(item.content).trim().slice(0, 1_500) }));
}

export function buildResearchAgentRequest(message, { history = [], pendingPlan = null, model = "gpt-5.4-mini" } = {}) {
  const hasPendingPlan = Boolean(pendingPlan && Array.isArray(pendingPlan.searches) && pendingPlan.searches.length);
  const pendingContext = hasPendingPlan ? JSON.stringify(pendingPlan).slice(0, 6_000) : "none";
  return {
    model,
    store: false,
    instructions: `You are Vela Energy's helpful GTM assistant inside a Research conversation. Behave like a normal concise chatbot unless the user clearly asks to find, source, identify, or research an audience of people or prospects.

Choose exactly one mode:
- chat: greetings, thanks, general questions, product questions, explanations, brainstorming, ambiguous requests, and work that is not prospect discovery. Answer directly. searches must be empty.
- plan: an explicit request to discover a prospect audience, or a clear refinement of the pending audience plan. Produce exactly one Apollo People API search. Do not claim it ran.
- execute: only when the user explicitly confirms that the pending plan should run, such as "run it", "go ahead", or "start the research". searches must be empty. Never choose execute when no pending plan exists.

For a plan, preserve the requested audience in one filter set so Apollo can return one authoritative total_entries count and up to 100 people. The company filter accepts at most one exact employer name explicitly stated by the user or prior conversation; put audience categories such as AI infrastructure or colocation in industry or keyword instead. job_title contains only concrete current-role function phrases; never put standalone seniority or topical keywords such as vp, director, power, data center, or infrastructure there. Avoid generic one-word job titles. Only include locations explicitly stated by the user or prior conversation. Seniority accepts only: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern. Use only those values. Never turn ordinary conversation into a research plan.

Pending plan available: ${hasPendingPlan ? "yes" : "no"}
Pending plan: ${pendingContext}`,
    input: [...recentConversation(history), { role: "user", content: String(message || "").trim() }],
    max_output_tokens: 1_100,
    text: { format: { type: "json_schema", name: "vela_research_agent_turn", strict: true, schema: RESEARCH_AGENT_SCHEMA } },
  };
}

export async function respondToResearchMessage(message, { apiKey, model = "gpt-5.4-mini", history = [], pendingPlan = null, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured on the Vela GTM server.");
  if (!String(message || "").trim()) throw new Error("A message is required.");
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildResearchAgentRequest(message, { history, pendingPlan, model })),
  });
  if (!response.ok) throw new Error(`OpenAI research assistant failed (${response.status}).`);
  const output = responseOutputText(await response.json());
  if (!output) throw new Error("OpenAI returned no research assistant response.");
  const result = JSON.parse(output);
  const reply = String(result.reply || "").trim();
  if (!reply || !["chat", "plan", "execute"].includes(result.mode)) throw new Error("OpenAI returned an incomplete research assistant response.");
  if (result.mode === "plan") {
    if (!result.strategy || !Array.isArray(result.searches) || result.searches.length !== 1) throw new Error("OpenAI returned an incomplete research plan.");
    return { mode: "plan", reply, plan: { strategy: result.strategy, searches: result.searches } };
  }
  if (result.mode === "execute" && !(pendingPlan && Array.isArray(pendingPlan.searches) && pendingPlan.searches.length)) {
    return { mode: "chat", reply: "There isn’t a research plan ready to run yet. Tell me who you want to find, and I’ll help shape one first.", plan: null };
  }
  return { mode: result.mode, reply, plan: null };
}

export function buildSearchPlanRequest(brief, model = "gpt-5.4-mini") {
  return {
    model,
    store: false,
    instructions: `Convert the prospecting brief into one Apollo People API Search. Preserve the user's audience in a single set of filters so Apollo can return one authoritative total_entries count and up to 100 people. Prioritize direct operating responsibility and enough specificity to avoid generic results. The company filter accepts at most one exact employer name explicitly stated by the user; put audience categories such as AI infrastructure or colocation in industry or keyword instead. job_title contains only concrete current-role function phrases; never put standalone seniority or topical keywords such as vp, director, power, data center, or infrastructure there. Avoid generic one-word job titles. Only include locations explicitly stated by the user; otherwise use an empty array. Seniority accepts only these exact Apollo values: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern. Use only values from that list.`,
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
