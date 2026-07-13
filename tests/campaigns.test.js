import assert from "node:assert/strict";
import test from "node:test";
import {
  addProspectToCampaign,
  campaignProspects,
  campaignsForProspect,
  createCampaign,
  removeProspectFromCampaign,
} from "../lib/campaigns.js";
import { upsertProspects } from "../lib/queue.js";

const NOW = "2026-07-13T12:00:00.000Z";

test("creates named campaigns with stable normalized membership", () => {
  const campaign = createCampaign({
    name: "Data Center Operators",
    prospectIds: ["https://linkedin.com/in/Joshua-Rivera?trk=one", "https://www.linkedin.com/in/joshua-rivera"],
  }, NOW);
  assert.equal(campaign.name, "Data Center Operators");
  assert.equal(campaign.id, "data-center-operators-mrj67400");
  assert.deepEqual(campaign.prospectIds, ["https://www.linkedin.com/in/joshua-rivera"]);
});

test("adds one prospect to multiple campaigns without duplicating membership", () => {
  const campaigns = [
    createCampaign({ id: "operators", name: "Operators" }, NOW),
    createCampaign({ id: "buyers", name: "Energy buyers" }, NOW),
  ];
  const url = "https://www.linkedin.com/in/joshua-rivera";
  const inOperators = addProspectToCampaign(campaigns, "operators", url, NOW);
  const repeated = addProspectToCampaign(inOperators, "operators", `${url}?trk=again`, NOW);
  const inBoth = addProspectToCampaign(repeated, "buyers", url, NOW);
  assert.equal(inBoth[0].prospectIds.length, 1);
  assert.equal(campaignsForProspect(inBoth, url).length, 2);
});

test("campaign totals and removal stay scoped to campaign members", () => {
  const queue = upsertProspects([], [
    { url: "https://www.linkedin.com/in/joshua-rivera", workNote: "critical operations leadership" },
    { url: "https://www.linkedin.com/in/maya-chen", workNote: "energy strategy" },
  ], NOW);
  let campaigns = [createCampaign({ id: "operators", name: "Operators" }, NOW)];
  campaigns = addProspectToCampaign(campaigns, "operators", queue[0].url, NOW);
  assert.deepEqual(campaignProspects(queue, campaigns[0]).map((prospect) => prospect.workNote), ["critical operations leadership"]);
  campaigns = removeProspectFromCampaign(campaigns, "operators", queue[0].url, NOW);
  assert.equal(campaignProspects(queue, campaigns[0]).length, 0);
});
