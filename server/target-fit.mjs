import { responseOutputText } from "./openai-writer.mjs";
import { calibrateTargetFit } from "../lib/target-fit.js";

const TARGET_FIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["strong", "review", "skip"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string" },
    evidence: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
  },
  required: ["verdict", "score", "reason", "evidence"],
};

export function buildTargetFitOpenAIRequest(input, model = "gpt-5.4-mini") {
  return {
    model,
    store: false,
    instructions: `You are Vela Energy's prospect qualification reviewer. Decide once whether the supplied person is a credible target for the supplied Vela context. Use only supplied profile facts. Strong means direct operating or decision influence over power, utilities, interconnection, energy procurement, site selection, critical facilities, infrastructure development, or energy-intensive operations. An explicit current leadership title naming one of those decision areas is direct evidence; do not require a job description to restate the title. Review means plausible adjacency but insufficient direct evidence, including generic procurement or sourcing without an energy/power/utility signal. Skip means no credible connection. Return a concise reason and 1-3 exact profile facts as evidence. Never infer responsibilities from prestige alone.`,
    input: JSON.stringify(input),
    max_output_tokens: 500,
    text: { format: { type: "json_schema", name: "vela_target_fit", strict: true, schema: TARGET_FIT_SCHEMA } },
  };
}

export async function verifyTargetFit(input, { apiKey, model = "gpt-5.4-mini", fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for target verification.");
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildTargetFitOpenAIRequest(input, model)),
  });
  if (!response.ok) throw new Error(`OpenAI target verification failed (${response.status}).`);
  const output = responseOutputText(await response.json());
  if (!output) throw new Error("OpenAI returned no target verification.");
  return calibrateTargetFit(JSON.parse(output), input);
}
