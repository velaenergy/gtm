import assert from "node:assert/strict";
import test from "node:test";

import { GMAIL_BOUNCE_QUERY, listGmailBounces, parseGmailBounce } from "../lib/gmail-bounces.js";

function encoded(value) {
  return Buffer.from(value).toString("base64url");
}

function bounceMessage(overrides = {}) {
  return {
    id: "bounce-1",
    threadId: "thread-bounce-1",
    internalDate: String(Date.parse("2026-07-16T03:10:00.000Z")),
    payload: {
      mimeType: "multipart/report",
      headers: [
        { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
        { name: "Subject", value: "Delivery Status Notification (Failure)" },
      ],
      parts: [{ mimeType: "message/delivery-status", body: { data: encoded("Final-Recipient: rfc822; missing@example.com\nDiagnostic-Code: smtp; 550 5.1.1 The email account does not exist") } }],
    },
    ...overrides,
  };
}

test("parses hard-bounce recipients and diagnostics from Gmail delivery-status messages", () => {
  const results = parseGmailBounce(bounceMessage(), { senderEmail: "sender@velaenergy.ai" });
  assert.equal(results.length, 1);
  assert.equal(results[0].recipient, "missing@example.com");
  assert.equal(results[0].reason, "recipient_not_found");
  assert.equal(results[0].type, "hard");
  assert.match(results[0].diagnostic, /550 5\.1\.1/);
});

test("classifies full mailboxes as soft bounces and ignores ordinary email", () => {
  const full = bounceMessage({
    payload: {
      mimeType: "multipart/report",
      headers: [{ name: "From", value: "postmaster@example.net" }, { name: "Subject", value: "Undeliverable" }],
      parts: [{ body: { data: encoded("Final-Recipient: rfc822; full@example.com\nDiagnostic-Code: smtp; 552 5.2.2 Mailbox is full") } }],
    },
  });
  assert.equal(parseGmailBounce(full)[0].type, "soft");
  assert.deepEqual(parseGmailBounce({ payload: { headers: [{ name: "From", value: "person@example.com" }, { name: "Subject", value: "Hello" }] } }), []);
});

test("lists a bounded Gmail bounce query and fetches full message payloads", async () => {
  const calls = [];
  const bounces = await listGmailBounces("token", {
    senderEmail: "sender@velaenergy.ai",
    async fetchImpl(url, options) {
      calls.push({ url, options });
      if (url.includes("/messages?")) return { ok: true, async json() { return { messages: [{ id: "bounce-1" }] }; } };
      return { ok: true, async json() { return bounceMessage(); } };
    },
  });
  assert.equal(bounces[0].recipient, "missing@example.com");
  assert.match(decodeURIComponent(calls[0].url), /newer_than:90d/);
  assert.match(GMAIL_BOUNCE_QUERY, /Delivery Status Notification/);
  assert.match(calls[1].url, /format=full/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer token");
});
