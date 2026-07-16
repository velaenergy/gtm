import assert from "node:assert/strict";
import test from "node:test";
import { buildTargetFitRequest, normalizeTargetFit } from "../lib/target-fit.js";
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
