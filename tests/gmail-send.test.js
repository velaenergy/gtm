import assert from "node:assert/strict";
import test from "node:test";
import {
  GMAIL_SEND_API_URL,
  GmailApiError,
  buildMimeMessage,
  gmailSendPayload,
  sendGmailMessage,
  uniqueRecipients,
} from "../lib/gmail-send.js";

test("builds one safe RFC message for one verified recipient", () => {
  const message = buildMimeMessage({ to: "person@example.com", subject: "Power in Montréal", body: "Hi,\n\nHello." });
  assert.match(message, /^To: person@example\.com\r\n/);
  assert.match(message, /Subject: =\?UTF-8\?B\?/);
  assert.match(message, /Hi,\r\n\r\nHello\.$/);
});

test("rejects multi-address headers and header injection", () => {
  assert.throws(() => buildMimeMessage({ to: "one@example.com,two@example.com", subject: "Hi", body: "Body" }), /valid verified recipient/);
  assert.throws(() => buildMimeMessage({ to: "one@example.com", subject: "Hi\r\nBcc: bad@example.com", body: "Body" }), /line breaks/);
});

test("deduplicates recipients while keeping separate MIME payloads", () => {
  assert.deepEqual(uniqueRecipients(["One@Example.com", "one@example.com", "two@example.com"]), ["one@example.com", "two@example.com"]);
  const payload = gmailSendPayload({ to: "one@example.com", subject: "Hello", body: "Body" });
  assert.deepEqual(Object.keys(payload), ["raw"]);
  assert.match(payload.raw, /^[A-Za-z0-9_-]+$/);
});

test("posts messages.send and surfaces Gmail errors", async () => {
  const calls = [];
  const result = await sendGmailMessage("token", { to: "one@example.com", subject: "Hello", body: "Body" }, {
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() { return { id: "message-1", threadId: "thread-1" }; } };
    },
  });
  assert.deepEqual(result, { id: "message-1", threadId: "thread-1" });
  assert.equal(calls[0].url, GMAIL_SEND_API_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer token");

  await assert.rejects(sendGmailMessage("token", { to: "one@example.com", subject: "Hello", body: "Body" }, {
    async fetchImpl() { return { ok: false, status: 403, async json() { return { error: { message: "Access denied" } }; } }; },
  }), (error) => error instanceof GmailApiError && error.status === 403);
});
