import assert from "node:assert/strict";
import test from "node:test";

import { formatDiagnostic, normalizeDiagnosticEvent, redactDiagnosticMessage } from "../lib/diagnostics.js";

test("V17 diagnostic events retain stages while dropping unapproved fields", () => {
  const event = normalizeDiagnosticEvent({
    area: "contactout",
    stage: "encrypted_preview",
    outcome: "error",
    candidateCount: 0,
    cookie: "secret-cookie",
    csrf: "secret-csrf",
    email: "person@example.com",
    message: "Failed for person@example.com at https://contactout.com/private token=abc123",
  }, new Date("2026-07-14T00:00:00.000Z"));

  assert.equal(event.stage, "encrypted_preview");
  assert.equal(event.candidateCount, 0);
  assert.equal("cookie" in event, false);
  assert.equal("csrf" in event, false);
  assert.equal("email" in event, false);
  assert.equal("message" in event, false);
  assert.equal(event.code, "request_failed");
  assert.doesNotMatch(JSON.stringify(event), /person@example\.com|abc123|contactout\.com\/private/);
});

test("diagnostic formatting is readable and message redaction is deterministic", () => {
  assert.equal(redactDiagnosticMessage("Bearer abc person@example.com https://example.com/x"), "[redacted-secret] [redacted-email] [redacted-url]");
  assert.match(formatDiagnostic({ at: "now", area: "contactout", stage: "reveal", outcome: "ok", candidateCount: 2 }), /now \| contactout \| reveal \| ok \| 2 candidates/);
});
