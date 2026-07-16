import test from "node:test";
import assert from "node:assert/strict";
import { buildContacts, filterContacts } from "../lib/contacts.js";

test("contacts merge imported prospects with team delivery activity", () => {
  const contacts = buildContacts({
    prospects: [{ id: "p1", name: "Maya Chen", email: "MAYA@example.com", source: "accounts.csv", profile: { experiences: [{ company: "Aperture" }] } }],
    deliveryLog: [
      { id: "d1", recipients: ["maya@example.com"], status: "sent", completedAt: "2026-07-15T10:00:00Z", operatorName: "Tarun" },
      { id: "d2", recipients: ["maya@example.com"], status: "sent", completedAt: "2026-07-15T11:00:00Z", operatorName: "Riddhiman" },
    ],
  });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].company, "Aperture");
  assert.equal(contacts[0].source, "Imported list");
  assert.equal(contacts[0].status, "Contacted");
  assert.equal(contacts[0].touches, 2);
  assert.deepEqual(contacts[0].operators, ["Tarun", "Riddhiman"]);
});

test("contacts keep uncontacted imports visible and support search and status filters", () => {
  const contacts = buildContacts({ prospects: [{ id: "p2", name: "Alex", email: "alex@example.com", source: "Spreadsheet import", company: "Vela" }] });
  assert.equal(contacts[0].status, "Imported");
  assert.equal(filterContacts(contacts, { query: "vela" }).length, 1);
  assert.equal(filterContacts(contacts, { status: "contacted" }).length, 0);
});

test("[V32] imported contact provenance never falls through to a generic tool label", () => {
  const [contact] = buildContacts({ prospects: [{ id: "one", name: "One", email: "one@example.com", source: "Imported list", activity: [{ type: "imported" }] }] });
  assert.equal(contact.source, "Imported list");
  assert.equal(contact.status, "Imported");
});

test("contacts promote Gmail bounces into delivery health and filtering", () => {
  const contacts = buildContacts({
    prospects: [{ id: "p3", name: "Noah", email: "noah@example.com", company: "Gridline", status: "sent" }],
    deliveryLog: [
      { id: "sent-1", recipients: ["noah@example.com"], status: "sent", completedAt: "2026-07-15T10:00:00Z" },
      { id: "bounce-1", recipients: ["noah@example.com"], status: "bounced", bounceType: "hard", bounceReason: "recipient_not_found", error: "550 5.1.1", completedAt: "2026-07-15T10:01:00Z" },
    ],
  });
  assert.equal(contacts[0].status, "Bounced");
  assert.equal(contacts[0].deliveryHealth, "hard bounce");
  assert.equal(contacts[0].bounceReason, "Address not found");
  assert.equal(contacts[0].lastActivityAt, "2026-07-15T10:01:00Z");
  assert.equal(filterContacts(contacts, { status: "bounced" }).length, 1);
});
