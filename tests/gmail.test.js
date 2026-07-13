import assert from "node:assert/strict";
import test from "node:test";
import { buildMimeMessage, gmailDraftPayload } from "../lib/gmail.js";

test("builds a safe RFC-style text message", () => {
  const message = buildMimeMessage({ to: "person@example.com\r\nBcc: bad@example.com", subject: "Quick intro", body: "Hi there,\n\nHello." });
  assert.match(message, /^To: person@example\.com Bcc: bad@example\.com\r\n/);
  assert.match(message, /Content-Type: text\/plain/);
  assert.match(message, /Hi there,\r\n\r\nHello\./);
});

test("creates a Gmail drafts.create payload with base64url raw content", () => {
  const payload = gmailDraftPayload({ to: "person@example.com", subject: "Energy + infrastructure", body: "Hello" });
  assert.deepEqual(Object.keys(payload), ["message"]);
  assert.match(payload.message.raw, /^[A-Za-z0-9_-]+$/);
  const padded = payload.message.raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.message.raw.length / 4) * 4, "=");
  assert.match(Buffer.from(padded, "base64").toString("utf8"), /Subject: Energy \+ infrastructure/);
});
