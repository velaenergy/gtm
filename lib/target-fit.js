import { cleanText } from "./message.js";

export const VELA_TARGET_CONTEXT = `Vela Energy builds AI agents that help large energy loads get powered on faster. Strong prospects directly own or influence data-center, AI infrastructure, industrial-load, power procurement, interconnection, utility strategy, site selection, critical facilities, infrastructure development, or energy-intensive operations decisions. Favor people with operating responsibility and a credible reason to discuss power availability, utilities, interconnection, procurement, or speed-to-power.`;

export function buildTargetFitRequest(profile = {}, context = VELA_TARGET_CONTEXT) {
  return {
    context: cleanText(context),
    profile: {
      name: cleanText(profile.name),
      headline: cleanText(profile.headline),
      location: cleanText(profile.location),
      about: cleanText(profile.about).slice(0, 2400),
      industry: cleanText(profile.industry || profile.enrichment?.industry),
      company: cleanText(profile.company?.name || profile.enrichment?.company?.name),
      experiences: (Array.isArray(profile.experiences) ? profile.experiences : []).slice(0, 6).map((item) => ({
        title: cleanText(item.title), company: cleanText(item.company), details: cleanText(item.details).slice(0, 700), dates: cleanText(item.dates),
      })),
      skills: (Array.isArray(profile.skills || profile.enrichment?.skills) ? (profile.skills || profile.enrichment.skills) : []).slice(0, 15).map(cleanText),
    },
  };
}

export function normalizeTargetFit(payload = {}) {
  const data = payload.data || payload.fit || payload;
  const score = Math.min(100, Math.max(0, Number(data.score) || 0));
  const verdict = ["strong", "review", "skip"].includes(data.verdict) ? data.verdict : score >= 75 ? "strong" : score >= 45 ? "review" : "skip";
  return {
    verdict,
    score,
    reason: cleanText(data.reason).slice(0, 360),
    evidence: (Array.isArray(data.evidence) ? data.evidence : []).map(cleanText).filter(Boolean).slice(0, 3),
    checkedAt: data.checkedAt || data.checked_at || new Date().toISOString(),
    model: cleanText(payload.model || data.model),
  };
}

export function calibrateTargetFit(payload = {}, input = {}) {
  const fit = normalizeTargetFit(payload);
  if (fit.verdict !== "review") return fit;
  const profile = input?.profile || {};
  const title = cleanText(profile.experiences?.[0]?.title || profile.headline);
  if (!title) return fit;
  const hasLeadership = /\b(?:chief|vice president|vp|head|director|manager|lead)\b/i.test(title);
  const hasDirectDomain = /\b(?:energy|power|utility|utilities|interconnection)\b|\bsite\s+(?:selection|acquisition|development)\b|\bcritical\s+facilit(?:y|ies)\b|\bdata\s+cent(?:er|re)\b/i.test(title);
  const isUnrelatedFunction = /\b(?:sales|marketing|recruit(?:ing|ment)?|talent|human resources|account executive|customer success|communications?)\b/i.test(title);
  if (!hasLeadership || !hasDirectDomain || isUnrelatedFunction) return fit;
  return {
    ...fit,
    verdict: "strong",
    score: Math.max(80, fit.score),
    reason: `${title} directly names a current leadership role in Vela's target decision area.`,
    evidence: [...new Set([title, ...fit.evidence])].slice(0, 3),
  };
}
