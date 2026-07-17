import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  alarmNameForJob,
  createScheduledSend,
  jobIdFromAlarm,
  nextScheduledAt,
  normalizeDeliverySettings,
  scheduledSendKind,
  scheduledSendMatches,
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
    followUps: [{ templateId: "sender-follow-up-1", body: "Following up." }],
    followUpCadenceDays: 4,
    scheduledAt: "2026-07-13T17:00:00.000Z",
    token: "must-not-persist",
  }, now);
  assert.equal(job.status, "scheduled");
  assert.deepEqual(job.followUps, [{ templateId: "sender-follow-up-1", body: "Following up." }]);
  assert.equal(job.followUpCadenceDays, 4);
  assert.equal("token" in job, false);
  assert.equal(jobIdFromAlarm(alarmNameForJob(job.id)), "job-1");
});

test("[V50] a scheduled initial creates its reply-aware follow-ups only after Gmail sends", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /const result = await sendDelivery\(\{ \.\.\.job, duplicateOverride: true \}\)/);
  assert.match(background, /input\.kind !== "follow-up" && input\.followUps\?\.length[\s\S]*scheduleAutomaticFollowUps\(/);
  assert.match(background, /gmailThreadHasReply\([\s\S]*stopFollowUpSequence/);
});

test("[V21] an immediate send silently reuses the selected Gmail session", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.match(background, /message\.type === "VELA_GTM_EMAIL_SEND"\) return sendDelivery\(message\.delivery\)/);
  assert.doesNotMatch(background, /message\.type === "VELA_GTM_EMAIL_SEND"[^\n]*interactiveAuth:\s*true/);
});

test("scheduled send kinds stay searchable without breaking legacy jobs", () => {
  assert.equal(scheduledSendKind({}), "initial");
  assert.equal(scheduledSendKind({ kind: "follow-up" }), "follow-up");
  const followUp = { kind: "follow-up", sequenceStep: 2, recipients: ["person@example.com"], subject: "Quick follow up", senderEmail: "sender@example.com" };
  assert.equal(scheduledSendMatches(followUp, "automatic step 2", { name: "Alex Rivera" }), true);
  assert.equal(scheduledSendMatches(followUp, "alex", { name: "Alex Rivera" }), true);
  assert.equal(scheduledSendMatches(followUp, "other company", { name: "Alex Rivera" }), false);
});

test("scheduled dashboard groups automatic sequences and exposes type search", async () => {
  const [html, dashboard] = await Promise.all([
    readFile(new URL("../dashboard.html", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="scheduledSearch"/);
  assert.match(html, /data-scheduled-kind="follow-up"/);
  assert.match(html, /id="scheduledSenderFilter"/);
  assert.match(html, /id="scheduledTimeFilter"/);
  assert.match(html, /id="scheduledPagination"/);
  assert.match(html, /id="scheduledStopSelected"/);
  assert.match(dashboard, /function scheduledDeliveryGroups/);
  assert.match(dashboard, /function createScheduledWorkUnit/);
  assert.match(dashboard, /scheduledGroupMatchesQuery\(group, state\.scheduledQuery, indexes\)/);
  assert.match(dashboard, /paginate\(visible, state\.scheduledPage, DATA_PAGE_SIZE\)/);
  assert.match(dashboard, /Stops on reply/);
});

test("[V37,V50] each queued follow-up can be sent now through the reply-aware scheduled path", async () => {
  const [background, dashboard] = await Promise.all([
    readFile(new URL("../background.js", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  ]);
  assert.match(background, /async function sendScheduledFollowUpNow/);
  assert.match(background, /WORKSPACE_ACTION\.EMAIL_SCHEDULE_SEND_NOW/);
  assert.match(background, /sendScheduledFollowUpNow[\s\S]*clear\(alarmNameForJob\(id\)\)[\s\S]*processScheduledJob\(id\)/);
  assert.match(background, /processScheduledJob[\s\S]*gmailThreadHasReply[\s\S]*sendDelivery\(\{ \.\.\.job, duplicateOverride: true \}\)/);
  assert.match(dashboard, /WORKSPACE_ACTION\.EMAIL_SCHEDULE_SEND_NOW/);
  assert.match(dashboard, /runtimeHasWorkspaceActions\(capabilities\.data, \[WORKSPACE_ACTION\.EMAIL_SCHEDULE_SEND_NOW\]\)/);
  assert.match(dashboard, /WORKSPACE_RELOAD_MESSAGE/);
  assert.match(dashboard, /"button", "Send now", "delivery-send-now"/);
  assert.match(dashboard, /sendable: true/);
});
