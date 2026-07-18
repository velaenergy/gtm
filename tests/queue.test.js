import assert from "node:assert/strict";
import test from "node:test";
import { QUEUE_STATUS, markProspectsSent, normalizeLinkedInUrl, parseBulkProspects, prospectDisplayName, queueStats, upsertProspects } from "../lib/queue.js";

test("normalizes LinkedIn profile URLs and strips tracking", () => {
  assert.equal(normalizeLinkedInUrl("https://linkedin.com/in/RiddhimanRana/?trk=abc"), "https://www.linkedin.com/in/RiddhimanRana");
  assert.equal(normalizeLinkedInUrl("https://linkedin.com/company/vela"), "");
});

test("bulk import deduplicates and keeps optional background", () => {
  const prospects = parseBulkProspects(`Riddhiman | https://www.linkedin.com/in/riddhimanrana/ | energy founder
https://www.linkedin.com/in/riddhimanrana?trk=again
https://www.linkedin.com/in/josh-rivera | data center operations`);
  assert.equal(prospects.length, 2);
  assert.match(prospects[0].background, /energy founder/);
});

test("upsert preserves drafted state for repeated imports", () => {
  const existing = upsertProspects([], [{ url: "https://www.linkedin.com/in/example", status: QUEUE_STATUS.DRAFTED, draftId: "d1" }]);
  const updated = upsertProspects(existing, [{ url: "https://www.linkedin.com/in/example", background: "New signal" }]);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].status, QUEUE_STATUS.DRAFTED);
  assert.equal(updated[0].background, "New signal");
  assert.deepEqual(queueStats(updated), { total: 1, ready: 0, drafted: 1, sent: 0, attention: 0 });
});

test("approval rows prefer a saved full name and recover a missing surname for existing records", () => {
  assert.equal(prospectDisplayName({ name: "Greg", profile: { name: "Greg Miller" }, email: "gmiller@humacyte.com" }), "Greg Miller");
  assert.equal(prospectDisplayName({ name: "April", email: "amcdermand@cyrusone.com" }), "April McDermand");
  assert.equal(prospectDisplayName({ name: "Dane", email: "dane.barhoover@kiewit.com" }), "Dane Barhoover");
  assert.equal(prospectDisplayName({ name: "Ross", email: "ross.barrette@merjent.com" }), "Ross Barrette");
});

test("successful Gmail sends leave the approval stack durably and stale shared rows cannot restore them", () => {
  const ready = upsertProspects([], [{ url: "https://www.linkedin.com/in/dane-barhoover", name: "Dane", email: "dane.barhoover@kiewit.com", status: QUEUE_STATUS.DRAFTED }]);
  const sent = markProspectsSent(ready, [ready[0].id], "2026-07-16T20:00:00.000Z");
  const refreshed = upsertProspects(sent, [{ ...ready[0], status: QUEUE_STATUS.DRAFTED, emailSentAt: "" }]);

  assert.equal(sent[0].status, QUEUE_STATUS.SENT);
  assert.equal(sent[0].emailSentAt, "2026-07-16T20:00:00.000Z");
  assert.equal(refreshed[0].status, QUEUE_STATUS.SENT);
  assert.deepEqual(queueStats(refreshed), { total: 1, ready: 0, drafted: 0, sent: 1, attention: 0 });
});

test("a teammate's shared sent state promotes an older local approved draft", () => {
  const approved = upsertProspects([], [{ url: "https://www.linkedin.com/in/shared-send", status: QUEUE_STATUS.DRAFTED }]);
  const refreshed = upsertProspects(approved, [{ ...approved[0], status: QUEUE_STATUS.SENT, emailSentAt: "2026-07-16T20:05:00.000Z" }]);

  assert.equal(refreshed[0].status, QUEUE_STATUS.SENT);
  assert.equal(refreshed[0].emailSentAt, "2026-07-16T20:05:00.000Z");
});

test("[V70] stored direct energy-role reviews recover without another Apollo pull", () => {
  const [direct, generic] = upsertProspects([], [
    { providerId: "apollo-direct", headline: "Director, Energy Procurement", targetFit: { verdict: "review", score: 62, reason: "Thin profile", evidence: ["Director, Energy Procurement"], checkedAt: "2026-07-18T20:00:00.000Z" } },
    { providerId: "apollo-generic", headline: "Procurement Manager", targetFit: { verdict: "review", score: 62, reason: "Thin profile", evidence: ["Procurement Manager"], checkedAt: "2026-07-18T20:00:00.000Z" } },
  ]).sort((a, b) => a.providerId.localeCompare(b.providerId));

  assert.equal(direct.targetFit.verdict, "strong");
  assert.equal(direct.targetFit.checkedAt, "2026-07-18T20:00:00.000Z");
  assert.equal(generic.targetFit.verdict, "review");
});
