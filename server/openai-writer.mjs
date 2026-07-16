import { fullDraftQualityIssues, normalizeWorkNote } from "../lib/ai-writer.js";
import { OUTREACH_SUBJECT } from "../lib/message.js";

const WRITER_SCHEMA = {
  type: "object",
  properties: {
    body: { type: "string" },
    workNote: { type: "string" },
  },
  required: ["body", "workNote"],
  additionalProperties: false,
};

const WRITER_INSTRUCTIONS = `You write a complete, natural first-touch outreach email for Vela Energy.

Use only the prospect facts in the input. Never invent employers, tenure, achievements, relationships, projects, or email addresses. Read the prospect's About section and each role description, not just titles and company names. Prefer the strongest one or two concrete facts from their About copy, current role description, prior role descriptions, company, industry, or skills. Do not merely restate their headline or produce a keyword list.

Treat template.bodyBlueprint and currentDraft as a writing guide and source of approved sender facts, not immutable copy. Preserve the guide's purpose, the sender's identity, the exact calendar URL, and factual Vela claims, but rewrite the complete email body for this prospect. Vary the transitions, wording, paragraph count, and placement of the personalized detail. Do not reuse the same paragraph skeleton simply because the guide supplies one. The application uses the fixed subject "Quick intro + would love to pick your brain" for every first-touch email, so do not write or suggest a subject.

Write the body as plain text with 3-7 short, natural paragraph blocks chosen for this message. Separate paragraphs with one blank line. Do not hard-wrap lines inside a paragraph. Include a greeting, a grounded reason for reaching out, enough Vela context to make the ask credible, one clear 20-30 minute ask, the exact calendar URL when supplied, and a sign-off using the configured sender name. Aim for 90-170 words, but prefer natural writing over filling a fixed format.

Write workNote as a short internal summary of the strongest prospect-specific fact used in the email. It is not required to fit any fixed sentence slot.

Treat personalizationNote as an editable hint, not a fact. Replace it when it is generic, awkward, or unsupported. The profile fields and Apollo- or ContactOut-enriched work context are the grounding source.

Do not default to praise. Avoid "I was impressed by", "your background is impressive", "caught my eye", "stood out to me", "I came across your profile", and AI-sounding language such as "at the intersection of", "your journey", "deep expertise", "track record", "fascinating", and "incredible". Do not claim to have followed their work. When context is thin, be honest and specific: name their current responsibility instead of inventing admiration.`;

const GENERATION_MODE_INSTRUCTIONS = `Regardless of generationMode, return a newly written complete body and grounded workNote in the required fields.`;

export function buildOpenAIRequest(input, model = "gpt-5.4-mini") {
  return {
    model,
    store: false,
    instructions: `${WRITER_INSTRUCTIONS}\n\n${GENERATION_MODE_INSTRUCTIONS}`,
    input: JSON.stringify(input),
    max_output_tokens: 1200,
    text: {
      format: {
        type: "json_schema",
        name: "vela_outreach",
        strict: true,
        schema: WRITER_SCHEMA,
      },
    },
  };
}

export function responseOutputText(payload = {}) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

export async function writeOutreach(input, { apiKey, model = "gpt-5.4-mini", fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured on the writer server.");
  let qualityFeedback = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestInput = qualityFeedback.length ? { ...input, openerQualityFeedback: qualityFeedback } : input;
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildOpenAIRequest(requestInput, model)),
    });

    if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
    const output = responseOutputText(await response.json());
    if (!output) throw new Error("OpenAI returned no structured draft.");

    const draft = JSON.parse(output);
    if (!draft.body || !draft.workNote) throw new Error("OpenAI returned an incomplete draft.");
    const normalized = {
      subject: OUTREACH_SUBJECT,
      body: String(draft.body || "").replace(/\r\n?/g, "\n").trim(),
      workNote: normalizeWorkNote(draft.workNote),
    };
    qualityFeedback = fullDraftQualityIssues(normalized, input);
    if (!qualityFeedback.length) return normalized;
  }
  throw new Error(`OpenAI could not produce a complete, natural email. ${qualityFeedback.join(" ")}`);
}
