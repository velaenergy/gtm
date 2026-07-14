# Vela GTM

An internal Chrome extension with a persistent browser side panel and a full GTM control room for researched, reviewed Vela outreach.

Click the toolbar icon once to open Vela beside the active page. The panel stays available as you browse, automatically follows the active LinkedIn `linkedin.com/in/...` profile, and lets the team:

- read the public profile details already visible in the active tab;
- use the signed-in ContactOut browser session first, then optional API/Apollo fallbacks and LinkedIn Contact Info, promoting only a high-confidence non-guessed or explicitly verified address;
- build an editable work note from the prospect’s current and prior roles;
- plan searches and generate grounded drafts with `gpt-5.4-mini` from the extension background worker;
- fill a named, customizable outreach template, including the Vela “quick intro + pick your brain” email;
- use a persistent Light, Dark, or System appearance with the official Vela marks and Aeonik Pro;
- send a reviewed message directly through the selected Gmail account now or at the next occurrence of a persistent scheduled time, with a prefilled manual Gmail composer fallback when direct access is not connected;
- keep working from the same panel across tabs instead of reopening a transient popup;
- select exactly one verified prospect address by default, with an opt-in Settings control for sending separate copies to multiple verified addresses without exposing recipients to each other;
- export a reviewed, addressed MailMerge workbook for campaign-scale delivery;
- save the current profile and personalization note to one or more named campaigns;
- save one local draft per LinkedIn profile.

The **Workspace** action opens the larger GTM control room. Its navigation separates operating concerns instead of flattening everything into one prospect table:

- **Overview** shows the review runway, next 24 hours of scheduled sends, deliveries today, upcoming sends, and recent delivery activity;
- **AI research** keeps the search-planning agent and research queue together;
- **Review queue** isolates drafts that require a human decision;
- **Scheduled** shows durable queued Gmail jobs in send order and lets the user cancel them before delivery begins;
- **Sent history** is a local delivery ledger with recipient, subject, selected sender, result, and timestamps;
- **All prospects**, campaign views, MailMerge exports, imports, and **Settings** remain first-class workspace areas.

From the control room the team can also:

- create named campaigns with campaign-specific prospect totals;
- edit, duplicate, or delete campaigns without deleting their underlying prospect research;
- open a campaign to scope research, spreadsheet imports, MailMerge exports, and list actions to its members;
- export campaign rows as a MailMerge `.xlsx` workbook, including the agent-written subject and message;
- describe the people they want and open a native LinkedIn People search;
- capture the profile results currently visible in an open LinkedIn search tab;
- import MailMerge `.xlsx`, `.xls`, or `.csv` files with an editable column-mapping step, or paste LinkedIn profile URLs with optional background notes;
- deduplicate every lead by normalized LinkedIn profile URL;
- research queued profiles sequentially, find LinkedIn contact emails, and generate Vela drafts;
- track reviewed, exported, and manually marked-sent activity locally while MailMerge handles bulk delivery.

The extension does **not** invent email addresses, store captured HAR credentials, or send messages silently. ContactOut session requests execute inside a normal ContactOut tab, so ContactOut owns its cookies, CSRF token, Cloudflare state, and session rotation. Vela stores only its installation ID and a short-lived reveal approval. Optional provider keys remain background-only.

Apollo remains an optional fallback and People Search provider. It runs only after the ContactOut browser session and optional ContactOut API fallback fail to return a verified address. Apollo requests use the documented `x-api-key` header and retry one rate-limited request after `Retry-After`.

## Managed Chrome install

The signed release extension ID is `mecnpdbecgmgjolcdldhkeplheojjpki`. Its public key is pinned in `manifest.json`, so local unpacked builds and signed releases keep that same ID. In the managed Chrome dialog, enter that ID and use this custom update URL:

```
https://raw.githubusercontent.com/velaenergy/gtm/main/updates.xml
```

The update manifest points to the signed CRX published in each GitHub Release. Keep the signing key outside Git and reuse it for every release; changing it changes the extension ID and breaks managed updates.

## Install locally

Chrome 116 or newer is required for the native Side Panel API and the LinkedIn launcher.

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder: `/Users/riddhiman.rana/Documents/vela-gtm`.
5. Pin **Vela GTM** to the toolbar.
6. Open **Settings → Agent credentials**, enable the ContactOut browser session, and choose **Sign in to ContactOut**.
7. Finish ContactOut's normal Google login, return to Settings, and choose **Check again**. The status card will show **Signed in**, **Signed out**, **Not working**, **Checking**, or **Disabled** and will show the active ContactOut account and email-credit balance when connected.
8. Click the Vela icon once to open the persistent side panel, then browse between LinkedIn profiles normally.

