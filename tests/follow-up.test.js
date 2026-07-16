import test from "node:test";
import assert from "node:assert/strict";

import { FOLLOW_UP_TEMPLATES, TEMPLATES, followUpTemplates } from "../lib/message.js";
import { addBusinessDays, buildFollowUpJobs, hasRecordedReply } from "../lib/follow-up.js";

test("Tony and Tarun defaults keep their screenshot copy and cadence", () => {
  assert.equal(FOLLOW_UP_TEMPLATES.length, 6);
  assert.deepEqual(TEMPLATES.map((template) => [template.name, template.followUpCadenceDays]), [["Tony", 3], ["Tarun", 4]]);
  assert.match(followUpTemplates({})[0].body, /20-30 minute conversation/);
  assert.match(followUpTemplates({})[2].body, /this will be my last email/);
});

test("automatic sequences schedule on business days", () => {
  const friday = new Date("2026-07-17T16:00:00.000Z");
  assert.equal(addBusinessDays(friday, 1).getUTCDay(), 1);
  const jobs = buildFollowUpJobs({
    followUps: FOLLOW_UP_TEMPLATES.slice(0, 3),
    cadenceDays: 3,
    startAt: friday,
    base: { id: "initial", subject: "Hello", recipients: ["person@example.com"] },
    threadId: "thread-1",
    replyToMessageId: "<message@vela.energy>",
  });
  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.map((job) => job.sequenceStep), [1, 2, 3]);
  assert.ok(jobs.every((job) => job.threadId === "thread-1" && job.kind === "follow-up"));
});

test("recorded replies stop a sequence", () => {
  assert.equal(hasRecordedReply({ replyReceivedAt: "2026-07-15T00:00:00.000Z" }), true);
  assert.equal(hasRecordedReply({ activity: [{ type: "reply_received" }] }), true);
  assert.equal(hasRecordedReply({ activity: [{ type: "sent" }] }), false);
});
