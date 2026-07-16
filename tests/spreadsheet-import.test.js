import assert from "node:assert/strict";
import test from "node:test";

import {
  guessColumnMapping,
  historicalDeliveryRecords,
  mappedRowsToProspects,
} from "../lib/spreadsheet-import.js";
import { OUTREACH_SUBJECT } from "../lib/message.js";

const SOURCE_HEADERS = ["First Name", "Last Name", "Note about work", "Recipient", "Email Sent", "Subject", "Message"];

test("recognizes common outreach spreadsheet columns without an export contract", () => {
  assert.deepEqual(guessColumnMapping(SOURCE_HEADERS), ["firstName", "lastName", "workNote", "email", "emailSentAt", "subject", "body"]);
});

test("imports source rows as reviewable prospects", () => {
  const result = mappedRowsToProspects({
    mapping: ["firstName", "lastName", "workNote", "email", "emailSentAt"],
    rows: [["Malay", "Mitra", "your green ammonia work", "malay@example.com", ""]],
  });
  assert.equal(result.prospects.length, 1);
  assert.equal(result.prospects[0].email, "malay@example.com");
  assert.equal(result.prospects[0].status, "ready");
  assert.equal(result.prospects[0].subject, OUTREACH_SUBJECT);
});

test("converts imported sent dates into central activity records", () => {
  const sentAt = "2026-03-02T12:13:10.000Z";
  const result = mappedRowsToProspects({
    mapping: ["firstName", "lastName", "workNote", "email", "emailSentAt", "subject", "body"],
    rows: [["Maya", "Chen", "your energy strategy work", "maya@example.com", sentAt, "Power strategy", "Hi Maya"]],
  });
  const records = historicalDeliveryRecords(result.prospects);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].recipients, ["maya@example.com"]);
  assert.equal(records[0].completedAt, sentAt);
  assert.equal(records[0].mode, "imported");
  assert.equal(records[0].subject, "Power strategy");
});
