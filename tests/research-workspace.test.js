import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_RESEARCH_PROMPTS,
  formatRunDuration,
  isNextResearchBatchRequest,
  nextAutomationRun,
  normalizeLocalResearchMessages,
  normalizeResearchAutomation,
  normalizeResearchThread,
  researchAutomationIdFromAlarm,
  researchAutomationAlarmName,
  researchApprovalStack,
  researchFunnel,
  researchBatchPagination,
  researchRunMetrics,
  researchThreadTitle,
} from "../lib/research-workspace.js";

test("research chats receive compact useful titles", () => {
  assert.equal(researchThreadTitle("Find VP power leaders at data centers"), "VP power leaders at data centers");
});

test("local research history stays bounded and independent from team persistence", () => {
  const thread = normalizeResearchThread({ id: "local-chat", title: "  Site selection   leaders " });
  const history = normalizeLocalResearchMessages({
    "local-chat": Array.from({ length: 205 }, (_, index) => ({ id: `message-${index}`, threadId: "local-chat", role: index % 2 ? "assistant" : "user", content: `Message ${index}` })),
  });
  assert.equal(thread.title, "Site selection leaders");
  assert.equal(history["local-chat"].length, 200);
  assert.equal(history["local-chat"][0].content, "Message 5");
});

test("research run analytics preserve the full 100-to-ready funnel and duration", () => {
  const run = { totalFound: 8421, foundCount: 100, auditedCount: 100, readyCount: 28, startedAt: "2026-07-16T00:00:00.000Z", completedAt: "2026-07-16T00:02:05.000Z" };
  assert.deepEqual(researchFunnel(run).map(({ label, value }) => [label, value]), [["Matched", 8421], ["Pulled", 100], ["Fit checked", 100], ["Ready", 28]]);
  assert.equal(researchRunMetrics(run).durationMs, 125000);
  assert.equal(formatRunDuration(125000), "2m 05s");
});

test("[V47] approval stacks keep ready and approved people from multiple research runs", () => {
  assert.deepEqual(researchApprovalStack([
    { researchRunId: "run-1", status: "ready" },
    { researchRunId: "run-1", status: "drafted" },
    { researchRunId: "run-2", status: "ready" },
    { researchRunId: "run-2", status: "sent" },
    { status: "ready" },
  ]), { total: 3, ready: 2, approved: 1, runs: 2 });
});

test("[V42] default research prompts are US-only and follow-up batches advance by 100", () => {
  assert.equal(DEFAULT_RESEARCH_PROMPTS.length, 3);
  assert.ok(DEFAULT_RESEARCH_PROMPTS.every(({ prompt }) => prompt.includes("United States")));
  assert.equal(isNextResearchBatchRequest("pull the next 100"), true);
  assert.equal(isNextResearchBatchRequest("another batch please"), true);
  assert.equal(isNextResearchBatchRequest("find site selection leaders"), false);
  assert.deepEqual(researchBatchPagination({ page: 1, requestedCount: 100, foundCount: 100, totalFound: 39232 }), {
    page: 1,
    perPage: 100,
    total: 39232,
    pulled: 100,
    nextPage: 2,
    hasNext: true,
  });
  assert.equal(researchBatchPagination({ page: 4, requestedCount: 100, foundCount: 32, totalFound: 332 }).hasNext, false);
});

test("[V43] an empty workspace can render before a research run exists", () => {
  assert.deepEqual(researchBatchPagination(null), {
    page: 1,
    perPage: 300,
    total: 0,
    pulled: 0,
    nextPage: 2,
    hasNext: false,
  });
});

test("[V42] the Research UI binds both next-batch entry points", async () => {
  const [dashboardJs, dashboardHtml] = await Promise.all([
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.html", import.meta.url), "utf8"),
  ]);
  assert.match(dashboardHtml, /id="nextResearchBatchButton"/);
  assert.match(dashboardJs, /nextResearchBatchButton\.addEventListener\("click", \(\) => runNextResearchBatch\(\)\)/);
  assert.match(dashboardJs, /isNextResearchBatchRequest\(message\).*researchBatchPagination\(state\.researchRun\)\.hasNext/);
  assert.match(dashboardJs, /executeResearchPlan\(plan, brief, \{ page: pagination\.nextPage \}\)/);
  assert.match(dashboardJs, /completed fit checks for \$\{audited\}/);
  assert.match(dashboardJs, /will not use email credits/);
});

test("[V46][V47] sent history attribution and approval actions stay wired to their real data paths", async () => {
  const dashboardJs = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
  assert.match(dashboardJs, /gmailMessagesAsDeliveryRecords\(state\.gtmMessages\)/);
  assert.match(dashboardJs, /Approve & run\$\{readyToApprove\.length \? ` \$\{readyToApprove\.length\}` : ""\}/);
  assert.doesNotMatch(dashboardJs, /Approve & run[^\n]* of /);
  assert.match(dashboardJs, /View on LinkedIn/);
  assert.match(dashboardJs, /approveAndRun\(visibleProspects\(\)\.map/);
});

test("research automation normalizes caps and uses stable Chrome alarm names", () => {
  const automation = normalizeResearchAutomation({ id: "run-daily", cadenceMinutes: 1, maxResults: 500, dailySendCap: 0, mode: "yolo" });
  assert.equal(automation.cadenceMinutes, 15);
  assert.equal(automation.maxResults, 300);
  assert.equal(automation.dailySendCap, 25);
  assert.equal(researchAutomationIdFromAlarm(researchAutomationAlarmName(automation.id)), "run-daily");
  assert.equal(nextAutomationRun(60, new Date("2026-07-16T00:00:00.000Z")), "2026-07-16T01:00:00.000Z");
});
