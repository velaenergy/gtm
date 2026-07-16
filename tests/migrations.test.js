import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("[V45] prospect updates preserve durable spreadsheet import evidence", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260716083851_preserve_prospect_import_evidence.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function private\.preserve_prospect_import_evidence\(\)/i);
  assert.match(sql, /old\.payload\s*->\s*'importEvidence'/i);
  assert.match(sql, /previous_evidence\s*\|\|\s*incoming_evidence/i);
  assert.match(sql, /create trigger preserve_prospect_import_evidence/i);
  assert.match(sql, /before update of payload on public\.prospects/i);
});
