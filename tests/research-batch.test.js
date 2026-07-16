import assert from "node:assert/strict";
import test from "node:test";

import { auditResearchBatch, buildProspectAuditRequest, gmailLearningContext, researchRunCounts } from "../lib/research-batch.js";
import { upsertProspects } from "../lib/queue.js";

test("grounds target auditing in profile facts and shared Gmail outcomes", () => {
  const context = gmailLearningContext({
    activity: [{ status: "sent" }, { status: "sent" }],
    prospects: [{ headline: "VP, Power", replyReceivedAt: "2026-07-15", subject: "Power availability" }],
  });
  const request = buildProspectAuditRequest({ name: "Avery", headline: "Director, Critical Facilities", company: "Atlas" }, context);
  assert.match(request.context, /2 delivered messages and 1 known human reply/);
  assert.match(request.context, /profile responsibility remains the authority/i);
  assert.equal(request.profile.experiences[0].company, "Atlas");
});

test("audits a batch with bounded workers and preserves per-person failures", async () => {
  let active = 0;
  let peak = 0;
  const progress = [];
  const prospects = Array.from({ length: 7 }, (_, index) => ({ id: String(index), name: `Person ${index}`, headline: "Energy leader" }));
  const result = await auditResearchBatch(prospects, {
    concurrency: 3,
    operator: { id: "user-1", name: "Tarun" },
    verify: async (_request, prospect) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (prospect.id === "5") throw new Error("temporary failure");
      return { verdict: Number(prospect.id) % 2 ? "review" : "strong", score: 80, checkedAt: "2026-07-15" };
    },
    onProgress: ({ completed }) => progress.push(completed),
  });
  assert.equal(peak <= 3, true);
  assert.equal(progress.length, 7);
  assert.equal(result[5].auditStatus, "error");
  assert.equal(result[0].auditedBy.name, "Tarun");
  assert.deepEqual(researchRunCounts(result), { foundCount: 7, auditedCount: 6, strongCount: 4, reviewCount: 2, skipCount: 0 });
});

test("keeps research-run ownership through queue normalization", () => {
  const [prospect] = upsertProspects([], [{ providerId: "apollo-1", name: "Avery", researchRunId: "run-1", auditStatus: "queued", auditedBy: { id: "user-1", name: "Tarun" } }]);
  assert.equal(prospect.researchRunId, "run-1");
  assert.equal(prospect.auditStatus, "queued");
  assert.equal(prospect.auditedBy.name, "Tarun");
});
