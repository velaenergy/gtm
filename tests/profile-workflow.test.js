import assert from "node:assert/strict";
import test from "node:test";

import { aiDraftDeliveryReady, runAutomaticProfileWorkflow } from "../lib/profile-workflow.js";

test("V19 always starts AI writing when a profile opens even when contact research is off", async () => {
  const calls = [];
  await runAutomaticProfileWorkflow({
    researchEnabled: false,
    research: async () => calls.push("research"),
    write: async () => calls.push("write"),
  });
  assert.deepEqual(calls, ["write"]);
});

test("V25 writes the complete email after automatic research adds its context", async () => {
  const calls = [];
  await runAutomaticProfileWorkflow({
    researchEnabled: true,
    hasVerifiedEmail: false,
    research: async () => {
      calls.push("research-start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      calls.push("research-end");
    },
    write: async () => calls.push("write"),
  });
  assert.deepEqual(calls, ["research-start", "research-end", "write"]);
});

test("V19 still writes when automatic contact research throws", async () => {
  const calls = [];
  await runAutomaticProfileWorkflow({
    researchEnabled: true,
    research: async () => {
      calls.push("research");
      throw new Error("provider unavailable");
    },
    write: async () => calls.push("write"),
  });
  assert.deepEqual(new Set(calls), new Set(["research", "write"]));
});

test("V19 skips redundant contact research but still writes when an email is already verified", async () => {
  const calls = [];
  await runAutomaticProfileWorkflow({
    researchEnabled: true,
    hasVerifiedEmail: true,
    research: async () => calls.push("research"),
    write: async () => calls.push("write"),
  });
  assert.deepEqual(calls, ["write"]);
});

test("V25 delivery remains closed until the full AI draft succeeds", () => {
  assert.equal(aiDraftDeliveryReady({ writerLoading: true, aiDraftReady: true, subject: "Ready", body: "Body" }), false);
  assert.equal(aiDraftDeliveryReady({ writerLoading: false, aiDraftReady: false, subject: "Template", body: "Fallback" }), false);
  assert.equal(aiDraftDeliveryReady({ writerLoading: false, aiDraftReady: true, subject: "", body: "AI body" }), false);
  assert.equal(aiDraftDeliveryReady({ writerLoading: false, aiDraftReady: true, subject: "AI subject", body: "AI body" }), true);
});

test("V25 loading workflow does not resolve before AI writing completes", async () => {
  let releaseWriting;
  let resolved = false;
  const workflow = runAutomaticProfileWorkflow({
    write: () => new Promise((resolve) => { releaseWriting = resolve; }),
  }).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  releaseWriting(true);
  await workflow;
  assert.equal(resolved, true);
});
