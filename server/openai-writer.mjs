import { normalizeWorkNote, openerQualityIssues } from "../lib/ai-writer.js";

const WRITER_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    workNote: { type: "string" },
  },
  required: ["subject", "body", "workNote"],
  additionalProperties: false,
};

const WRITER_INSTRUCTIONS = `You write only the workNote personalization slot for a fixed Vela Energy email template.

Use only the prospect facts in the input. Never invent employers, tenure, achievements, relationships, projects, or email addresses. Read the prospect's About section and each role description, not just titles and company names. Prefer the strongest one or two concrete facts from their About copy, current role description, prior role descriptions, company, industry, or skills. Do not merely restate their headline or produce a keyword list.

The email template is immutable. Return the currentDraft subject and body verbatim. Never rewrite, polish, shorten, extend, or reorder the subject or body. Do not write a greeting, founder introduction, Vela description, meeting ask, calendar link, or sign-off. The application, not the model, inserts workNote into the selected template.

Write workNote as one specific noun phrase, usually 12-35 words, that fits grammatically after "Came across your profile and was really impressed by". A good shape is: "your engineering work at Wells Fargo and experience teaching and mentoring software engineers". Do not add "I", a greeting, a question, a second sentence, or a clause such as ", which suggests..." or ", demonstrating...". Return the phrase with an initial capital and terminal punctuation; the application converts it to workNoteInline for insertion.

Treat personalizationNote as an editable hint, not a fact. Replace it when it is generic, awkward, or unsupported. The profile fields and Apollo- or ContactOut-enriched work context are the grounding source.

Do not default to praise. Do not put "I was impressed by", "your background is impressive", "caught my eye", "stood out to me", or "I came across your profile" inside workNote because the fixed template already supplies that language. Avoid AI-sounding language such as "at the intersection of", "your journey", "deep expertise", "track record", "fascinating", and "incredible". Do not claim to have followed their work. When context is thin, be honest and specific: name their current responsibility instead of inventing admiration. The phrase must start with a capital letter and end with punctuation.`;

const GENERATION_MODE_INSTRUCTIONS = `Regardless of generationMode, write only workNote. Return currentDraft.subject and currentDraft.body verbatim in the required subject and body fields.`;

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
    if (!draft.subject || !draft.body || !draft.workNote) throw new Error("OpenAI returned an incomplete draft.");
    const normalized = {
      subject: String(input.currentDraft?.subject || ""),
      body: String(input.currentDraft?.body || ""),
      workNote: normalizeWorkNote(draft.workNote),
    };
    qualityFeedback = openerQualityIssues(normalized.workNote);
    if (!qualityFeedback.length) return normalized;
  }
  throw new Error(`OpenAI could not produce a specific, natural opener. ${qualityFeedback.join(" ")}`);
}
