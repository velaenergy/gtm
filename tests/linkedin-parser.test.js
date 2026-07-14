import test from "node:test";
import assert from "node:assert/strict";

await import("../lib/linkedin-parser.js");
await import("../lib/linkedin-launcher.js");

const { emailFromFlightResponse, emailFromMailto, memberIdFromMarkup, parseAboutLines, parseExperienceLines, parseTopCardLines } = globalThis.VelaLinkedInParser;
const { launcherVisibleForPath } = globalThis.VelaLinkedInLauncher;

test("V24 shows the Vela launcher only on supported LinkedIn people surfaces", () => {
  assert.equal(launcherVisibleForPath("/in/ben-kurian/"), true);
  assert.equal(launcherVisibleForPath("/search/results/people/"), true);
  assert.equal(launcherVisibleForPath("/feed/"), false);
});

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
    "Built software that helps utilities plan grid capacity.",
    "Led partnerships with large energy users.",
    "Operations Lead",
    "Northstar Energy · Full-time",
    "Jan 2021 - Sep 2023 · 2 yrs 9 mos",
    "Remote",
    "Owned interconnection strategy across new markets.",
    "Show all experiences",
  ]);

  assert.deepEqual(result, [
    {
      title: "Founder",
      company: "Relay",
      dates: "Oct 2023 - Present · 2 yrs 9 mos",
      location: "Austin, Texas, United States · Hybrid",
      details: "Built software that helps utilities plan grid capacity. Led partnerships with large energy users.",
    },
    {
      title: "Operations Lead",
      company: "Northstar Energy",
      dates: "Jan 2021 - Sep 2023 · 2 yrs 9 mos",
      location: "Remote",
      details: "Owned interconnection strategy across new markets.",
    },
  ]);
});

test("combines the visible About copy instead of dropping shorter text nodes", () => {
  assert.equal(parseAboutLines([
    "About",
    "I build infrastructure products for fast-growing energy users.",
    "Previously worked across utilities and data centers.",
    "See more",
  ]), "I build infrastructure products for fast-growing energy users. Previously worked across utilities and data centers.");
});

test("recovers the numeric LinkedIn member id nearest the active vanity name", () => {
  const markup = `{"entityUrn":"urn:li:fsd_profile:123456789","publicIdentifier":"alex-morgan"}`;
  assert.equal(memberIdFromMarkup(markup, "alex-morgan"), 123456789);
  assert.equal(memberIdFromMarkup(markup, "someone-else"), 0);
});
