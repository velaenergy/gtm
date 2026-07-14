import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_BACKUP_STORAGE_KEY,
  createWorkspaceBackup,
  workspaceRecoveryPatch,
} from "../lib/workspace-persistence.js";
import { CAMPAIGNS_STORAGE_KEY } from "../lib/campaigns.js";
import { QUEUE_STORAGE_KEY } from "../lib/queue.js";

const NOW = "2026-07-13T20:00:00.000Z";
const queue = [{ id: "https://www.linkedin.com/in/ben-kurian", name: "Ben Kurian" }];
const campaigns = [{ id: "security-leaders", name: "Security leaders", prospectIds: [queue[0].id] }];

test("V23 restores campaign and queue collections when an extension update leaves primary keys missing", () => {
  const backup = createWorkspaceBackup({ queue, campaigns }, NOW);
  const patch = workspaceRecoveryPatch({ [WORKSPACE_BACKUP_STORAGE_KEY]: backup });
  assert.deepEqual(patch, {
    [QUEUE_STORAGE_KEY]: queue,
    [CAMPAIGNS_STORAGE_KEY]: campaigns,
  });
});

test("V23 never resurrects an intentionally empty primary campaign list", () => {
  const backup = createWorkspaceBackup({ queue, campaigns }, NOW);
  const patch = workspaceRecoveryPatch({
    [QUEUE_STORAGE_KEY]: queue,
    [CAMPAIGNS_STORAGE_KEY]: [],
    [WORKSPACE_BACKUP_STORAGE_KEY]: backup,
  });
  assert.deepEqual(patch, {});
});

test("V23 rejects malformed workspace backups", () => {
  assert.deepEqual(workspaceRecoveryPatch({
    [WORKSPACE_BACKUP_STORAGE_KEY]: { schemaVersion: 1, queue: "bad", campaigns },
  }), {});
});
