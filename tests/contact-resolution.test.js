import assert from "node:assert/strict";
import test from "node:test";

import { resolveContactEmail } from "../lib/contact-resolution.js";

test("V11 falls back to LinkedIn when ContactOut returns no email", async () => {
  const calls = [];
  const result = await resolveContactEmail({
    contactOutLookup: async () => { calls.push("contactout"); return { email: "" }; },
    linkedInLookup: async () => { calls.push("linkedin"); return { ok: true, email: "profile@example.com", strategy: "rsc" }; },
  });
  assert.deepEqual(calls, ["contactout", "linkedin"]);
  assert.equal(result.email, "profile@example.com");
  assert.equal(result.source, "linkedin");
  assert.equal(result.strategy, "rsc");
});

test("V11 falls back to LinkedIn when ContactOut throws", async () => {
  const result = await resolveContactEmail({
    contactOutLookup: async () => { throw new Error("ContactOut rate limited"); },
    linkedInLookup: async () => ({ ok: true, email: "profile@example.com", strategy: "overlay" }),
  });
  assert.equal(result.email, "profile@example.com");
  assert.equal(result.source, "linkedin");
  assert.match(result.contactOutError, /rate limited/);
});

test("V11 does not call LinkedIn after ContactOut succeeds", async () => {
  let linkedInCalls = 0;
  const result = await resolveContactEmail({
    contactOutLookup: async () => ({ email: "verified@example.com" }),
    linkedInLookup: async () => { linkedInCalls += 1; return { email: "fallback@example.com" }; },
  });
  assert.equal(result.email, "verified@example.com");
  assert.equal(result.source, "contactout");
  assert.equal(linkedInCalls, 0);
});
