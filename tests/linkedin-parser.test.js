import test from "node:test";
import assert from "node:assert/strict";

await import("../lib/linkedin-parser.js");

const { emailFromFlightResponse, emailFromMailto, parseExperienceLines, parseTopCardLines } = globalThis.VelaLinkedInParser;

test("V3 extracts and validates an email from the rendered contact overlay mailto", () => {
  assert.equal(emailFromMailto("mailto:alex%40relay.energy?subject=Hello"), "alex@relay.energy");
  assert.equal(emailFromMailto("https://example.com/not-email"), "");
  assert.equal(emailFromMailto("mailto:not-an-email"), "");
  assert.equal(
    emailFromFlightResponse('"url":"mailto:alex@relay.energy","openInNewTab":true'),
    "alex@relay.energy",
  );
});

test("parses a LinkedIn SDUI top card without relying on generated classes", () => {
  const result = parseTopCardLines([
    "Alex Morgan",
    "They/Them",
    "· 2nd",
    "Grid infrastructure operator | Founder at Relay",
    "Relay · State University",
    "Austin, Texas, United States",
    "Contact info",
    "500+ connections",
  ], "Alex Morgan");

  assert.deepEqual(result, {
    name: "Alex Morgan",
    headline: "Grid infrastructure operator | Founder at Relay",
    location: "Austin, Texas, United States",
  });
});

test("parses dated experience rows from hydrated SDUI text", () => {
  const result = parseExperienceLines([
    "Experience",
    "Founder",
    "Relay · Self-employed",
    "Oct 2023 - Present · 2 yrs 9 mos",
    "Austin, Texas, United States · Hybrid",
    "Operations Lead",
    "Northstar Energy · Full-time",
    "Jan 2021 - Sep 2023 · 2 yrs 9 mos",
    "Remote",
    "Show all experiences",
  ]);

  assert.deepEqual(result, [
    {
      title: "Founder",
      company: "Relay",
      dates: "Oct 2023 - Present · 2 yrs 9 mos",
      location: "Austin, Texas, United States · Hybrid",
      details: "",
    },
    {
      title: "Operations Lead",
      company: "Northstar Energy",
      dates: "Jan 2021 - Sep 2023 · 2 yrs 9 mos",
      location: "Remote",
      details: "",
    },
  ]);
});
