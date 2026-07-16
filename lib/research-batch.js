import { buildTargetFitRequest, VELA_TARGET_CONTEXT } from "./target-fit.js";

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function gmailLearningContext({ activity = [], prospects = [] } = {}) {
  const delivered = activity.filter((item) => ["sent", "partial"].includes(String(item.status || "").toLowerCase()));
  const repliedProspects = prospects.filter((item) => item.replyReceivedAt || (item.activity || []).some((event) => /reply/i.test(event.type || "")));
  const replyRoles = repliedProspects.map((item) => item.profile?.experiences?.[0]?.title || item.headline).map(clean).filter(Boolean).slice(0, 8);
  const replyCompanies = repliedProspects.map((item) => item.profile?.experiences?.[0]?.company || item.company).map(clean).filter(Boolean).slice(0, 8);
  const subjects = repliedProspects.map((item) => item.subject).map(clean).filter(Boolean).slice(0, 6);
  const summary = [
    `Shared Gmail history: ${delivered.length} delivered message${delivered.length === 1 ? "" : "s"} and ${repliedProspects.length} known human repl${repliedProspects.length === 1 ? "y" : "ies"}.`,
    replyRoles.length ? `Roles that replied: ${[...new Set(replyRoles)].join(", ")}.` : "No reliable role-level reply pattern is available yet.",
    replyCompanies.length ? `Companies that replied: ${[...new Set(replyCompanies)].join(", ")}.` : "No reliable company-level reply pattern is available yet.",
    subjects.length ? `Subjects associated with replies: ${[...new Set(subjects)].join(" | ")}.` : "Do not infer email-message performance without reply evidence.",
  ];
  return summary.join(" ");
}

export function buildProspectAuditRequest(prospect = {}, gmailContext = "") {
  const profile = prospect.profile || {
    name: prospect.name,
    headline: prospect.headline,
    location: prospect.location,
    company: prospect.company ? { name: prospect.company } : null,
    experiences: prospect.headline || prospect.company ? [{ title: prospect.headline, company: prospect.company }] : [],
  };
  const context = `${VELA_TARGET_CONTEXT}\n\nUse shared Gmail history only as a weak prioritization signal; profile responsibility remains the authority. ${clean(gmailContext)}`;
  return buildTargetFitRequest(profile, context);
}

export function researchRunCounts(prospects = []) {
  const audited = prospects.filter((prospect) => prospect.targetFit);
  return {
    foundCount: prospects.length,
    auditedCount: audited.length,
    strongCount: audited.filter((prospect) => prospect.targetFit.verdict === "strong").length,
    reviewCount: audited.filter((prospect) => prospect.targetFit.verdict === "review").length,
    skipCount: audited.filter((prospect) => prospect.targetFit.verdict === "skip").length,
  };
}

export async function auditResearchBatch(prospects = [], { verify, gmailContext = "", operator = null, concurrency = 4, onProgress = () => {} } = {}) {
  if (typeof verify !== "function") throw new Error("A target-fit verifier is required.");
  const input = Array.isArray(prospects) ? prospects : [];
  const output = [...input];
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < input.length) {
      const index = cursor;
      cursor += 1;
      const prospect = input[index];
      try {
        const targetFit = await verify(buildProspectAuditRequest(prospect, gmailContext), prospect);
        output[index] = {
          ...prospect,
          targetFit,
          auditStatus: "complete",
          auditedBy: operator,
          auditedAt: targetFit.checkedAt || new Date().toISOString(),
        };
      } catch (error) {
        output[index] = {
          ...prospect,
          auditStatus: "error",
          auditError: error instanceof Error ? error.message : "AI audit failed.",
          auditedBy: operator,
        };
      }
      completed += 1;
      await onProgress({ prospect: output[index], index, completed, total: input.length, results: output });
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), input.length || 1) }, worker));
  return output;
}
