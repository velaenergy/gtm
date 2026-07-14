import assert from "node:assert/strict";
import test from "node:test";
import { parseCredentialImport } from "../lib/settings-import.js";

test("imports supported provider credentials from an env file", () => {
  const imported = parseCredentialImport(`
export OPENAI_API_KEY="sk-openai"
APOLLO_API_KEY=apollo-value
CONTACTOUT_API_KEY='contactout-value'
UNRELATED_SECRET=ignore-me
`);
  assert.deepEqual(imported.values, {
    contactOutApiKey: "contactout-value",
    apolloApiKey: "apollo-value",
    openAIApiKey: "sk-openai",
  });
  assert.equal(imported.labels.length, 3);
});

test("imports credentials from a Vela settings JSON envelope", () => {
  const imported = parseCredentialImport(JSON.stringify({
    velaGtmSettings: {
      openAIApiKey: "json-openai",
      apolloApiKey: "json-apollo",
    },
  }));
  assert.deepEqual(imported.values, {
    apolloApiKey: "json-apollo",
    openAIApiKey: "json-openai",
  });
});

test("rejects imports without supported credential names", () => {
  assert.throws(() => parseCredentialImport("SOME_OTHER_KEY=value"), /No supported credentials/);
});