The control room is available from **Workspace** in the side panel. Use **Add to campaign** below the personalization note to save the current person and note without leaving LinkedIn. LinkedIn discovery intentionally searches and reads pages in the signed-in browser; it does not run an autonomous hidden scraper.

If the profile was already open when you installed or reloaded the extension, Vela GTM will inject its reader on the first click. A normal page refresh also works.

## Email enrichment

**Find email** first asks LinkedIn's current contact-details RSC route for the profile's `ProfileContactDetailsOverlay` and extracts the returned `mailto:` address. This uses the active page's current session and constructs a fresh request; no cookie or CSRF value is copied from a HAR file. If LinkedIn rejects or changes that internal route, Vela GTM clicks the profile's official `/overlay/contact-info/` link, reads the rendered `mailto:`, and closes the overlay.

With **Research contacts automatically** enabled, opening a new LinkedIn profile starts the complete side-panel workflow: Vela sends a masked preview through ContactOut's signed-in page, polls any verification job, performs one `/api/v5/profiles/reveal` request, writes the personalization, and shows the remaining balance as quiet metadata. A profile is attempted once per open side-panel session, while **Refresh** remains available for an intentional retry. Campaign research still gives one bounded confirmation for the exact selected profile count and maximum possible email credits.

ContactOut browser cookies never enter extension storage or messages. Vela injects a small request function into a normal `contactout.com` page; that page adds its own CSRF token and includes its own cookies. The bridge returns only account summary, masked-candidate counts, or normalized reveal results. Reveal approvals are single-use, expire after ten minutes, and are invalidated if the active ContactOut account changes.

Settings keeps the browser session and optional ContactOut API fallback as separate health checks. The session card explains whether the browser is signed in and gives the next action; **Test ContactOut API** validates only the saved fallback token and reports its credit result inline. **Contact diagnostics** records bounded stage names, outcomes, HTTP status, candidate counts, credit counts, and whether ContactOut resolved a member ID. Use **Refresh log** after reproducing a failure and **Copy safe log** to share it. The logger allowlists fields and redacts messages; it never stores cookies, CSRF values, credentials, UUIDs, names, profile URLs, email addresses, or phone numbers.

Only high-confidence, non-guessed internal ContactOut addresses are promoted. Guessed addresses remain unverified unless the verification poll explicitly returns `valid` or `verified`. LinkedIn-visible, manually entered, `accept_all`, `invalid`, `disposable`, `unknown`, and placeholder addresses remain unverified.

After profile research, Vela passes bounded LinkedIn and Apollo/ContactOut work context to the configured OpenAI Responses API writer. Automatic generation writes the complete subject and email while the loading view remains visible; delivery stays locked until that AI draft succeeds. The explicit **Rewrite with AI** button reruns the same complete-draft flow from the selected recipient, profile, template, opener, subject, and body context. The side panel labels generated copy with the model used.

No ContactOut API token is required for profile reveals when the browser session is connected. An official ContactOut API token may still be saved as an optional fallback and is currently required for ContactOut People Search. AI research searches ContactOut first and falls back to Apollo when both are configured; provider-sourced profiles continue through API enrichment without opening LinkedIn. LinkedIn remains an explicit manual fallback beside each planned search. **Test ContactOut API** validates the optional token and its credits.

Optional direct ContactOut API requests include the documented `authorization: basic` and `token` headers. A `429` honors `Retry-After` and retries once. Browser-session and API modes both preserve ContactOut credit and account restrictions.

Request:

```json
{
  "source": "vela-gtm-extension",
  "profile": {
    "name": "Joshua Rivera",
    "headline": "Critical Operations Leader",
    "location": "Greater Seattle Area",
    "about": "...",
    "experiences": [
      { "title": "Operations Leadership", "company": "Stream Data Centers", "dates": "..." }
    ],
    "visibleEmail": "",
    "url": "https://www.linkedin.com/in/...",
    "capturedAt": "2026-07-13T00:00:00.000Z"
  }
}
```

The extension-facing normalized response is:

