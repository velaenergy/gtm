(() => {
  if (globalThis.__VELA_GTM_CONTENT_SCRIPT__) return;
  globalThis.__VELA_GTM_CONTENT_SCRIPT__ = true;

  const parser = globalThis.VelaLinkedInParser;
  const launcher = globalThis.VelaLinkedInLauncher;
  if (!parser) {
    globalThis.__VELA_GTM_CONTENT_SCRIPT__ = false;
    throw new Error("Vela GTM profile parser did not load.");
  }

  const { cleanText, emailFromFlightResponse, emailFromMailto, memberIdFromMarkup, parseAboutLines, parseExperienceLines, parseTopCardLines, uniqueLines } = parser;

  async function mountVelaLauncher() {
    if (!launcher || document.getElementById("vela-gtm-linkedin-launcher")) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_CONFIGURE_SIDE_PANEL" });
      if (!response?.ok) throw new Error(response?.error || "Could not configure Vela GTM.");
    } catch (error) {
      console.error("Could not prepare the Vela GTM launcher. Refresh this LinkedIn page after reloading the extension.", error);
      return;
    }

    const host = document.createElement("div");
    host.id = "vela-gtm-linkedin-launcher";
    host.style.cssText = "position:fixed;right:0;top:44vh;z-index:2147483647;display:none;pointer-events:auto";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      button {
        width: 40px;
        min-height: 116px;
        display: grid;
        grid-template-rows: auto 1fr;
        place-items: center;
        gap: 8px;
        padding: 11px 7px 12px;
        border: 1px solid rgba(56, 189, 248, .52);
        border-right: 0;
        border-radius: 10px 0 0 10px;
        background: linear-gradient(180deg, #0c1a24 0%, #071017 100%);
        color: #f7fbff;
        box-shadow: 0 12px 30px rgba(2, 8, 14, .28), inset 0 1px rgba(255,255,255,.07);
        cursor: pointer;
        font: 600 11px/1.1 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: .055em;
        transition: width .16s ease, background .16s ease, box-shadow .16s ease;
      }
      button:hover, button:focus-visible {
        width: 44px;
        outline: none;
        background: linear-gradient(180deg, #102838 0%, #08151e 100%);
        box-shadow: 0 14px 34px rgba(2, 8, 14, .34), inset 3px 0 #1688ff;
      }
      button:active { transform: translateX(1px); }
      button[aria-busy="true"] { cursor: progress; opacity: .78; }
      svg { width: 19px; height: 19px; overflow: visible; }
      span { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; }
      @media (prefers-reduced-motion: reduce) { button { transition: none; } }
    `;
    const button = document.createElement("button");
    button.type = "button";
    button.title = "Open Vela GTM";
    button.setAttribute("aria-label", "Open Vela GTM side panel");
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 17.5c4.7-.4 8.4-4.3 9.1-10.9 2.6 3.4 4.8 6.4 8.9 7.8-5.4 2.9-11.1 4-18 3.1Z" fill="#f7fbff"/>
        <path d="M4 20c5.8.3 11-.7 16-3.5" fill="none" stroke="#1688ff" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span>VELA GTM</span>
    `;
    button.addEventListener("click", async () => {
      if (button.getAttribute("aria-busy") === "true") return;
      button.setAttribute("aria-busy", "true");
      try {
        const response = await chrome.runtime.sendMessage({ type: "VELA_GTM_OPEN_SIDE_PANEL" });
        if (!response?.ok) throw new Error(response?.error || "Could not open Vela GTM.");
      } catch (error) {
        button.title = error instanceof Error ? error.message : "Could not open Vela GTM.";
      } finally {
        button.removeAttribute("aria-busy");
      }
    });
    shadow.append(style, button);
    document.documentElement.append(host);

    const updateVisibility = () => {
      host.style.display = launcher.launcherVisibleForPath(window.location.pathname) ? "block" : "none";
    };
    updateVisibility();
    window.addEventListener("popstate", updateVisibility);
    setInterval(updateVisibility, 750);
  }

  mountVelaLauncher().catch((error) => console.error("Could not mount the Vela GTM launcher.", error));

  function isVisible(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || element.closest("script, style, noscript, template, svg")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function textLines(root) {
    if (!root) return [];
    const lines = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const line = cleanText(node.nodeValue);
      if (line && isVisible(node)) lines.push(line);
      node = walker.nextNode();
    }
    return uniqueLines(lines);
  }

  function findSection(label) {
    const normalized = label.toLowerCase();
    const matches = (node) => isVisible(node) && cleanText(node.textContent).toLowerCase() === normalized;
    const heading = [...document.querySelectorAll("h1, h2, h3, [role='heading']")].find(matches) ||
      [...document.querySelectorAll("main p, main span")].find((node) => node.children.length === 0 && matches(node));
    return heading?.closest("section") || heading?.parentElement?.parentElement || null;
  }

  function topCardSection() {
    const semantic = document.querySelector(
      "section[componentkey*='topcard' i], section[data-sdui-component*='topcard' i]",
    );
    if (semantic) return semantic;

    const titleName = cleanText(document.title.split("|")[0]);
    const heading = [...document.querySelectorAll("main h1, main h2")].find((node) => {
      const value = cleanText(node.textContent);
      return value && (!titleName || titleName.includes(value) || value.includes(titleName));
    });
    return heading?.closest("section") || document.querySelector("main section");
  }

  function extractJsonLd() {
    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        const entries = Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed];
        const person = entries.find((entry) => entry?.["@type"] === "Person");
        if (person) return person;
      } catch {
        // LinkedIn can replace structured data while navigating between profiles.
      }
    }
    return {};
  }

  function extractExperience() {
    const section = findSection("Experience") || document.querySelector("#experience")?.closest("section");
    if (!section) return [];
    return parseExperienceLines(textLines(section));
  }

  function extractAbout() {
    const section = findSection("About") || document.querySelector("#about")?.closest("section");
    if (!section) return "";
    return parseAboutLines(textLines(section)).slice(0, 2400);
  }

  function extractVisibleEmail() {
    const mailto = emailFromMailto(document.querySelector("a[href^='mailto:']")?.getAttribute("href"));
    if (mailto) return mailto;
    const visible = cleanText(document.querySelector("main")?.innerText || "");
    return (visible.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "").toLowerCase();
  }

  function contactOverlayRoot() {
    const semantic = document.querySelector(
      "[data-sdui-screen='com.linkedin.sdui.flagshipnav.profile.ProfileContactDetailsOverlay'], [data-sdui-screen*='ProfileContactDetailsOverlay']",
    );
    if (semantic) return semantic;
    if (/\/overlay\/contact-info\/?$/i.test(window.location.pathname)) {
      return document.querySelector("[role='dialog'], main");
    }
    return null;
  }

  function emailFromContactOverlay() {
    const root = contactOverlayRoot();
    if (!root) return "";
    for (const link of root.querySelectorAll("a[href^='mailto:']")) {
      const email = emailFromMailto(link.getAttribute("href"));
      if (email) return email;
    }
    return "";
  }

  function currentProfileIdentity() {
    const vanityName = window.location.pathname.match(/^\/in\/([^/]+)/i)?.[1] || "";
    const fullName = cleanText(topCardSection()?.querySelector("h1, h2")?.textContent);
    const [givenName = "", ...familyParts] = fullName.split(" ").filter(Boolean);
    return { vanityName, givenName, familyName: familyParts.join(" ") };
  }

  function currentCsrfToken() {
    const value = document.cookie.match(/(?:^|;\s*)JSESSIONID=(?:\"([^\"]+)\"|([^;]+))/i);
    return cleanText(value?.[1] || value?.[2] || "");
  }

  async function fetchContactEmailFromRsc() {
    const { vanityName, givenName, familyName } = currentProfileIdentity();
    if (!vanityName) return "";

    const screenId = "com.linkedin.sdui.flagshipnav.profile.ProfileContactDetailsOverlay";
    const endpoint = new URL("/flagship-web/rsc-action/actions/navigation", window.location.origin);
    endpoint.searchParams.set("screenId", screenId);
    endpoint.searchParams.set("sduiid", screenId);
    const headers = { Accept: "*/*", "Content-Type": "application/json" };
    const csrfToken = currentCsrfToken();
    if (csrfToken) headers["csrf-token"] = csrfToken;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          clientArguments: {
            $type: "proto.sdui.actions.requests.RequestedArguments",
            payload: { vanityName, givenName, familyName, isVanityNameResolved: true },
            requestedStateKeys: [],
            requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
            states: [],
            screenId,
          },
          isModal: true,
        }),
      });
      if (!response.ok) throw new Error(`LinkedIn contact details returned ${response.status}.`);
      const flight = await response.text();
      return emailFromFlightResponse(flight);
    } finally {
      clearTimeout(timeout);
    }
  }

  function closeContactOverlay() {
    const root = contactOverlayRoot();
    const closeButton = [...document.querySelectorAll("button, [role='button']")].find((node) => {
      if (root && !root.contains(node) && !node.closest("[role='dialog']")) return false;
      const label = cleanText(
        `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""} ${node.textContent || ""}`,
      );
      return /^(?:close|dismiss)(?:\s|$)/i.test(label);
    });
    if (closeButton) {
      closeButton.click();
      return;
    }
    if (/\/overlay\/contact-info\/?$/i.test(window.location.pathname)) {
      history.back();
      return;
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  }

  function waitForContactEmail(timeout = 6500) {
    const immediate = emailFromContactOverlay();
    if (immediate) return Promise.resolve(immediate);

    return new Promise((resolve) => {
      let settled = false;
      let emptyOverlayTimer;
      const finish = (email = "") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(emptyOverlayTimer);
        observer.disconnect();
        resolve(email);
      };
      const check = () => {
        const email = emailFromContactOverlay();
        if (email) {
          finish(email);
          return;
        }
        if (contactOverlayRoot() && !emptyOverlayTimer) emptyOverlayTimer = setTimeout(() => finish(""), 2500);
      };
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => finish(""), timeout);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      check();
    });
  }

  async function findLinkedInContactEmail() {
    try {
      const discreetEmail = await fetchContactEmailFromRsc();
      if (discreetEmail) return { email: discreetEmail, strategy: "rsc" };
    } catch {
      // LinkedIn's private RSC shape can change; the rendered overlay below is the stable fallback.
    }

    const existing = emailFromContactOverlay();
    if (existing) {
      closeContactOverlay();
      return { email: existing, strategy: "overlay" };
    }

    const contactLink = document.querySelector("a[href*='/overlay/contact-info/']") ||
      [...document.querySelectorAll("a, button, [role='button']")].find(
        (node) => cleanText(node.textContent).toLowerCase() === "contact info",
      );
    if (!contactLink) throw new Error("LinkedIn's Contact info link is not available on this profile.");

    contactLink.click();
    const email = await waitForContactEmail();
    closeContactOverlay();
    return { email, strategy: "overlay" };
  }

  function extractProfile() {
    const jsonLd = extractJsonLd();
    const topCard = topCardSection();
    const headingName = cleanText(topCard?.querySelector("h1, h2")?.textContent);
    const fallbackName = cleanText(jsonLd.name || document.title.split("|")[0]);
    const top = parseTopCardLines(textLines(topCard), headingName || fallbackName);

    const vanityName = window.location.pathname.match(/^\/in\/([^/]+)/i)?.[1] || "";
    return {
      name: top.name,
      headline: top.headline || cleanText(jsonLd.jobTitle),
      location: top.location || cleanText(jsonLd.address?.addressLocality),
      about: extractAbout(),
      experiences: extractExperience(),
      visibleEmail: extractVisibleEmail(),
      memberId: memberIdFromMarkup(document.documentElement.innerHTML, vanityName),
      url: `${window.location.origin}${window.location.pathname}`,
      capturedAt: new Date().toISOString(),
    };
  }

  function normalizeProfileUrl(value = "") {
    try {
      const url = new URL(value, window.location.origin);
      const slug = url.pathname.match(/^\/in\/([^/]+)/i)?.[1];
      return slug ? `https://www.linkedin.com/in/${slug}` : "";
    } catch {
      return "";
    }
  }

  function extractSearchResults() {
    const prospects = new Map();
    const anchors = document.querySelectorAll("main a[href*='/in/'], [role='main'] a[href*='/in/']");
    for (const anchor of anchors) {
      const url = normalizeProfileUrl(anchor.getAttribute("href"));
      if (!url || prospects.has(url.toLowerCase())) continue;
      const card = anchor.closest("li, article, [data-view-name='search-entity-result-universal-template']") ||
        anchor.parentElement?.parentElement;
      const lines = textLines(card).filter((line) => !/^(?:connect|follow|message|view profile)$/i.test(line));
      const anchorName = cleanText(anchor.textContent).replace(/View .+’s profile$/i, "");
      const name = anchorName || lines.find((line) => line.length > 2 && line.length < 80) || "LinkedIn prospect";
      const headline = lines.find((line) => line !== name && line.length > 12 && !/\b(?:degree|connection)s?\b/i.test(line)) || "";
      prospects.set(url.toLowerCase(), { url, name, headline });
      if (prospects.size >= 50) break;
    }
    return [...prospects.values()];
  }

  function waitForProfileDom(timeout = 1600) {
    const hasTopCard = () => Boolean(topCardSection()?.querySelector("h1, h2"));
    if (hasTopCard() && findSection("Experience")) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      let checkTimer;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(checkTimer);
        observer.disconnect();
        resolve();
      };
      const observer = new MutationObserver(() => {
        clearTimeout(checkTimer);
        checkTimer = setTimeout(() => {
          if (hasTopCard() && findSection("Experience")) finish();
        }, 80);
      });
      const timer = setTimeout(finish, hasTopCard() ? timeout : timeout + 900);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "VELA_GTM_EXTRACT_SEARCH_RESULTS") {
      sendResponse({ ok: true, prospects: extractSearchResults() });
      return false;
    }
    if (message?.type === "VELA_GTM_EXTRACT_PROFILE") {
      waitForProfileDom()
        .then(() => sendResponse({ ok: true, profile: extractProfile() }))
        .catch((error) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not read this profile." }),
        );
      return true;
    }
    if (message?.type === "VELA_GTM_FIND_LINKEDIN_EMAIL") {
      findLinkedInContactEmail()
        .then(({ email, strategy }) => sendResponse({ ok: true, email, strategy }))
        .catch((error) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not read Contact info." }),
        );
      return true;
    }
    return false;
  });
})();
