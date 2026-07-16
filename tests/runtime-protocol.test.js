import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDER_ACTION,
  RUNTIME_CAPABILITIES_MESSAGE,
  RUNTIME_PROTOCOL_VERSION,
  runtimeCapabilities,
  runtimeMismatchMessage,
} from "../lib/runtime-protocol.js";

test("V37 exposes the conversational research action through the runtime protocol", () => {
  assert.equal(PROVIDER_ACTION.RESEARCH_MESSAGE, "VELA_GTM_PROVIDER_RESEARCH_MESSAGE");
  assert.equal(RUNTIME_CAPABILITIES_MESSAGE, "VELA_GTM_RUNTIME_CAPABILITIES");
  assert.equal(RUNTIME_PROTOCOL_VERSION, 1);
  assert.deepEqual(runtimeCapabilities("0.8.2"), {
    protocolVersion: 1,
    extensionVersion: "0.8.2",
    providerActions: Object.values(PROVIDER_ACTION),
  });
});

test("V37 replaces an unknown provider action with an actionable runtime mismatch", () => {
  assert.equal(
    runtimeMismatchMessage("Unknown Vela provider action."),
    "Vela’s Research page is newer than its background service. Reload Vela GTM in chrome://extensions, then reopen Workspace.",
  );
  assert.equal(runtimeMismatchMessage("OpenAI research assistant failed (429)."), "OpenAI research assistant failed (429).");
});
