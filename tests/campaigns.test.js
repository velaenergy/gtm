import assert from "node:assert/strict";
import test from "node:test";
import {
  addProspectToCampaign,
  campaignProspects,
  campaignsForProspect,
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  removeProspectFromCampaign,
  updateCampaign,
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

test("edits campaign details without changing identity or membership", () => {
  const original = createCampaign({
    id: "operators",
    name: "Operators",
    description: "Original description",
    prospectIds: ["https://www.linkedin.com/in/joshua-rivera"],
  }, NOW);
  const [updated] = updateCampaign([original], "operators", {
    name: "Critical infrastructure operators",
    description: "Power and uptime leaders",
  }, "2026-07-13T13:00:00.000Z");
  assert.equal(updated.id, "operators");
  assert.equal(updated.name, "Critical infrastructure operators");
  assert.equal(updated.description, "Power and uptime leaders");
  assert.deepEqual(updated.prospectIds, original.prospectIds);
});

test("duplicates and deletes campaigns without changing the source", () => {
  const source = createCampaign({
    id: "operators",
    name: "Operators",
    prospectIds: ["https://www.linkedin.com/in/joshua-rivera"],
  }, NOW);
  const campaigns = duplicateCampaign([source], source.id, "2026-07-13T13:00:00.000Z");
  assert.equal(campaigns.length, 2);
  assert.equal(campaigns[1].name, "Operators copy");
  assert.deepEqual(campaigns[1].prospectIds, source.prospectIds);
  assert.notEqual(campaigns[1].prospectIds, source.prospectIds);
  assert.deepEqual(deleteCampaign(campaigns, source.id).map((campaign) => campaign.name), ["Operators copy"]);
});

test("adds and removes spreadsheet-only prospects by email identity", () => {
  let campaigns = [createCampaign({ id: "buyers", name: "Energy buyers" }, NOW)];
  campaigns = addProspectToCampaign(campaigns, "buyers", "Maya@Example.com", NOW);
  assert.deepEqual(campaigns[0].prospectIds, ["email:maya@example.com"]);
  campaigns = removeProspectFromCampaign(campaigns, "buyers", "maya@example.com", NOW);
  assert.deepEqual(campaigns[0].prospectIds, []);
});
