# Vela GTM specification

## V — Invariants

- **V1 — LinkedIn SDUI extraction.** When a rendered LinkedIn profile exposes a semantic `Topcard` section and dated `Experience` rows, Vela GTM must recover the visible name, headline, location, and work history without depending on LinkedIn's generated class names.
- **V2 — OpenAI key boundary.** The internal build may store an OpenAI key in the extension's Chrome profile for background-worker calls, but must never expose it to a LinkedIn tab, generated prompt, queue record, or log; production deployment remains server-side.
- **V3 — Verified recipient boundary.** Recipient ∈ ContactOut `verified` | Email Verifier `valid` | browser-session `confidence_level=high && is_guess=false`. `accept_all`, `invalid`, `disposable`, `unknown`, guessed, LinkedIn-visible, manually entered → unverified; automatic send ⊥.
- **V4 — Prospect identity.** A normalized LinkedIn `/in/` URL is the preferred queue identity. Spreadsheet-only prospects use a normalized recipient email identity; repeated imports update one prospect instead of creating duplicate outreach rows.
- **V5 — Reviewed Gmail delivery.** Every delivery requires an explicit final click, reviewed subject/body, verified recipient selection, and exact sender selection. Vela may request `gmail.send`, must re-verify authorization still belongs to that saved email, and may send directly; without a connected sender, the same action must open one prefilled Gmail composer per recipient for manual review and Send. Recipient selection is single-address by default; multiple selection requires an explicit Settings opt-in. Vela must never rotate sender accounts or expose one recipient address to another.
- **V9 — Mail-merge round trip.** The current campaign, filtered view, or explicit selection may be exported as a local `.xlsx` workbook. The workbook begins with the supplied `First Name`, `Last Name`, `Note about work`, `Recipient`, and `Email Sent` contract and appends `Subject` and `Message` for complete draft round-tripping.
- **V6 — Provider credential boundary.** ContactOut browser cookies remain inside `contactout.com` page; cookie values → storage/messages/logs ⊥. MV3 state stores installation ID + single-use ≤10m reveal approval only. Optional API/OpenAI keys stay background-only; production keys → server.
- **V7 — Credit-bounded contact resolution.** With automatic research enabled, navigating to a new LinkedIn profile authorizes at most one ContactOut browser-session reveal for that profile in the current side-panel session: masked preview → verification poll → reveal → remaining balance metadata. Repeated same-profile refreshes must not spend another credit automatically; the explicit `Refresh` button may retry. Queue approval still names the exact selected count + maximum credits. API token fallback follows Contact Info → People Enrich → broad profile → Email Verifier.
- **V10 — AI-grounded personalization.** After verified enrichment, the OpenAI writer receives bounded work context. In personalization-only mode it may change only `workNote`, while the editable workspace subject/body template remains exact; full-email mode is an explicit opt-in. `workNote` must be a direct-address noun phrase that is grammatical after the template's literal `impressed by` slot, never a third-person name possessive. Provider context is never permission to invent facts.
- **V11 — Lookup fallback order.** ∀ lookup → ContactOut browser session → ContactOut API? → Apollo? → LinkedIn RSC → rendered Contact Info. Provider success ⊥ later call. LinkedIn result ≠ ContactOut-verified.
- **V8 — Campaign lifecycle.** Campaigns reference normalized prospect identity; add from profile ! persist current personalization note before membership; rename/duplicate/delete ! preserve the underlying prospect records; campaign totals and exports ! contain campaign members only.
- **V12 — Local activity ledger.** Import, research, review, export, and manually marked sent events are stored per prospect in the Chrome profile. Imported `Email Sent` timestamps must round-trip through later exports.
- **V13 — Credential visibility.** Internal API keys remain masked by default and may be revealed only through an explicit per-field control on the settings page.
- **V14 — Durable scheduled delivery.** Scheduled jobs persist in Chrome storage without OAuth tokens and run through `chrome.alarms`; startup recreates missing alarms. Persistent schedule mode uses the next local occurrence of the chosen time for each explicit send action and remains enabled until the user turns it off.
- **V15 — Reusable templates.** Settings stores named subject/body templates with stable IDs. Side-panel template selection uses those saved templates and preserves supported merge variables.
- **V16 — ContactOut bridge compatibility.** Private lookup ! execute from `contactout.com/extension/app/` + captured ContactOut client version, never Vela manifest version. Provider and LinkedIn calls ! bounded timeout; first provider failure remains observable.
- **V17 — Native reveal parity + safe diagnostics.** ContactOut encrypted response's canonical profile/member fields → reveal body; preview + reveal stay on `/extension/app/`, client `5.6.18`, source `12`, absent verify job → `null`. Last 150 stage events may persist only allowlisted metadata; cookies, CSRF, keys, UUIDs, names, URLs, emails, phones ⊥.
- **V17 — Persistent profile workspace.** The toolbar action opens a Chrome side panel rather than a transient action popup. The panel remains available while the user changes tabs and refreshes to the active LinkedIn `/in/` profile identity without treating same-profile overlays as a new prospect.
- **V18 — Delivery ledger.** Every accepted Gmail delivery attempt and every scheduled, cancelled, partial, failed, or completed job produces one bounded local record containing sender label, recipients, subject, mode, status, and timestamps. OAuth tokens and provider credentials → ledger ⊥.
- **V19 — Automatic writing and manual Gmail fallback.** Opening each new LinkedIn profile identity triggers exactly one AI writing attempt whether automatic contact research is enabled, skipped, or returns no address. When direct Gmail is disconnected, any syntactically valid visible or entered address may open a prefilled Gmail composer; Gmail API sends remain verified-recipient-only.
- **V20 — OAuth client-type routing.** The OAuth client declared in `manifest.json` may authorize Gmail only through `chrome.identity.getAuthToken`; it must never enter `launchWebAuthFlow`. Account-chooser Web OAuth is available only when Settings contains a distinct Web application client ID.
- **V21 — Connected Gmail account set.** User may connect multiple explicit Gmail identities and choose one in compose. Persisted account set contains normalized Google ID/email/auth mode only; OAuth tokens → storage ⊥. Immediate + scheduled delivery ! retain chosen `accountId` + sender label, re-verify token email before send, and auto-rotation ⊥. Legacy single sender migrates without disconnect.

