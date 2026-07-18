import assert from "node:assert/strict";
import test from "node:test";
import { buildTargetFitRequest, calibrateTargetFit, normalizeTargetFit } from "../lib/target-fit.js";
import { buildTargetFitOpenAIRequest, verifyTargetFit } from "../server/target-fit.mjs";

test("builds bounded Vela fit context from Apollo work history", () => {
  const input = buildTargetFitRequest({ name: "Avery Smith", headline: "VP Power", experiences: [{ title: "VP Power", company: "Compute Co", details: "Owns interconnection and utility strategy." }] });
  assert.match(input.context, /large energy loads/i);
  assert.equal(input.profile.experiences[0].company, "Compute Co");
  assert.match(input.profile.experiences[0].details, /interconnection/);
});

test("uses one strict non-stored target-fit decision", async () => {
  const request = buildTargetFitOpenAIRequest({ profile: { name: "Avery" } });
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  const result = await verifyTargetFit({ profile: { name: "Avery" } }, {
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer test-key");
      return { ok: true, async json() { return { output_text: '{"verdict":"strong","score":91,"reason":"Owns interconnection strategy.","evidence":["VP Power"]}' }; } };
    },
  });
  assert.deepEqual({ verdict: result.verdict, score: result.score }, { verdict: "strong", score: 91 });
  assert.equal(normalizeTargetFit({ score: 20 }).verdict, "skip");
});

test("[V70] explicit current energy decision titles qualify from thin Apollo profiles", () => {
  const fit = { verdict: "review", score: 62, reason: "The title is relevant, but responsibilities are not described.", evidence: ["Director, Energy Procurement"] };
  const promoted = calibrateTargetFit(fit, {
    profile: { headline: "Director, Energy Procurement", experiences: [{ title: "Director, Energy Procurement", company: "Industrial Co" }] },
  });
  assert.equal(promoted.verdict, "strong");
  assert.ok(promoted.score >= 80);
  assert.match(promoted.reason, /directly names/i);

  assert.equal(calibrateTargetFit(fit, { profile: { headline: "Procurement Manager" } }).verdict, "review");
  assert.equal(calibrateTargetFit(fit, { profile: { headline: "Director of Energy Sales" } }).verdict, "review");
});
