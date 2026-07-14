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
  const clean = cleanText(value).toLowerCase();
  if (clean.startsWith("email:")) return clean;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return `email:${clean}`;
  return prospectId(clean) || clean;
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

export function updateCampaign(campaigns = [], campaignId = "", updates = {}, now = new Date().toISOString()) {
  const name = cleanText(updates.name);
  if (!name) return normalizeCampaigns(campaigns);
  return normalizeCampaigns(campaigns).map((campaign) => campaign.id === campaignId ? {
    ...campaign,
    name,
    description: cleanText(updates.description),
    updatedAt: now,
  } : campaign);
}

export function duplicateCampaign(campaigns = [], campaignId = "", now = new Date().toISOString()) {
  const normalized = normalizeCampaigns(campaigns);
  const source = normalized.find((campaign) => campaign.id === campaignId);
  if (!source) return normalized;
  const names = new Set(normalized.map((campaign) => campaign.name.toLowerCase()));
  let name = `${source.name} copy`;
  let copyNumber = 2;
  while (names.has(name.toLowerCase())) {
    name = `${source.name} copy ${copyNumber}`;
    copyNumber += 1;
  }
  const copy = createCampaign({
    name,
    description: source.description,
    prospectIds: source.prospectIds,
  }, now);
  return [...normalized, copy];
}

export function deleteCampaign(campaigns = [], campaignId = "") {
  return normalizeCampaigns(campaigns).filter((campaign) => campaign.id !== campaignId);
}

export function addProspectToCampaign(campaigns = [], campaignId = "", linkedInUrl = "", now = new Date().toISOString()) {
  const id = memberId(linkedInUrl);
  if (!id) return normalizeCampaigns(campaigns);
  return normalizeCampaigns(campaigns).map((campaign) => campaign.id === campaignId ? {
    ...campaign,
    prospectIds: [...new Set([...campaign.prospectIds, id])],
    updatedAt: now,
  } : campaign);
}

export function removeProspectFromCampaign(campaigns = [], campaignId = "", linkedInUrl = "", now = new Date().toISOString()) {
  const id = memberId(linkedInUrl);
  return normalizeCampaigns(campaigns).map((campaign) => campaign.id === campaignId ? {
    ...campaign,
    prospectIds: campaign.prospectIds.filter((prospect) => prospect !== id),
    updatedAt: now,
  } : campaign);
}

export function removeProspectFromAllCampaigns(campaigns = [], linkedInUrl = "", now = new Date().toISOString()) {
  const id = memberId(linkedInUrl);
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
  const id = memberId(linkedInUrl);
  return normalizeCampaigns(campaigns).filter((campaign) => campaign.prospectIds.includes(id));
}
