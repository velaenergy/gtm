import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDailySendSeries,
  collectSentEvents,
  deliveryOutcomeCounts,
  mailboxCapacityUsage,
  mailboxDailyCapacity,
  mailboxSentEvents,
  mergeDeliveryRecords,
  summarizeDailySends,
  teamMemberKey,
  teamPerformance,
} from "../lib/analytics.js";

test("collectSentEvents merges the delivery ledger with manual sent marks without duplicating prospects", () => {
  const events = collectSentEvents({
    deliveryLog: [
      { id: "delivery-1", prospectId: "prospect-1", status: "sent", completedAt: "2026-07-12T18:00:00.000Z" },
      { id: "delivery-2", prospectId: "prospect-2", status: "failed", completedAt: "2026-07-12T19:00:00.000Z" },
    ],
    queue: [
      { id: "prospect-1", emailSentAt: "2026-07-12T18:00:00.000Z" },
      { id: "prospect-3", emailSentAt: "2026-07-13T18:00:00.000Z" },
    ],
  });

  assert.deepEqual(events.map((event) => event.identity), ["prospect-3", "prospect-1"]);
  assert.equal(events[0].recipient, "");
});

test("[V50] mailbox totals use confirmed sender records instead of queue sent fallbacks", () => {
  const deliveryLog = [{
    id: "research-send-1",
    prospectId: "prospect-1",
    senderEmail: "tarun@velaenergy.ai",
    recipients: ["person@example.com"],
    status: "sent",
    completedAt: "2026-07-16T18:00:00.000Z",
  }];
  const queue = [{
    id: "prospect-1",
    email: "person@example.com",
    senderEmail: "tarun@velaenergy.ai",
    emailSentAt: "2026-07-16T18:00:00.000Z",
  }];

  assert.equal(collectSentEvents({ deliveryLog, queue }).length, 1);
  assert.equal(mailboxSentEvents({ deliveryLog, queue }).length, 1);
  assert.equal(mailboxSentEvents({ deliveryLog: [{ ...deliveryLog[0], senderEmail: "" }], queue }).length, 0);
});

test("legacy sent marks remain visible as unattributed history", () => {
  const events = collectSentEvents({
    queue: [{ id: "prospect-legacy", email: "legacy@example.com", emailSentAt: "2026-07-13T18:00:00.000Z" }],
  });
  const [row] = teamPerformance(events);

  assert.equal(row.key, "unattributed");
  assert.equal(row.name, "Unattributed history");
  assert.equal(row.sent, 1);
  assert.equal(row.recipients, 1);
});

test("merges local and Supabase records without double counting the same recipient", () => {
  const local = { id: "delivery-1", recipients: ["one@example.com"], status: "sent", completedAt: "2026-07-12T18:00:00.000Z", source: "local" };
  const shared = { ...local, source: "supabase" };
  const merged = mergeDeliveryRecords([shared], [local]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "supabase");
});

test("[V46] canonical Gmail history replaces a duplicate activity row by Gmail message ID", () => {
  const canonical = { id: "gmail:account:message-1", gmailMessageId: "message-1", recipients: ["one@example.com"], status: "sent", completedAt: "2026-07-16T12:00:00.000Z", senderEmail: "tarun@velaenergy.ai", source: "gmail" };
  const activity = { id: "delivery-1", gmailMessageId: "message-1", recipients: ["one@example.com"], status: "sent", completedAt: "2026-07-16T12:00:01.000Z", source: "supabase" };
  const merged = mergeDeliveryRecords([canonical], [activity]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].senderEmail, "tarun@velaenergy.ai");
  assert.equal(merged[0].source, "gmail");
});

test("daily analytics fills empty days and summarizes recent volume", () => {
  const now = new Date(2026, 6, 13, 12);
  const today = new Date(2026, 6, 13, 9).toISOString();
  const yesterday = new Date(2026, 6, 12, 9).toISOString();
  const series = buildDailySendSeries([{ at: today }, { at: today }, { at: yesterday }], { days: 3, now, locale: "en-US" });
  const summary = summarizeDailySends(series);

  assert.deepEqual(series.map((day) => day.count), [0, 1, 2]);
  assert.equal(summary.total, 3);
  assert.equal(summary.lastSeven, 3);
  assert.equal(summary.average, 1);
  assert.equal(summary.best.count, 2);
});

test("team performance groups sends by teammate and sender with latest activity", () => {
  const rows = teamPerformance([
    { operatorName: "Riddhiman Rana", senderEmail: "tony@velaenergy.ai", recipient: "one@example.com", at: "2026-07-15T12:00:00.000Z" },
    { operatorName: "Riddhiman Rana", senderEmail: "tony@velaenergy.ai", recipient: "two@example.com", at: "2026-07-15T13:00:00.000Z" },
    { operatorName: "Karan Bahl", senderEmail: "tarun@velaenergy.ai", recipient: "one@example.com", at: "2026-07-14T12:00:00.000Z" },
  ]);
  assert.deepEqual(rows.map(({ name, senderEmail, sent, recipients, lastSentAt }) => ({ name, senderEmail, sent, recipients, lastSentAt })), [
    { name: "Riddhiman Rana", senderEmail: "tony@velaenergy.ai", sent: 2, recipients: 2, lastSentAt: "2026-07-15T13:00:00.000Z" },
    { name: "Karan Bahl", senderEmail: "tarun@velaenergy.ai", sent: 1, recipients: 1, lastSentAt: "2026-07-14T12:00:00.000Z" },
  ]);
});

