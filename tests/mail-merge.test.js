import assert from "node:assert/strict";
import test from "node:test";
import { MAIL_MERGE_HEADERS, guessColumnMapping, mailMergeRows, mappedRowsToProspects } from "../lib/mail-merge.js";
import { QUEUE_STATUS } from "../lib/queue.js";

test("maps the supplied MailMerge workbook headers", () => {
  assert.deepEqual(guessColumnMapping(MAIL_MERGE_HEADERS), ["firstName", "lastName", "workNote", "email", "emailSentAt", "subject", "body"]);
  assert.deepEqual(guessColumnMapping(["First Name", "Last Name", "Note about work", "Email"]), ["firstName", "lastName", "workNote", "email"]);
});

test("turns mapped spreadsheet rows into reviewable prospects", () => {
  const { prospects, rejected } = mappedRowsToProspects({
    mapping: ["firstName", "lastName", "workNote", "email", "emailSentAt"],
    rows: [["Alicia", "Ruckteschler", "your procurement leadership", "alicia@example.com", ""]],
  });
  assert.equal(rejected.length, 0);
  assert.equal(prospects[0].name, "Alicia Ruckteschler");
  assert.equal(prospects[0].status, QUEUE_STATUS.READY);
  assert.match(prospects[0].body, /your procurement leadership/);
});

test("preserves sent tracking and exact export shape", () => {
  const sentAt = "2026-03-02T12:13:10.000Z";
  const { prospects } = mappedRowsToProspects({
    mapping: ["firstName", "lastName", "workNote", "email", "emailSentAt"],
    rows: [["Malay", "Mitra", "your green ammonia work", "malay@example.com", sentAt]],
  });
  assert.equal(prospects[0].status, QUEUE_STATUS.SENT);
  assert.equal(prospects[0].emailSentAt, sentAt);
  const rows = mailMergeRows(prospects);
  assert.deepEqual(rows[0].slice(0, 4), ["Malay", "Mitra", "your green ammonia work", "malay@example.com"]);
  assert.equal(rows[0][4].toISOString(), sentAt);
});

test("round-trips agent-written subject and message into MailMerge columns", () => {
  const { prospects } = mappedRowsToProspects({
    mapping: ["firstName", "email", "workNote", "subject", "body"],
    rows: [["Maya", "maya@example.com", "your energy strategy work", "Power strategy", "Hi Maya,\n\nWould love to connect."]],
  });
  assert.equal(prospects[0].subject, "Power strategy");
  assert.equal(prospects[0].body, "Hi Maya,\n\nWould love to connect.");
  assert.deepEqual(mailMergeRows(prospects)[0].slice(5), ["Power strategy", "Hi Maya,\n\nWould love to connect."]);
});

test("rejects rows without a recipient identity", () => {
  const result = mappedRowsToProspects({ mapping: ["firstName", "lastName"], rows: [["No", "Email"]] });
  assert.equal(result.prospects.length, 0);
  assert.deepEqual(result.rejected, [{ row: 2, reason: "Add a recipient email or LinkedIn URL." }]);
});
