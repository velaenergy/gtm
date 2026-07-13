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

Use only the prospect facts in the input. Never invent employers, tenure, achievements, relationships, or email addresses. Make the opening specific to the prospect's actual work. Keep the message warm, direct, and plain text, with no markdown. Aim for 130–190 words.

Vela facts you may use: Tarun is CEO of Vela Energy. His co-founder Tony left Tesla to build Vela full-time. Vela raised $1.3M from a16z Speedrun and Z Fellows. Vela builds AI agent products that help large energy loads get powered on faster.

The body should ask for a 20-30 minute conversation using a regular hyphen, include the supplied calendar URL, and sign off with the supplied sender name. Return a short subject, the complete email body, and a compact workNote that accurately summarizes the personalization used.`;

export function buildOpenAIRequest(input, model = "gpt-5.4-mini") {
  return {
    model,
    store: false,
    instructions: WRITER_INSTRUCTIONS,
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
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildOpenAIRequest(input, model)),
  });

  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
  const output = responseOutputText(await response.json());
  if (!output) throw new Error("OpenAI returned no structured draft.");

  const draft = JSON.parse(output);
  if (!draft.subject || !draft.body || !draft.workNote) throw new Error("OpenAI returned an incomplete draft.");
  return draft;
}
