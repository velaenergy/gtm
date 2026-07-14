import assert from "node:assert/strict";
import test from "node:test";
import { QUEUE_STATUS, normalizeLinkedInUrl, parseBulkProspects, queueStats, upsertProspects } from "../lib/queue.js";

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
