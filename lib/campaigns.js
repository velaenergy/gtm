import { cleanText } from "./message.js";
import { prospectId } from "./queue.js";

export const CAMPAIGNS_STORAGE_KEY = "velaGtmCampaigns";

function campaignSlug(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "campaign";
}

function memberId(value = "") {
  return prospectId(value) || cleanText(value).toLowerCase();
}

export function createCampaign(input = {}, now = new Date().toISOString()) {
  const name = cleanText(input.name);
  if (!name) return null;
  const suffix = Number.isNaN(Date.parse(now)) ? String(now) : Date.parse(now).toString(36);
  return {
    id: cleanText(input.id) || `${campaignSlug(name)}-${suffix}`,
    name,
    description: cleanText(input.description),
    prospectIds: [...new Set((input.prospectIds || []).map(memberId).filter(Boolean))],
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function normalizeCampaigns(campaigns = []) {
  return campaigns.map((campaign) => createCampaign(campaign, campaign.updatedAt || campaign.createdAt)).filter(Boolean);
}

export function addProspectToCampaign(campaigns = [], campaignId = "", linkedInUrl = "", now = new Date().toISOString()) {
  const id = prospectId(linkedInUrl);
  if (!id) return normalizeCampaigns(campaigns);
  return normalizeCampaigns(campaigns).map((campaign) => campaign.id === campaignId ? {
    ...campaign,
    prospectIds: [...new Set([...campaign.prospectIds, id])],
    updatedAt: now,
  } : campaign);
}

export function removeProspectFromCampaign(campaigns = [], campaignId = "", linkedInUrl = "", now = new Date().toISOString()) {
  const id = prospectId(linkedInUrl) || cleanText(linkedInUrl).toLowerCase();
  return normalizeCampaigns(campaigns).map((campaign) => campaign.id === campaignId ? {
    ...campaign,
    prospectIds: campaign.prospectIds.filter((prospect) => prospect !== id),
    updatedAt: now,
  } : campaign);
}

export function removeProspectFromAllCampaigns(campaigns = [], linkedInUrl = "", now = new Date().toISOString()) {
  const id = prospectId(linkedInUrl) || cleanText(linkedInUrl).toLowerCase();
  return normalizeCampaigns(campaigns).map((campaign) => campaign.prospectIds.includes(id) ? {
    ...campaign,
    prospectIds: campaign.prospectIds.filter((prospect) => prospect !== id),
    updatedAt: now,
  } : campaign);
}

export function campaignProspects(queue = [], campaign = null) {
  if (!campaign) return [];
  const members = new Set(campaign.prospectIds || []);
  return queue.filter((prospect) => members.has(prospect.id || prospectId(prospect.url)));
}

export function campaignsForProspect(campaigns = [], linkedInUrl = "") {
  const id = prospectId(linkedInUrl) || cleanText(linkedInUrl).toLowerCase();
  return normalizeCampaigns(campaigns).filter((campaign) => campaign.prospectIds.includes(id));
}
