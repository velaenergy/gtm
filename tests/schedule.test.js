import assert from "node:assert/strict";
import test from "node:test";
import {
  alarmNameForJob,
  createScheduledSend,
  jobIdFromAlarm,
  nextScheduledAt,
  normalizeDeliverySettings,
} from "../lib/schedule.js";

test("persistent schedule settings normalize to one local time", () => {
  assert.deepEqual(normalizeDeliverySettings({ scheduleEnabled: true, scheduleTime: "17:45" }), { scheduleEnabled: true, scheduleTime: "17:45" });
  assert.deepEqual(normalizeDeliverySettings({ scheduleEnabled: 0, scheduleTime: "29:99" }), { scheduleEnabled: false, scheduleTime: "09:00" });
});

test("next scheduled send uses today or tomorrow without changing the rule", () => {
  const morning = new Date(2026, 6, 13, 8, 30, 0);
  const evening = new Date(2026, 6, 13, 10, 30, 0);
  assert.equal(nextScheduledAt("09:00", morning).getDate(), 13);
  assert.equal(nextScheduledAt("09:00", evening).getDate(), 14);
  assert.equal(nextScheduledAt("09:00", evening).getHours(), 9);
});

test("scheduled jobs persist delivery data but never OAuth tokens", () => {
  const now = new Date("2026-07-13T16:00:00.000Z");
  const job = createScheduledSend({
    id: "job-1",
    accountId: "account-1",
    senderEmail: "sender@example.com",
    recipients: ["person@example.com"],
    subject: "Hello",
    body: "Body",
    scheduledAt: "2026-07-13T17:00:00.000Z",
    token: "must-not-persist",
  }, now);
  assert.equal(job.status, "scheduled");
  assert.equal("token" in job, false);
  assert.equal(jobIdFromAlarm(alarmNameForJob(job.id)), "job-1");
});