## I — External surfaces

- **I1 — LinkedIn people search.** Open a native LinkedIn people-result URL and capture only profile links currently rendered in the signed-in user's browser.
- **I2 — MailMerge workbook.** Local `.xlsx` import/export uses stable `First Name`, `Last Name`, `Note about work`, `Recipient`, `Email Sent`, `Subject`, and `Message` columns; sending occurs outside Vela.
- **I4 — AI writer.** Existing configured writer endpoint accepts structured profile context, the generation mode, and the current draft.
- **I5 — ContactOut API fallback.** `GET /v1/people/linkedin`, `POST /v1/people/enrich`, `GET /v1/linkedin/enrich`, `GET /v1/email/verify`, `GET /v1/stats`; background-only `token`.
- **I6 — Gmail send.** `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with one base64url RFC 2822 message per verified recipient and `gmail.send` authorization.
- **I10 — Manual Gmail handoff.** `https://mail.google.com/mail/?view=cm&fs=1` with URL-encoded `to`, `su`, and `body`; Vela opens the reviewed composer but does not click Gmail's Send control.
- **I7 — Scheduled jobs.** `chrome.storage.local` queue + one-shot `chrome.alarms` entries keyed by job ID; alarm handler sends with the stored Google account ID and records sent or failed state.
- **I8 — ContactOut browser bridge.** MAIN-world `contactout.com` request → `GET /api/user/info`, `POST /api/v5/profiles/encrypted`, `POST /api/email/verify/status`, approved `POST /api/v5/profiles/reveal`; cookies/CSRF stay page-owned.
- **I9 — Chrome side panel.** Manifest V3 `side_panel.default_path` + `sidePanel` permission; background worker calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` so the toolbar action opens Vela beside the active page.
- **I11 — Google authorization.** Default: manifest Chrome-extension OAuth client → `chrome.identity.getAuthToken` → current Chrome profile + `gmail.send`. Multi-account chooser: distinct Google Web application client → `chrome.identity.launchWebAuthFlow` with `prompt=select_account` → exact `https://<extension-id>.chromiumapp.org/google` redirect → transient `gmail.send` + `userinfo.email` token. Persisted state contains connected account IDs/emails/auth modes + selected account ID only; token storage ⊥.

## T — Build plan