```json
{
  "email": "josh@example.com",
  "emailSource": "ContactOut work email",
  "note": "your work as VP, Critical Operations at Grid Works",
  "profile": { "headline": "...", "experiences": [] }
}
```

Custom enrichment endpoints remain supported. `email`, `workEmail`, or `work_email` are accepted, and responses may be nested under `data`, `person`, or `contact`.

If a bearer token is configured, it is stored in `chrome.storage.local` on that Chrome profile and sent as `Authorization: Bearer …`. For a wider company rollout, use a short-lived token or an internal endpoint protected by your identity proxy.

## AI agent and optional server mode

For the internal build, the background worker calls OpenAI's Responses API directly using the key saved in the current Chrome profile. It uses strict structured outputs for search plans and outreach drafts, with `store: false`.

The included server remains available as an optional production boundary:

Start the writer locally:

```bash
OPENAI_API_KEY="your-key" npm run writer
```

It listens on `http://127.0.0.1:8787` and uses `gpt-5.4-mini` by default. Put its `/generate` and `/enrich` URLs in the advanced endpoint fields only when using this mode.

Optional server environment variables:

```bash
OPENAI_MODEL="gpt-5.4-mini"
CONTACTOUT_API_KEY="your-contactout-token"
VELA_GTM_SERVER_TOKEN="an-internal-shared-token"
VELA_GTM_ALLOWED_ORIGIN="chrome-extension://your-extension-id"
HOST="127.0.0.1"
PORT="8787"
```

If `VELA_GTM_SERVER_TOKEN` is set, put that value in **Writer server token** in extension settings. That field is for access to Vela’s writer server, not for an OpenAI key. For a team rollout, deploy the same process behind an internal HTTPS endpoint and identity proxy.

Health check:

```bash
curl http://127.0.0.1:8787/health
```

The writer sends `store: false` and asks the Responses API for a strict JSON schema containing `subject`, `body`, and `workNote`. Its prompt tells the model to use only profile facts supplied by the extension and to leave email discovery to the enrichment flow.

## Gmail delivery, scheduling, and MailMerge

Campaign delivery uses the local **Export MailMerge** workflow. The workbook preserves the supplied format's first five columns exactly—`First Name`, `Last Name`, `Note about work`, `Recipient`, and `Email Sent`—then appends `Subject` and `Message` so the agent's researched personalization and reviewed copy stay together. Exporting marks those prospects as exported in the local workflow ledger; it does not send anything. A MailMerge `.xlsx`, `.xls`, or `.csv` file can be imported again through the visual column-mapping step to retain sent dates and revised copy.

Settings keeps provider credentials masked by default and provides an explicit **Show** / **Hide** control for each key. **Email generation** also manages a reusable set of named subject/body templates. The selected template supplies intent and reusable facts to the full-email writer rather than acting as a send-ready fallback.

With one or more connected senders, the side panel lets the user choose the exact Gmail account for the current compose and sends reviewed messages through Gmail's official `users.messages.send` endpoint with `gmail.send`. It never requests inbox-reading access, creates a separate message for each selected verified address, and never rotates the sender account. Without a connected sender, the same action opens one prefilled Gmail composer per selected address so the user can review and manually click **Send**. Scheduling remains available only for connected senders. Clicking **Send email** or **Open Gmail** is the approval boundary.

**Schedule sends** stores a preferred local time and remains enabled across future side-panel sessions until manually turned off. Each explicit send click schedules that reviewed message for the next occurrence of the chosen time. Jobs and message copy live in Chrome local storage without OAuth tokens; Manifest V3 alarms wake the background worker and missing alarms are restored after Chrome restarts. The dashboard can cancel a queued job, and every status transition updates the separate delivery ledger.

Gmail authorization is intentionally separate from local MailMerge import/export. Vela always uses Google's Web OAuth account chooser through `chrome.identity.launchWebAuthFlow()` and never binds delivery to the account signed into the Chrome profile. The public Web client ID is built into the internal extension; the client secret is neither required nor shipped.

To configure the built-in account chooser in Google Cloud:

