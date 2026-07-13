# Vela GTM

An internal Chrome extension that turns a LinkedIn profile into a researched, editable Vela outreach draft.

Click the toolbar icon while viewing a `linkedin.com/in/...` profile and Vela GTM will:

- read the public profile details already visible in the active tab;
- automatically query ContactOut and fall back to LinkedIn Contact Info without requiring a lookup click;
- build an editable work note from the prospect’s current and prior roles;
- plan searches and generate grounded drafts with `gpt-5.4-mini` from the extension background worker;
- fill one of three outreach plays, including the Vela “quick intro + pick your brain” email;
- use a persistent Light, Dark, or System appearance with the official Vela marks and Aeonik Pro;
- open the addressed message in Gmail for final review and sending;
- save one local draft per LinkedIn profile.

The **+ Queue** action opens a larger prospecting workspace. From there the team can:

- describe the people they want and open a native LinkedIn People search;
- capture the profile results currently visible in an open LinkedIn search tab;
- paste batches of LinkedIn profile URLs with optional background notes;
- deduplicate every lead by normalized LinkedIn profile URL;
- research queued profiles sequentially, find LinkedIn contact emails, and generate Vela drafts;
- create reviewable drafts in the currently connected Gmail account without sending them.

The extension does **not** invent email addresses, reuse captured HAR credentials, or send messages silently. This internal build can store provider keys in the current Chrome profile; they are read only by the background worker and never injected into LinkedIn pages.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder: `/Users/riddhiman.rana/Documents/vela-gtm`.
5. Pin **Vela GTM** to the toolbar.
6. Open a LinkedIn profile and click the Vela icon.

The prospect queue is available from **+ Queue** in the popup. LinkedIn discovery intentionally searches and reads pages in the signed-in browser; it does not run an autonomous hidden scraper.

If the profile was already open when you installed or reloaded the extension, Vela GTM will inject its reader on the first click. A normal page refresh also works.

## Email enrichment

**Find email** first asks LinkedIn's current contact-details RSC route for the profile's `ProfileContactDetailsOverlay` and extracts the returned `mailto:` address. This uses the active page's current session and constructs a fresh request; no cookie or CSRF value is copied from a HAR file. If LinkedIn rejects or changes that internal route, Vela GTM clicks the profile's official `/overlay/contact-info/` link, reads the rendered `mailto:`, and closes the overlay.

Email resolution starts automatically when the popup opens. The background worker calls ContactOut's Contact Info API with real-time work-email lookup, then People Enrich, then the broad LinkedIn Profile API. If those miss, it checks LinkedIn Contact Info. All returned addresses and verification status are shown in the popup, while a work email remains the preferred draft recipient.

Add the ContactOut and OpenAI keys in **Settings → Agent credentials** and save. No localhost process is needed. ContactOut People Search powers AI-planned discovery, returning up to 10 queue candidates per selected strategy without revealing their contact information until research runs.

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

## Gmail draft connection

The queue uses Gmail's official `users.drafts.create` endpoint with the compose-only OAuth scope. It creates RFC 2822 messages encoded as base64url. It does not request inbox-reading access and it never calls a send endpoint.

1. In Google Cloud, enable the **Gmail API** for Vela's internal project.
2. Configure the OAuth consent screen for Vela's Workspace organization.
3. Load the unpacked extension, then copy its ID from Settings or `chrome://extensions`.
4. Create an OAuth client of type **Chrome Extension** using that extension ID.
5. Replace `REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com` in `manifest.json` with the issued client ID.
6. Reload the extension and use **Connect Gmail** in Settings.

The current iteration connects one Chrome/Google identity and creates drafts for human review. Multi-mailbox sending, automatic account rotation, and unattended sending are deliberately out of scope; a later sender service would need per-mailbox OAuth grants, durable scheduling, suppression lists, bounce handling, and explicit daily controls.

## Development

The extension has no runtime dependencies or build step.

```bash
npm run check
```

Preview the popup and settings page without installing the extension:

```bash
npm run preview
```

Then open:

- `http://localhost:4173/popup.html` — seeded with the Joshua demo profile;
- `http://localhost:4173/popup.html?tab=draft` — opens the email composer preview;
- `http://localhost:4173/options.html` — settings UI in local preview mode.
- `http://localhost:4173/dashboard.html` — seeded prospect queue preview.

Append `?theme=light` or `?theme=dark` to either preview URL to inspect a specific theme.

## File map

- `manifest.json` — Manifest V3 permissions, toolbar popup, and LinkedIn content script.
- `content-script.js` — reads visible profile data and responds to the popup.
- `dashboard.html`, `dashboard.css`, `dashboard.js` — search capture, batch queue, sequential research, and Gmail drafts.
- `lib/queue.js` and `lib/gmail.js` — queue identity/state and RFC email encoding.
- `lib/linkedin-parser.js` — parses current LinkedIn SDUI top-card and experience text without generated CSS classes.
- `popup.html`, `popup.css`, `popup.js` — profile brief, email workflow, templates, local drafts, and Gmail handoff.
- `options.html`, `options.css`, `options.js` — provider credentials, optional endpoints, theme, Gmail, and sender defaults.
- `lib/message.js` — pure personalization, template, enrichment, and Gmail URL helpers.
- `background.js`, `lib/contactout.js`, and `lib/ai-writer.js` — isolated provider calls, fallback logic, and safe payload shaping.
- `server/` — optional server-side provider boundary for production deployment.
- `assets/vela-logo-light.png`, `assets/vela-logo-dark.png`, and `assets/fonts/aeonik-pro-medium.ttf` — local Vela theme assets.
- `tests/message.test.js` — deterministic coverage for the message workflow.

## Data boundaries

- Profile parsing happens locally in the LinkedIn tab.
- Contact lookup uses the active LinkedIn session only after **Find email** is clicked; captured HAR session values are never stored or replayed.
- Drafts and settings stay in the current Chrome profile.
- Profile data leaves the browser only when ContactOut enrichment or OpenAI writing/search planning runs.
- Provider keys stay in extension storage/background execution for the internal build and are never sent to LinkedIn tabs or placed in queue records.
- A production deployment should use the optional Vela server with environment variables or a managed secret store.
- Gmail access is compose-only. The queue creates user-visible drafts and never sends on the user’s behalf.
