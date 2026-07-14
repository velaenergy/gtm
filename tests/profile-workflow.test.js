import assert from "node:assert/strict";
import test from "node:test";

import { runAutomaticProfileWorkflow } from "../lib/profile-workflow.js";

test("V19 always starts AI writing when a profile opens even when contact research is off", async () => {
  const calls = [];
  await runAutomaticProfileWorkflow({
    researchEnabled: false,
    research: async () => calls.push("research"),
    write: async () => calls.push("write"),
  });
  assert.deepEqual(calls, ["write"]);
});

test("V19 writes after automatic contact research finishes without an email", async () => {
  const calls = [];
  await runAutomaticProfileWorkflow({
    researchEnabled: true,
    hasVerifiedEmail: false,
    research: async () => calls.push("research"),
    write: async () => calls.push("write"),
  });
  assert.deepEqual(calls, ["research", "write"]);
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
  assert.deepEqual(calls, ["research", "write"]);
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