1. In Google Cloud, enable only the **Gmail API**.
2. In **Google Auth Platform → Audience**, choose **Internal** when both senders belong to the same Vela Workspace organization. If either sender is outside that organization, choose **External**, keep the app in **Testing**, and add both email addresses under **Test users**. External test grants expire after seven days and must then be reconnected.
3. Under **Data Access**, add `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/userinfo.email`.
4. Under **Clients**, choose **Create client → Web application** and name it `Vela GTM account chooser`.
5. Add this exact **Authorized redirect URI**: `https://mecnpdbecgmgjolcdldhkeplheojjpki.chromiumapp.org/google`. Do not add a trailing slash and do not add a JavaScript origin.
6. The internal build already contains the Web client's public `…apps.googleusercontent.com` client ID. Never put the Web client secret in the extension.
7. Click **Add Gmail account**, choose `tony@velaenergy.ai`, and repeat for `tarun@velaenergy.ai` or any other permitted Gmail/Workspace account.
8. Select the default sender in Settings or use **Send from** beside the side-panel composer to choose the exact account for each immediate or scheduled message.

There is no Chrome-profile OAuth fallback. Account-chooser access tokens are transient and never written to Chrome storage. Vela persists only each connected account's Google ID, email label, authorization mode, and the selected account ID. Every delivery renews authorization for the job's exact account, verifies the returned email, and refuses to send through a changed account. Local `.xlsx` MailMerge import/export does not require Google authorization.

## Development

The extension has no runtime dependencies or build step.

```bash
npm run check
```

Preview the side-panel surface, dashboard, and settings page without installing the extension:

```bash
npm run preview
```

Then open:

- `http://localhost:4173/popup.html` — seeded side-panel surface with the Joshua demo profile;
- `http://localhost:4173/popup.html?tab=draft` — opens the email composer preview;
- `http://localhost:4173/options.html` — settings UI in local preview mode.
- `http://localhost:4173/dashboard.html` — seeded prospect queue preview.

Append `?theme=light` or `?theme=dark` to either preview URL to inspect a specific theme.

## File map

- `manifest.json` — Manifest V3 permissions, persistent side-panel entry, and LinkedIn content script.
- `content-script.js` — reads visible profile data, responds to the side panel, and mounts the compact LinkedIn launcher.
- `dashboard.html`, `dashboard.css`, `dashboard.js` — control room, AI research, review, scheduling, delivery history, campaigns, MailMerge, and imports.
- `lib/queue.js`, `lib/campaigns.js`, and `lib/mail-merge.js` — prospect state, campaign lifecycle, and workbook round trips.
- `lib/linkedin-parser.js` — parses current LinkedIn SDUI top-card and experience text without generated CSS classes.
- `popup.html`, `popup.css`, `popup.js` — persistent profile side panel, verified-recipient selection, templates, direct send, and schedule controls.
- `options.html`, `options.css`, `options.js` — provider credentials, named templates, theme, Google delivery, and sender defaults.
- `lib/message.js` — pure personalization, reusable template, and enrichment helpers.
- `lib/gmail-send.js`, `lib/schedule.js`, and `lib/delivery-ledger.js` — safe RFC message encoding, Gmail send requests, durable schedules, and bounded delivery history.
- `background.js`, `lib/contactout-session.js`, `lib/contactout.js`, and `lib/ai-writer.js` — scheduled Gmail delivery, page-owned ContactOut session bridge, optional API fallback, provider routing, and safe payload shaping.
- `server/` — optional server-side provider boundary for production deployment.
- `assets/vela-logo-light.png`, `assets/vela-logo-dark.png`, and `assets/fonts/aeonik-pro-medium.ttf` — local Vela theme assets.
- `tests/campaigns.test.js` and `tests/message.test.js` — deterministic coverage for campaign scoping and the message workflow.

## Data boundaries

- Profile parsing happens locally in the LinkedIn tab.
- ContactOut browser login remains page-owned; captured HAR session values are never stored or replayed.
- Only masked lookup metadata and ≤10-minute reveal approvals enter extension storage; ContactOut cookies and CSRF values do not.
- Drafts, scheduled-message copy, campaign membership, activity tracking, and settings stay in the current Chrome profile. Queue and campaign collections are mirrored into a versioned local backup so a missing primary key after an update can be repaired without resurrecting an intentionally deleted campaign list. Google Web OAuth access tokens are transient and are not persisted.
- Profile data leaves the browser only when ContactOut enrichment or OpenAI writing/search planning runs.
- Provider keys stay in extension storage/background execution for the internal build and are never sent to LinkedIn tabs or placed in queue records.
- A production deployment should use the optional Vela server with environment variables or a managed secret store.
- Direct delivery uses only `gmail.send`, one reviewed message per verified recipient. Campaign-scale delivery remains available through exported MailMerge workbooks.
