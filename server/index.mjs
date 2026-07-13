import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { enrichLinkedInProfile } from "./contactout.mjs";
import { writeOutreach } from "./openai-writer.mjs";
import { planProspectSearch } from "./search-planner.mjs";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const allowedOrigin = process.env.VELA_GTM_ALLOWED_ORIGIN || "*";
const runtimeSecrets = { contactOutApiKey: "", openAIApiKey: "" };

function contactOutApiKey() {
  return process.env.CONTACTOUT_API_KEY || runtimeSecrets.contactOutApiKey;
}

function openAIApiKey() {
  return process.env.OPENAI_API_KEY || runtimeSecrets.openAIApiKey;
}

function headers(contentType = "application/json; charset=utf-8") {
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, headers());
  response.end(JSON.stringify(payload));
}

function authorized(request) {
  const expected = process.env.VELA_GTM_SERVER_TOKEN;
  if (!expected) return true;
  const actual = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers());
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      model,
      openAIConfigured: Boolean(openAIApiKey()),
      contactOutConfigured: Boolean(contactOutApiKey()),
    });
    return;
  }

  if (request.method !== "POST" || !["/generate", "/enrich", "/plan-search", "/configure"].includes(request.url)) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  if (!authorized(request)) {
    sendJson(response, 401, { error: "Invalid writer server token." });
    return;
  }

  try {
    const input = await readJson(request);
    if (request.url === "/configure") {
      const contactOut = String(input.contactOutApiKey || "").trim();
      const openAI = String(input.openAIApiKey || "").trim();
      if (!contactOut && !openAI) {
        sendJson(response, 400, { error: "Enter at least one API key." });
        return;
      }
      if (contactOut) runtimeSecrets.contactOutApiKey = contactOut;
      if (openAI) runtimeSecrets.openAIApiKey = openAI;
      sendJson(response, 200, {
        ok: true,
        contactOutConfigured: Boolean(contactOutApiKey()),
        openAIConfigured: Boolean(openAIApiKey()),
        persistence: "process-memory",
      });
      return;
    }
    if (request.url === "/plan-search") {
      const plan = await planProspectSearch(input.brief, { apiKey: openAIApiKey(), model });
      sendJson(response, 200, { data: plan, model });
      return;
    }
    if (input.source !== "vela-gtm-extension" || !input.profile?.url) {
      sendJson(response, 400, { error: "A Vela GTM profile payload is required." });
      return;
    }
    if (request.url === "/enrich") {
      const result = await enrichLinkedInProfile(input.profile, { apiKey: contactOutApiKey() });
      sendJson(response, 200, {
        email: result.email,
        emails: result.emails,
        phones: result.phones,
        emailStatus: result.emailStatus,
        emailSource: result.email ? `ContactOut ${result.emailType} email` : "ContactOut",
        note: result.note,
        profile: result.profile,
      });
      return;
    }
    if (!input.profile.name) {
      sendJson(response, 400, { error: "A profile name is required for outreach generation." });
      return;
    }
    const draft = await writeOutreach(input, { apiKey: openAIApiKey(), model });
    sendJson(response, 200, { data: draft, model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate outreach.";
    const status = /not configured/i.test(message) ? 503
      : /API key/i.test(message) ? 401
        : /rate limit/i.test(message) ? 429
          : /JSON|too large|required/i.test(message) ? 400 : 502;
    sendJson(response, status, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`Vela GTM writer listening on http://${host}:${port} with ${model}.`);
});