| id | status | task | cites |
|---|---|---|---|
| T1 | x | add normalized prospect queue and bulk import | V4 |
| T2 | x | add LinkedIn people search launch and visible-result capture | I1,V4 |
| T3 | x | process queued profiles sequentially through contact and writer flows | V2,V3,I4 |
| T4 | x | replace Gmail draft OAuth with reviewed MailMerge export | V5,I2 |
| T5 | x | expose queue from popup and document setup | V4,V5 |
| T6 | x | add server-side ContactOut fallback and normalized profile context | V3,V6,I5 |
| T7 | x | remove local-server requirement with background provider worker and automatic multi-endpoint contact resolution | V6,V7,I5 |
| T8 | x | add OpenAI search-planning agent and direct background writing | V2,V6,I4 |
| T9 | x | add named campaigns, profile save action, scoped totals, and export | V4,V8 |
| T10 | x | restore popup ContactOut → LinkedIn contact fallback | V3,V7,V11,I5 |
| T11 | x | add campaign edit/duplicate/delete and complete MailMerge round trip | V5,V8,V9,I2 |
| T12 | x | add mapped Excel/CSV import and email-only prospect identity | V4,V9,I2 |
| T13 | x | add personalization-only AI mode and editable workspace template | V10,I4 |
| T14 | x | add per-key reveal controls and local workflow tracking | V12,V13 |
| T15 | x | add reusable named email templates in Settings and popup | V10,V15 |
| T16 | x | replace Gmail compose handoff with reviewed direct send and verified recipient selection | V3,V5,I6 |
| T17 | x | add persistent next-time scheduling and durable background delivery | V5,V14,I6,I7 |
| T18 | x | add ContactOut browser-session bridge + one-click side-panel reveal authorization | V3,V6,V7,V11,I8 |
| T19 | x | replace account enumeration with primary-profile Gmail-only OAuth and remove Google Sheets cloud export | V5,V9,I2,I6 |
| T19 | x | replace the transient toolbar popup with a cross-tab Chrome side panel | V17,I9 |
| T20 | x | add overview, AI research, review, scheduled, and delivery-history control-room views | V12,V14,V18 |
| T21 | x | clarify ContactOut browser/API health states and make multi-recipient selection opt-in | V5,V6,V17 |
| T22 | x | fall back to prefilled manual Gmail composers when direct Gmail is disconnected | V3,V5,I10 |
| T23 | x | replace primary-profile-only Gmail setup with an explicitly selected Google sender | V5,I6,I11 |
| T24 | x | add connected Gmail account set + compose sender picker + account-pinned delivery | V5,V20,V21,I6,I7,I11 |

## B — Bug history

- **B1 · 2026-07-13 · V1.** The extractor assumed a `main h1` and `span[aria-hidden='true']` nodes. LinkedIn's current SDUI profile renders its top card with an `h2`, ordinary text nodes, and opaque classes, leaving headline, location, and experience empty even though they were visible.
- **B2 · 2026-07-13 · V3.** Email extraction only inspected the base profile DOM, while LinkedIn exposes the address after its `ProfileContactDetailsOverlay` navigation renders a `mailto:` link.
- **B3 · 2026-07-13 · V11.** Verified-only popup refactor returned on ContactOut miss or error → LinkedIn fallback never ran.
- **B4 · 2026-07-13 · V16.** Session check accepted Vela `0.6.0` on `/login/callback`, but private lookup required ContactOut's extension-app context/client contract; popup hid the bridge failure behind API sample/Apollo fallbacks and an unbounded LinkedIn wait.
- **B5 · 2026-07-13 · V17.** Native ContactOut preview accepted member `0`, resolved the canonical member ID, then revealed with that returned descriptor on `/extension/app/`; Vela retained member `0` and could switch reveal back to the login tab, with no safe stage log to expose the divergence.
- **B5 · 2026-07-13 · V5.** Gmail setup depended on `chrome.identity.getAccounts()`, leaving supported Chrome installs stuck on “Update Chrome”; connection now authorizes and labels the primary Chrome profile through stable Identity APIs and requests only `gmail.send`.
- **B6 · 2026-07-13 · V7,V10.** The side panel asked for a second credit confirmation after the user already clicked `Find verified`, while AI output could return a third-person phrase such as `Jonathan's progression…` that became awkward inside `impressed by {{workNote}}`. The manual lookup click now authorizes one reveal, remaining credits render as metadata, and writer output is prompted and normalized for the exact template slot.
- **B7 · 2026-07-13 · V7,V10.** New LinkedIn profiles stopped at a ready state and still required `Find verified`, while the default email read as disconnected praise, company boilerplate, and ask blocks. New profile identities now start one guarded enrichment/personalization run automatically, and untouched legacy quick-intro templates migrate to a tighter founder intro → specific reason → call request structure.
- **B8 · 2026-07-13 · V5.** Stable Chrome's `identity.getAuthToken()` silently chose the profile's sync/first Google account and `identity.getAccounts()` remained Dev-channel-only, so an external primary account could hit `org_internal` before any chooser appeared. Google delivery now uses a Web OAuth client with `select_account`, verifies the returned email, and binds future sends to that selected sender.
- **B9 · 2026-07-13 · V19.** Disconnected Gmail reused the direct-send verified-recipient list, leaving **Open Gmail** disabled for valid visible addresses, while profile startup tied AI writing to successful automatic contact enrichment. Manual compose now accepts a valid current address without weakening direct-send verification, every new profile starts one AI write, and redirect mismatch errors name the exact Web-client URI Google Cloud must authorize.
- **B10 · 2026-07-13 · V20.** Settings accepted the manifest's Chrome-extension client ID as if it were a Web application client and passed it to `launchWebAuthFlow`, so Google deterministically returned `redirect_uri_mismatch`. OAuth strategy selection now routes that client through `getAuthToken` and permits the redirect flow only for a distinct optional Web client.