test("team performance keeps one teammate together across multiple Gmail senders", () => {
  const [row] = teamPerformance([
    { operatorId: "user-1", operatorName: "Riddhiman Rana", operatorEmail: "riddhiman@velaenergy.ai", senderEmail: "tarun@velaenergy.ai", recipient: "one@example.com", at: "2026-07-15T12:00:00.000Z" },
    { operatorId: "user-1", operatorName: "Riddhiman Rana", operatorEmail: "riddhiman@velaenergy.ai", senderEmail: "tony@velaenergy.ai", recipient: "two@example.com", at: "2026-07-15T13:00:00.000Z" },
  ]);

  assert.equal(row.name, "Riddhiman Rana");
  assert.equal(row.sent, 2);
  assert.equal(row.recipients, 2);
  assert.deepEqual(row.senders, ["tarun@velaenergy.ai", "tony@velaenergy.ai"]);
});

test("team performance attributes replies and exposes a stable drill-down key", () => {
  const events = [
    { operatorId: "user-1", operatorName: "Riddhiman Rana", senderEmail: "tarun@velaenergy.ai", recipient: "one@example.com", at: "2026-07-15T12:00:00.000Z" },
    { operatorId: "user-1", operatorName: "Riddhiman Rana", senderEmail: "tarun@velaenergy.ai", recipient: "two@example.com", at: "2026-07-15T13:00:00.000Z" },
  ];
  const [row] = teamPerformance(events, { replyRecipients: ["ONE@example.com"] });

  assert.equal(teamMemberKey(events[0]), "user-1");
  assert.equal(row.key, "user-1");
  assert.equal(row.replies, 1);
  assert.equal(row.replyRate, 50);
});

test("team performance credits a shared recipient reply only to the assigned sender", () => {
  const rows = teamPerformance([
    { operatorId: "user-1", operatorName: "Riddhiman Rana", recipient: "shared@example.com", at: "2026-07-14T12:00:00.000Z" },
    { operatorId: "user-2", operatorName: "Tarun Batchu", recipient: "shared@example.com", at: "2026-07-15T12:00:00.000Z" },
  ], {
    replyRecipients: ["shared@example.com"],
    replyOwnerByRecipient: { "shared@example.com": "user-2" },
  });

  assert.deepEqual(rows.map(({ key, replies }) => ({ key, replies })), [
    { key: "user-1", replies: 0 },
    { key: "user-2", replies: 1 },
  ]);
});

test("delivery outcomes separate sent, scheduled, failed, and cancelled records", () => {
  assert.deepEqual(deliveryOutcomeCounts({
    deliveryLog: [{ status: "sent" }, { status: "partial" }, { status: "failed" }, { status: "cancelled" }],
    scheduledJobs: [{ status: "scheduled" }, { status: "cancelled" }],
  }), { sent: 2, scheduled: 1, failed: 1, cancelled: 1 });
});

test("mailbox capacity distinguishes Workspace from consumer Gmail accounts", () => {
  assert.equal(mailboxDailyCapacity("tarun@vela.energy"), 2000);
  assert.equal(mailboxDailyCapacity("tarun@gmail.com"), 500);
  assert.equal(mailboxDailyCapacity("tarun@googlemail.com"), 500);
});

test("mailbox capacity counts only successful sends from today", () => {
  const now = new Date(2026, 6, 15, 12);
  const today = new Date(2026, 6, 15, 9).toISOString();
  const yesterday = new Date(2026, 6, 14, 9).toISOString();
  const usage = mailboxCapacityUsage({
    now,
    accounts: [
      { id: "work", email: "tarun@vela.energy" },
      { id: "gmail", email: "tarun@gmail.com" },
    ],
    deliveryLog: [
      { status: "sent", senderEmail: "tarun@vela.energy", recipients: ["one@example.com"], completedAt: today },
      { status: "partial", senderEmail: "tarun@gmail.com", recipients: ["two@example.com", "three@example.com"], completedAt: today },
      { status: "failed", senderEmail: "tarun@gmail.com", recipients: ["four@example.com"], completedAt: today },
      { status: "sent", senderEmail: "tarun@gmail.com", recipients: ["five@example.com"], completedAt: yesterday },
    ],
  });

  assert.deepEqual(usage.map(({ email, type, capacity, sent, remaining }) => ({ email, type, capacity, sent, remaining })), [
    { email: "tarun@vela.energy", type: "Workspace", capacity: 2000, sent: 1, remaining: 1999 },
    { email: "tarun@gmail.com", type: "Gmail", capacity: 500, sent: 2, remaining: 498 },
  ]);
});
