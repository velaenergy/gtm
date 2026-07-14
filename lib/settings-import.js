const IMPORT_FIELDS = Object.freeze({
  contactOutApiKey: {
    label: "ContactOut API key",
    aliases: ["contactOutApiKey", "CONTACTOUT_API_KEY", "CONTACT_OUT_API_KEY", "CONTACTOUT_TOKEN", "VELA_CONTACTOUT_API_KEY"],
  },
  apolloApiKey: {
    label: "Apollo API key",
    aliases: ["apolloApiKey", "APOLLO_API_KEY", "VELA_APOLLO_API_KEY"],
  },
  openAIApiKey: {
    label: "OpenAI API key",
    aliases: ["openAIApiKey", "OPENAI_API_KEY", "VELA_OPENAI_API_KEY"],
  },
});

function stripOuterQuotes(value = "") {
  const trimmed = String(value).trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnv(text = "") {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:=|:)\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    values[match[1]] = stripOuterQuotes(match[2]);
  }
  return values;
}

function importSource(text = "") {
  const trimmed = String(text).trim();
  if (!trimmed) throw new Error("Paste configuration text or choose a .env or JSON file first.");
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return parseEnv(trimmed);
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("That JSON file could not be read. Check its formatting and try again.");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("The imported JSON must contain a settings object.");
  const nested = parsed.velaGtmSettings || parsed.settings || parsed.credentials || parsed;
  if (!nested || Array.isArray(nested) || typeof nested !== "object") throw new Error("The imported JSON does not contain a settings object.");
  return nested;
}

export function parseCredentialImport(text = "") {
  const source = importSource(text);
  const normalizedEntries = new Map(Object.entries(source).map(([key, value]) => [String(key).toLowerCase(), value]));
  const values = {};
  const labels = [];

  for (const [field, config] of Object.entries(IMPORT_FIELDS)) {
    const alias = config.aliases.find((candidate) => normalizedEntries.has(candidate.toLowerCase()));
    if (!alias) continue;
    const value = String(normalizedEntries.get(alias.toLowerCase()) ?? "").trim();
    if (!value) continue;
    values[field] = value;
    labels.push(config.label);
  }

  if (!labels.length) {
    throw new Error("No supported credentials were found. Use ContactOut, Apollo, or OpenAI fields.");
  }
  return { values, labels };
}
