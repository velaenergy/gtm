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
  approvalSendSummary,
  pendingReviewDrafts,
  reviewDrawerDrafts,
  nextReviewProspectId,
  researchFunnel,
  researchBatchPagination,
  researchRunMetrics,
  researchThreadTitle,
  resolveDuplicateSendDecision,
} from "../lib/research-workspace.js";

test("research chats receive compact useful titles", () => {
  assert.equal(researchThreadTitle("Find VP power leaders at data centers"), "VP power leaders at data centers");
});

test("[V65] duplicate bulk sends can skip previously emailed recipients", () => {
  const people = [{ id: "1", email: "sent@example.com" }, { id: "2", email: "new@example.com" }];
  const matches = [{ recipient: "SENT@example.com", status: "sent" }];
  assert.deepEqual(resolveDuplicateSendDecision(people, matches, "skip"), {
    proceed: true,
    override: false,
    people: [people[1]],
    skippedCount: 1,
  });
  assert.deepEqual(resolveDuplicateSendDecision(people, matches, "override").people, people);
  assert.equal(resolveDuplicateSendDecision(people, matches, "cancel").proceed, false);
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

test("[V53] approval progress removes approved drafts and deletion keeps the next position", () => {
  const prospects = Array.from({ length: 135 }, (_, index) => ({ id: `prospect-${index + 1}`, status: "ready" }));
  const afterApproval = prospects.map((prospect, index) => index === 0 ? { ...prospect, status: "drafted" } : prospect);

  assert.equal(pendingReviewDrafts(afterApproval).length, 134);
  assert.equal(pendingReviewDrafts(afterApproval)[0].id, "prospect-2");
  assert.equal(nextReviewProspectId(pendingReviewDrafts(prospects), "prospect-1"), "prospect-2");
  assert.equal(nextReviewProspectId(pendingReviewDrafts(prospects), "prospect-135"), "prospect-134");
});

test("[V60] opening an approved draft keeps it in an ordinal review cohort", () => {
  const prospects = [
    { id: "ready-1", status: "ready" },
    { id: "approved-1", status: "drafted" },
    { id: "approved-2", status: "drafted" },
  ];

  assert.deepEqual(reviewDrawerDrafts(prospects, "ready-1").map(({ id }) => id), ["ready-1"]);
  assert.deepEqual(reviewDrawerDrafts(prospects, "approved-1").map(({ id }) => id), ["approved-1", "approved-2"]);
});

test("[V61] a single approval send failure names the reason instead of generic attention", () => {
  assert.equal(approvalSendSummary(0, ["DJ Alberty: connect tarun@velaenergy.ai"]), "0 sent · DJ Alberty: connect tarun@velaenergy.ai");
  assert.equal(approvalSendSummary(2, ["One failed", "Two failed"]), "2 sent · 2 need attention · First: One failed");
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

test("[V58] Research navigation does not show an unexplained prospect count", async () => {
  const [dashboardJs, dashboardHtml] = await Promise.all([
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.html", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(dashboardHtml, /id="navResearch"/);
  assert.doesNotMatch(dashboardJs, /navResearch/);
});

test("[V42] the Research UI binds both next-batch entry points", async () => {
  const [dashboardJs, dashboardHtml] = await Promise.all([
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.html", import.meta.url), "utf8"),
  ]);
  assert.match(dashboardHtml, /id="nextResearchBatchButton"/);
  assert.match(dashboardHtml, /id="researchRunNextBatchButton"/);
  assert.match(dashboardJs, /nextResearchBatchButton\.addEventListener\("click", \(\) => runNextResearchBatch\(\)\)/);
  assert.match(dashboardJs, /researchRunNextBatchButton\.addEventListener\("click", \(\) => runNextResearchBatch\(\)\)/);
  assert.match(dashboardJs, /researchRunNextBatchButton\.hidden = run\.status !== "complete" \|\| state\.busy \|\| !batchPagination\.hasNext/);
  assert.match(dashboardJs, /researchRunNextBatchButton\.textContent = `Research next batch \(\$\{batchPagination\.nextPage\}\)`/);
  assert.match(dashboardJs, /isNextResearchBatchRequest\(message\).*researchBatchPagination\(state\.researchRun\)\.hasNext/);
  assert.match(dashboardJs, /executeResearchPlan\(plan, brief, \{ page: pagination\.nextPage \}\)/);
  assert.match(dashboardJs, /completed fit checks for \$\{audited\}/);
  assert.match(dashboardJs, /will not use email credits/);
});

test("[V62] a broadened zero-strong run is not presented as ready or told to broaden again", async () => {
  const dashboardJs = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
  assert.match(dashboardJs, /complete" && !run\.strongCount/);
  assert.match(dashboardJs, /"No qualified results"/);
  assert.match(dashboardJs, /The automatic fallback already widened the Apollo search/);
  assert.doesNotMatch(dashboardJs, /discovery\?\.broadened[\s\S]{0,500}Try broadening the audience/);
});

test("[V67] a strong batch can resume drafting and ContactOut decline continues Apollo-only", async () => {
  const [dashboardJs, dashboardHtml] = await Promise.all([
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.html", import.meta.url), "utf8"),
  ]);
  assert.match(dashboardHtml, /id="researchRunDraftButton"/);
  assert.match(dashboardJs, /researchRunDraftButton\.addEventListener\("click", \(\) => draftCurrentResearchRun\(\)\)/);
  assert.match(dashboardJs, /researchRunDraftButton\.textContent = `Draft qualified \(\$\{draftableStrong\.length\}\)`/);
  assert.match(dashboardJs, /Continuing with Apollo only; no ContactOut credits will be used\./);
  assert.doesNotMatch(dashboardJs, /if \(!approveSessionReveal\) \{ showToast\("ContactOut reveal cancelled\. No credits were used\."\); return; \}/);
  assert.match(dashboardJs, /people qualified, but none are ready for approval yet/);
});

test("[V46][V47][V57] sent history and approval actions stay wired to their real data paths", async () => {
  const [dashboardJs, dashboardHtml] = await Promise.all([
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../dashboard.html", import.meta.url), "utf8"),
  ]);
  assert.match(dashboardJs, /gmailMessagesAsDeliveryRecords\(state\.gtmMessages\)/);
  assert.match(dashboardJs, /elements\.processButton\.textContent = state\.view === "review" && readyToApprove\.length \? "Run and approve all" : "Draft qualified"/);
  assert.match(dashboardJs, /async function runAndApproveAll\(\)[\s\S]*approveProspects\(readyIds\)[\s\S]*openBulkSend/);
  assert.match(dashboardJs, /launchDraftQualifiedResearch/);
  assert.match(dashboardJs, /setView\("research"\)/);
  assert.match(dashboardJs, /View on LinkedIn/);
  assert.match(dashboardHtml, />Clear approvals</);
  assert.doesNotMatch(dashboardHtml, /<th>Updated<\/th>/);
  assert.match(dashboardJs, /VELA_GTM_TEAM_PROSPECTS_DELETE/);
});

test("research automation normalizes caps and uses stable Chrome alarm names", () => {
  const automation = normalizeResearchAutomation({ id: "run-daily", cadenceMinutes: 1, maxResults: 500, dailySendCap: 0, mode: "yolo" });
  assert.equal(automation.cadenceMinutes, 15);
  assert.equal(automation.maxResults, 300);
  assert.equal(automation.dailySendCap, 25);
  assert.equal(researchAutomationIdFromAlarm(researchAutomationAlarmName(automation.id)), "run-daily");
  assert.equal(nextAutomationRun(60, new Date("2026-07-16T00:00:00.000Z")), "2026-07-16T01:00:00.000Z");
});

test("[V50] research and YOLO sends keep the selected template follow-up sequence", async () => {
  const dashboardJs = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
  assert.match(dashboardJs, /buildDeliveryFollowUps\(/);
  assert.match(dashboardJs, /delivery: \{[^}]*\.\.\.followUpSequence/s);
});
