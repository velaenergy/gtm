import assert from "node:assert/strict";
import test from "node:test";

import {
  excludePreviouslyContactedProspects,
  previouslyContactedIdentityKeys,
  sentResearchIdentityIndex,
} from "../lib/research-exclusions.js";

test("[V68] Research excludes Apollo people already sent to by LinkedIn or provider identity", () => {
  const index = sentResearchIdentityIndex({
    prospects: [
      { id: "https://www.linkedin.com/in/already-sent", url: "https://linkedin.com/in/already-sent/?trk=old", status: "sent" },
      { id: "apollo:provider-2", providerId: "provider-2", status: "ready", activity: [{ type: "send_partial" }] },
      { id: "apollo:not-sent", providerId: "not-sent", status: "ready" },
    ],
  });

  const result = excludePreviouslyContactedProspects([
    { providerId: "provider-1", url: "https://www.linkedin.com/in/already-sent" },
    { providerId: "provider-2" },
    { providerId: "not-sent" },
  ], index);

  assert.deepEqual(result.eligible.map((person) => person.providerId), ["not-sent"]);
  assert.deepEqual(result.excluded.map(({ prospect }) => prospect.providerId), ["provider-1", "provider-2"]);
});

test("[V68] Research re-checks enriched email against shared sent history", () => {
  const index = sentResearchIdentityIndex({
    deliveryLog: [
      { status: "sent", recipients: ["SENT@EXAMPLE.COM"] },
      { status: "partial", recipients: ["partial@example.com"] },
      { status: "scheduled", recipients: ["scheduled@example.com"] },
      { status: "failed", recipients: ["failed@example.com"] },
    ],
  });

  assert.deepEqual(previouslyContactedIdentityKeys({ contactDetails: { emails: ["sent@example.com"] } }, index), ["email:sent@example.com"]);
  assert.equal(previouslyContactedIdentityKeys({ email: "partial@example.com" }, index).length, 1);
  assert.equal(previouslyContactedIdentityKeys({ email: "scheduled@example.com" }, index).length, 0);
  assert.equal(previouslyContactedIdentityKeys({ email: "failed@example.com" }, index).length, 0);
});
