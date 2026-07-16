import assert from "node:assert/strict";
import test from "node:test";

import { gmailMessagesAsDeliveryRecords, matchGtmTemplate, scanFullGtmMailbox, scanIncrementalGtmMailbox } from "../lib/gmail-gtm-sync.js";

function encoded(value) {
  return Buffer.from(value).toString("base64url");
}

function gmailMessage({ id, threadId, from, to, subject, body, historyId, at, headers = [], labels = [] }) {
  return {
    id,
    threadId,
    historyId: String(historyId),
    internalDate: String(Date.parse(at)),
    labelIds: labels,
    snippet: body.slice(0, 80),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        { name: "Subject", value: subject },
        ...headers,
      ],
      body: { data: encoded(body) },
    },
  };
}

test("recognizes historical personalized outreach from stable template fragments", () => {
  const message = gmailMessage({
    id: "sent-1", threadId: "thread-1", from: "Riddhiman <riddhiman.rana@velaenergy.ai>", to: "person@example.com",
    subject: "A quick question about Northstar", body: "Hi Maya,\n\nYour work leading energy strategy at Northstar stood out. I would value your perspective on a new infrastructure effort.\n\nWould you have fifteen minutes next week?",
    historyId: 10, at: "2026-07-15T12:00:00.000Z", labels: ["SENT"],
  });
  const matched = matchGtmTemplate(message, { emailTemplates: [{
    id: "riddhiman-intro", subject: "A quick question about {{company}}",
    body: "Hi {{firstName}},\n\nYour work leading energy strategy at {{company}} stood out. I would value your perspective on a new infrastructure effort.\n\nWould you have fifteen minutes next week?",
  }] });
  assert.equal(matched.templateId, "riddhiman-intro");
  assert.equal(matched.source, "template_fingerprint");
});

test("[V46] canonical outgoing Gmail messages become attributed sent-history records", () => {
  const records = gmailMessagesAsDeliveryRecords([
    {
      gmailAccountId: "google-tarun",
      gmailMessageId: "gmail-sent-1",
      gmailThreadId: "thread-1",
      direction: "outgoing",
      messageKind: "initial",
      senderEmail: "tarun@velaenergy.ai",
      accountEmail: "tarun@velaenergy.ai",
      recipientEmails: ["Person@Example.com"],
      subject: "A quick question",
      occurredAt: "2026-07-16T12:00:00.000Z",
    },
    { gmailMessageId: "reply-1", direction: "incoming", messageKind: "reply" },
  ]);
  assert.deepEqual(records, [{
    id: "gmail:google-tarun:gmail-sent-1",
    mode: "gmail_history",
    status: "sent",
    accountId: "google-tarun",
    senderEmail: "tarun@velaenergy.ai",
    recipients: ["person@example.com"],
    subject: "A quick question",
    kind: "initial",
    threadId: "thread-1",
    gmailMessageId: "gmail-sent-1",
    completedAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
    source: "gmail",
  }]);
});

