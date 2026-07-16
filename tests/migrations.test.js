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

test("[V52] Gmail sender removal is one authenticated database transaction", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260716194202_deactivate_gmail_sender_atomically.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function public\.deactivate_gmail_sender/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /update public\.gmail_accounts[\s\S]*set is_active = false/i);
  assert.match(sql, /update public\.approved_senders[\s\S]*set is_active = false/i);
  assert.match(sql, /if not found then[\s\S]*no longer registered/i);
  assert.match(sql, /revoke all[\s\S]*from public, anon/i);
  assert.match(sql, /grant execute[\s\S]*to authenticated/i);
});

test("[V59] active team members can durably delete shared prospects", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260716205758_allow_team_members_delete_prospects.sql", import.meta.url), "utf8");
  assert.match(sql, /grant delete on public\.prospects to authenticated/i);
  assert.match(sql, /on public\.prospects for delete to authenticated/i);
  assert.match(sql, /using \(\(select private\.is_vela_member\(\)\)\)/i);
});
