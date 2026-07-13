# Vela GTM specification

## V — Invariants

- **V1 — LinkedIn SDUI extraction.** When a rendered LinkedIn profile exposes a semantic `Topcard` section and dated `Experience` rows, Vela GTM must recover the visible name, headline, location, and work history without depending on LinkedIn's generated class names.
- **V2 — OpenAI key boundary.** The internal build may store an OpenAI key in the extension's Chrome profile for background-worker calls, but must never expose it to a LinkedIn tab, generated prompt, queue record, or log; production deployment remains server-side.
- **V3 — LinkedIn contact email.** Email discovery must discreetly try a freshly constructed contact-details RSC request with the current page session, then fall back to LinkedIn's rendered `/overlay/contact-info/` UI; both paths must extract a valid `mailto:` address without storing or replaying HAR credentials.
- **V4 — Prospect identity.** A normalized LinkedIn `/in/` URL is the queue identity; repeated imports update one prospect instead of creating duplicate outreach rows.
- **V5 — Human-reviewed Gmail.** Gmail integration may create reviewable drafts with compose-only OAuth access, but must never send messages or rotate sender accounts automatically.
- **V6 — Provider credential boundary.** Internal-build ContactOut and OpenAI keys may be stored in the extension's Chrome profile and read only by its background worker; they must never be injected into LinkedIn tabs, included in queue records, or logged. Production deployment moves them server-side.
- **V7 — Automatic contact resolution.** Opening or researching a profile starts ContactOut automatically: Contact Info Single first, People Enrich second, broad profile enrichment last; LinkedIn Contact Info is the final fallback and all returned addresses remain visible for review.

## I — External surfaces

- **I1 — LinkedIn people search.** Open a native LinkedIn people-result URL and capture only profile links currently rendered in the signed-in user's browser.
- **I2 — Gmail drafts.** `POST https://gmail.googleapis.com/gmail/v1/users/me/drafts` with a base64url RFC 2822 message and `gmail.compose` authorization.
- **I3 — AI writer.** Existing configured writer endpoint accepts structured profile context and returns subject, body, and personalization note.
- **I4 — ContactOut enrichment.** `GET https://api.contactout.com/v1/linkedin/enrich?profile=...` using a server-side `token` header.

## T — Build plan

| id | status | task | cites |
|---|---|---|---|
| T1 | x | add normalized prospect queue and bulk import | V4 |
| T2 | x | add LinkedIn people search launch and visible-result capture | I1,V4 |
| T3 | x | process queued profiles sequentially through contact and writer flows | V2,V3,I3 |
| T4 | x | create Gmail drafts with compose-only OAuth | V5,I2 |
| T5 | x | expose queue from popup and document setup | V4,V5 |
| T6 | x | add server-side ContactOut fallback and normalized profile context | V3,V6,I4 |
| T7 | x | remove local-server requirement with background provider worker and automatic multi-endpoint contact resolution | V6,V7,I4 |
| T8 | x | add OpenAI search-planning agent and direct background writing | V2,V6,I3 |

## B — Bug history

- **B1 · 2026-07-13 · V1.** The extractor assumed a `main h1` and `span[aria-hidden='true']` nodes. LinkedIn's current SDUI profile renders its top card with an `h2`, ordinary text nodes, and opaque classes, leaving headline, location, and experience empty even though they were visible.
- **B2 · 2026-07-13 · V3.** Email extraction only inspected the base profile DOM, while LinkedIn exposes the address after its `ProfileContactDetailsOverlay` navigation renders a `mailto:` link.
