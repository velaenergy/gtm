import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDailySendSeries,
  collectSentEvents,
  deliveryOutcomeCounts,
  summarizeDailySends,
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

test("delivery outcomes separate sent, scheduled, failed, and cancelled records", () => {
  assert.deepEqual(deliveryOutcomeCounts({
    deliveryLog: [{ status: "sent" }, { status: "partial" }, { status: "failed" }, { status: "cancelled" }],
    scheduledJobs: [{ status: "scheduled" }, { status: "cancelled" }],
  }), { sent: 2, scheduled: 1, failed: 1, cancelled: 1 });
});
