import { CAMPAIGNS_STORAGE_KEY } from "./campaigns.js";
import { QUEUE_STORAGE_KEY } from "./queue.js";

export const WORKSPACE_BACKUP_STORAGE_KEY = "velaGtmWorkspaceBackupV1";
export const WORKSPACE_BACKUP_SCHEMA_VERSION = 1;

export function createWorkspaceBackup({ queue = [], campaigns = [] } = {}, now = new Date().toISOString()) {
  return {
    schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
    queue: Array.isArray(queue) ? queue : [],
    campaigns: Array.isArray(campaigns) ? campaigns : [],
    updatedAt: now,
  };
}

export function validWorkspaceBackup(value) {
  return Boolean(
    value
    && value.schemaVersion === WORKSPACE_BACKUP_SCHEMA_VERSION
    && Array.isArray(value.queue)
    && Array.isArray(value.campaigns),
  );
}

export function workspaceRecoveryPatch(saved = {}) {
  const backup = saved[WORKSPACE_BACKUP_STORAGE_KEY];
  if (!validWorkspaceBackup(backup)) return {};
  const patch = {};
  if (!Array.isArray(saved[QUEUE_STORAGE_KEY])) patch[QUEUE_STORAGE_KEY] = backup.queue;
  if (!Array.isArray(saved[CAMPAIGNS_STORAGE_KEY])) patch[CAMPAIGNS_STORAGE_KEY] = backup.campaigns;
  return patch;
}
