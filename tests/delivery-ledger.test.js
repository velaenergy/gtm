import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_STATUS,
  deliveryModeLabel,
  normalizeDeliveryLog,
  normalizeDeliveryRecord,
  upsertDeliveryRecord,
} from "../lib/delivery-ledger.js";

test("delivery ledger normalizes recipients and keeps the newest status", () => {
  const scheduled = upsertDeliveryRecord([], {
    id: "delivery-1",
    accountId: "gaia-tarun",
    mode: "scheduled",
    status: DELIVERY_STATUS.SCHEDULED,
    recipients: ["ALEX@EXAMPLE.COM", "alex@example.com"],
    subject: "  Quick intro  ",
    scheduledAt: "2026-07-14T16:00:00.000Z",
    createdAt: "2026-07-13T16:00:00.000Z",
  });
  const sent = upsertDeliveryRecord(scheduled, {
    ...scheduled[0],
    status: DELIVERY_STATUS.SENT,
    completedAt: "2026-07-14T16:00:02.000Z",
    updatedAt: "2026-07-14T16:00:02.000Z",
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, DELIVERY_STATUS.SENT);
  assert.equal(sent[0].accountId, "gaia-tarun");
  assert.deepEqual(sent[0].recipients, ["alex@example.com"]);
  assert.equal(sent[0].subject, "Quick intro");
  assert.equal(sent[0].createdAt, "2026-07-13T16:00:00.000Z");
});

test("delivery log keeps the complete reverse-chronological history", () => {
  const records = Array.from({ length: 260 }, (_, index) => ({
    id: `delivery-${index}`,
    status: DELIVERY_STATUS.SENT,
    recipients: [`person${index}@example.com`],
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
  const normalized = normalizeDeliveryLog(records);
  assert.equal(normalized.length, 260);
  assert.equal(normalized[0].id, "delivery-259");
});

test("preserves inbox bounce health without turning it into a successful send", () => {
  const record = normalizeDeliveryRecord({
    id: "gmail-bounce:one",
    mode: "inbox",
    status: DELIVERY_STATUS.BOUNCED,
    recipients: ["missing@example.com"],
    gmailMessageId: "gmail-1",
    bounceReason: "recipient_not_found",
    bounceType: "hard",
  });
  assert.equal(record.mode, "inbox");
  assert.equal(record.status, DELIVERY_STATUS.BOUNCED);
  assert.equal(record.gmailMessageId, "gmail-1");
  assert.equal(record.bounceType, "hard");
});

test("[V32] preserves imported activity and names its list source", () => {
  const record = normalizeDeliveryRecord({
    id: "imported:one",
    mode: "imported",
    status: DELIVERY_STATUS.SENT,
    recipients: ["one@example.com"],
    subject: "Historical outreach",
  });
  assert.equal(record.mode, "imported");
  assert.equal(deliveryModeLabel(record), "Imported from list");
  assert.equal(deliveryModeLabel({ mode: "immediate" }), "Direct send");
});