test("full sync scans every sent page and stores every sent thread, reply, and relevant bounce", async () => {
  const root = gmailMessage({
    id: "sent-1", threadId: "thread-1", from: "riddhiman.rana@velaenergy.ai", to: "person@example.com", subject: "Seeking advice",
    body: "Hello from Vela", historyId: 100, at: "2026-07-15T12:00:00.000Z", labels: ["SENT"],
  });
  const unrelated = gmailMessage({
    id: "sent-other", threadId: "thread-other", from: "riddhiman.rana@velaenergy.ai", to: "friend@example.com", subject: "Lunch",
    body: "See you tomorrow", historyId: 101, at: "2026-07-15T13:00:00.000Z", labels: ["SENT"],
  });
  const reply = gmailMessage({
    id: "reply-1", threadId: "thread-1", from: "person@example.com", to: "riddhiman.rana@velaenergy.ai", subject: "Re: Seeking advice",
    body: "Happy to chat.", historyId: 102, at: "2026-07-15T14:00:00.000Z",
  });
  const bounce = gmailMessage({
    id: "bounce-1", threadId: "bounce-thread", from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", to: "riddhiman.rana@velaenergy.ai", subject: "Delivery Status Notification (Failure)",
    body: "Final-Recipient: rfc822; person@example.com\nDiagnostic-Code: smtp; 550 5.1.1 The email account does not exist", historyId: 103, at: "2026-07-15T15:00:00.000Z",
  });
  const persisted = [];
  const sentListCalls = [];
  const result = await scanFullGtmMailbox("token", {
    account: { id: "google-riddhiman", email: "riddhiman.rana@velaenergy.ai" },
    knownRecords: [{ recipients: ["person@example.com"], subject: "Seeking advice", completedAt: "2026-07-15T12:00:00.000Z", templateId: "template-1", kind: "initial" }],
    async persistBatch(batch) { persisted.push(...batch); },
    async fetchImpl(url) {
      const decoded = decodeURIComponent(String(url));
      if (decoded.includes("/messages?") && decoded.includes("q=in:sent")) {
        sentListCalls.push(decoded);
        return { ok: true, async json() { return decoded.includes("pageToken=page-2") ? { messages: [] } : { messages: [{ id: "sent-1" }, { id: "sent-other" }], nextPageToken: "page-2" }; } };
      }
      if (decoded.includes("/messages?") && decoded.includes("mailer-daemon")) return { ok: true, async json() { return { messages: [{ id: "bounce-1" }] }; } };
      if (decoded.includes("/messages/sent-1?")) return { ok: true, async json() { return root; } };
      if (decoded.includes("/messages/sent-other?")) return { ok: true, async json() { return unrelated; } };
      if (decoded.includes("/messages/bounce-1?")) return { ok: true, async json() { return bounce; } };
      if (decoded.includes("/threads/thread-1?")) return { ok: true, async json() { return { id: "thread-1", messages: [root, reply] }; } };
      if (decoded.includes("/threads/thread-other?")) return { ok: true, async json() { return { id: "thread-other", messages: [unrelated] }; } };
      throw new Error(`Unexpected Gmail request: ${decoded}`);
    },
  });
  assert.equal(sentListCalls.length, 2);
  assert.equal(result.messagesScanned, 4);
  assert.equal(result.gtmMessagesFound, 4);
  assert.equal(result.sentMessagesFound, 2);
  assert.equal(result.threadsFound, 3);
  assert.equal(result.repliesFound, 1);
  assert.equal(result.bouncesFound, 1);
  assert.deepEqual(new Set(result.messages.map((message) => message.gmailMessageId)), new Set(["sent-1", "sent-other", "reply-1", "bounce-1"]));
  assert.equal(persisted.find((message) => message.gmailMessageId === "sent-other")?.classificationSource, "sent_mailbox");
});

test("incremental sync follows a saved GTM thread from the Gmail history cursor", async () => {
  const reply = gmailMessage({
    id: "reply-2", threadId: "thread-1", from: "person@example.com", to: "riddhiman.rana@velaenergy.ai", subject: "Re: Seeking advice",
    body: "Thursday works.", historyId: 201, at: "2026-07-16T12:00:00.000Z",
  });
  const bounce = gmailMessage({
    id: "bounce-2", threadId: "bounce-thread-2", from: "postmaster@example.net", to: "riddhiman.rana@velaenergy.ai", subject: "Undeliverable",
    body: "Final-Recipient: rfc822; person@example.com\nDiagnostic-Code: smtp; 552 5.2.2 Mailbox is full", historyId: 202, at: "2026-07-16T12:05:00.000Z",
  });
  const result = await scanIncrementalGtmMailbox("token", {
    account: { id: "google-riddhiman", email: "riddhiman.rana@velaenergy.ai" },
    startHistoryId: "200",
    knownRecords: [{ gmailThreadId: "thread-1", templateId: "template-1", messageKind: "initial", recipientEmails: ["person@example.com"] }],
    async fetchImpl(url) {
      if (String(url).includes("/history?")) return { ok: true, async json() { return { historyId: "202", history: [{ messagesAdded: [{ message: { id: "reply-2" } }, { message: { id: "bounce-2" } }] }] }; } };
      return { ok: true, async json() { return String(url).includes("bounce-2") ? bounce : reply; } };
    },
  });
  assert.equal(result.latestHistoryId, "202");
  assert.equal(result.repliesFound, 1);
  assert.equal(result.bouncesFound, 1);
  assert.equal(result.messages[0].classificationSource, "thread_reply");
});
