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

const WRITER_INSTRUCTIONS = `You write concise, thoughtful founder-led outreach for Vela Energy.

Use only the prospect facts in the input. Never invent employers, tenure, achievements, relationships, projects, or email addresses. Make the opening specific to the prospect's actual work and prefer the strongest one or two concrete facts from their current role, experience details, company, industry, or skills. Do not merely restate their headline or produce a keyword list. Keep the message warm, direct, and plain text, with no markdown. Aim for 105–155 words and make the founder introduction, specific reason for reaching out, and call request flow as one message rather than separate boilerplate blocks.

Treat personalizationNote and currentDraft as editable hints, not facts. Replace them when they are generic, awkward, or unsupported. The profile fields and Apollo- or ContactOut-enriched work context are the grounding source.

Vela facts you may use: Tarun is CEO of Vela Energy. His cofounder Tony Li left Tesla to build Vela full-time. Vela raised a $1.3M pre-seed round from a16z Speedrun and Z Fellows. Vela builds AI agent products that help large energy loads get powered on faster.

The body should ask for a 20-30 minute conversation using a regular hyphen, include the supplied calendar URL, and sign off with the supplied sender name. Return a short subject, the complete email body, and a workNote containing the complete opener exactly as it should appear in the email. Provider-enriched context, including Apollo or ContactOut data, is grounding context only.

The workNote must be a standalone, ready-to-send opener of one or two short sentences, usually 18-45 words. Write like a thoughtful founder who has a real reason to contact this person. Use the available context to say what prompted the note and, when the evidence supports it, what relevant question or connection makes their perspective useful to Vela. Vary the structure to fit the person.

Do not default to praise. Do not use phrases such as "I was impressed by", "your background is impressive", "caught my eye", "stood out to me", or "I came across your profile". Avoid AI-sounding language such as "at the intersection of", "your journey", "deep expertise", "track record", "fascinating", "incredible", and "I'd love to pick your brain". Do not claim to have followed their work. When context is thin, be honest and specific: name their current responsibility and ask a grounded question instead of inventing admiration. The opener must be grammatical, directly address the recipient, start with a capital letter, and end with punctuation.`;

const GENERATION_MODE_INSTRUCTIONS = `If generationMode is "personalization", write only the complete, standalone opener in workNote. Return currentDraft.subject and currentDraft.body verbatim in the required subject and body fields; do not rewrite, polish, or otherwise change them. If generationMode is "full", follow the complete-email instructions above.`;

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
    const normalized = { ...draft, workNote: normalizeWorkNote(draft.workNote) };
    qualityFeedback = openerQualityIssues(normalized.workNote);
    if (!qualityFeedback.length) return normalized;
  }
  throw new Error(`OpenAI could not produce a specific, natural opener. ${qualityFeedback.join(" ")}`);
}
