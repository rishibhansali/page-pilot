// Content script injected into every page by the Chrome extension.
// Responsibilities:
//   1. Listen for GET_SNAPSHOT / GET_SKELETON messages and return page data.
//   2. Listen for EXECUTE_ACTION messages and perform the requested DOM action.
//   3. Listen for WAIT_FOR_SETTLE and resolve when the page has stabilised.
//   4. Relay STATUS_UPDATE / NAVIGATION_COMPLETE events to the widget via CustomEvent.

import type {
  BackgroundToContent,
  ContentToBackground,
  DomSnapshot,
  SnapshotElement,
} from "@/types";
import { mountWidget } from "@/widget/index";
import { extractPageSkeleton } from "./domExtractor";
import { executeAction, type ActionResponse } from "./actionExecutor";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Data attribute used to give each interactive element a stable ID. */
const PILOT_ID_ATTR = "data-pilot-id";

/** CSS selector for all elements we expose to Claude. */
const INTERACTIVE_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]';

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

/**
 * Listens for messages from the background service worker and responds
 * with a snapshot, action result, or settle confirmation.
 */
chrome.runtime.onMessage.addListener(
  (msg: BackgroundToContent, _sender, sendResponse) => {
    if (msg.type === "GET_SKELETON") {
      sendResponse({ skeleton: extractPageSkeleton(), url: window.location.href });
      return true;

    } else if (msg.type === "GET_SNAPSHOT") {
      const snapshot = buildSnapshot();
      const response: ContentToBackground = { type: "SNAPSHOT_RESULT", snapshot };
      sendResponse(response);

    } else if (msg.type === "EXECUTE_ACTION") {
      console.log("[PagePilot] Action received:", msg.action);
      const actionData = msg.action as unknown as ActionResponse;
      executeAction(actionData).then((result) => {
        console.log("[PagePilot] Execute result:", result);
        // Inform the service worker that a side-effecting action fired.
        if (result.success && (actionData.action === "click" || actionData.action === "scroll")) {
          chrome.runtime.sendMessage({
            type: "PAGE_SETTLING",
            payload: { previousUrl: document.URL },
          } satisfies ContentToBackground);
        }
        chrome.runtime.sendMessage({
          type: "ACTION_COMPLETE",
          payload: result,
        } satisfies ContentToBackground);
      });
      return true;

    } else if (msg.type === "WAIT_FOR_SETTLE") {
      waitForPageSettle().then(() => {
        sendResponse({ settled: true, url: window.location.href });
      });
      return true;

    } else if (msg.type === "STATUS_UPDATE") {
      console.log("[PagePilot] Status:", msg.payload);
      // Dispatch on the shadow host so listeners inside the shadow DOM receive it
      // without relying on composed event propagation across shadow boundaries.
      const statusHost = document.getElementById("page-pilot-root");
      if (statusHost) {
        statusHost.dispatchEvent(
          new CustomEvent("pagepilot-status", {
            detail: msg.payload,
            bubbles: true,
            composed: true,
          })
        );
      }
      sendResponse({ ok: true });

    } else if (msg.type === "NAVIGATION_COMPLETE") {
      console.log("[PagePilot] Navigation complete:", msg.payload);
      const completeHost = document.getElementById("page-pilot-root");
      if (completeHost) {
        completeHost.dispatchEvent(
          new CustomEvent("pagepilot-complete", {
            detail: msg.payload,
            bubbles: true,
            composed: true,
          })
        );
        sendResponse({ ok: true, delivered: true });
      } else {
        // Widget shadow DOM not mounted yet — tell background to retry.
        sendResponse({ ok: true, delivered: false });
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Page-settle detection
// ---------------------------------------------------------------------------

/**
 * Returns a Promise that resolves when the page has settled after a navigation
 * or DOM change. Combines URL-change polling with a MutationObserver debounce
 * to handle both full-page navigations and SPA route changes.
 * Resolves unconditionally after 5 seconds as a safety net.
 */
export function waitForPageSettle(): Promise<void> {
  return new Promise((resolve) => {
    const capturedUrl = window.location.href;
    let settled = false;

    function doResolve() {
      if (settled) return;
      settled = true;
      clearInterval(urlPollInterval);
      clearTimeout(maxWaitTimeout);
      if (mutationTimer !== null) clearTimeout(mutationTimer);
      observer.disconnect();
      resolve();
    }

    // Approach 1: poll every 100ms for a URL change (SPA history.pushState).
    const urlPollInterval = setInterval(() => {
      if (window.location.href !== capturedUrl) {
        clearInterval(urlPollInterval);
        // URL changed — wait for the document to finish loading then add buffer.
        const readyCheck = setInterval(() => {
          if (document.readyState === "complete") {
            clearInterval(readyCheck);
            setTimeout(doResolve, 500);
          }
        }, 50);
      }
    }, 100);

    // Approach 2: MutationObserver debounce for DOM changes without a URL change.
    let mutationTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (mutationTimer !== null) clearTimeout(mutationTimer);
      mutationTimer = setTimeout(doResolve, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Safety net — resolve after 5 s regardless.
    const maxWaitTimeout = setTimeout(doResolve, 5000);
  });
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

/**
 * Scans the page for interactive elements, stamps pilot IDs on each,
 * and returns a structured snapshot for Claude to reason about.
 */
function buildSnapshot(): DomSnapshot {
  const elements = document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR);
  const snapshotElements: SnapshotElement[] = [];

  let counter = 0;
  elements.forEach((el) => {
    // Skip invisible elements — they confuse the model and waste tokens.
    if (!isVisible(el)) return;

    const id = `pilot-${counter++}`;
    el.setAttribute(PILOT_ID_ATTR, id);

    snapshotElements.push(serializeElement(el, id));
  });

  const snapshot: DomSnapshot = {
    url: window.location.href,
    title: document.title,
    elements: snapshotElements,
    tokenEstimate: estimateTokens(snapshotElements),
  };

  return snapshot;
}

/**
 * Converts a DOM element into a plain-object representation safe to JSON-serialize.
 */
function serializeElement(el: HTMLElement, pilotId: string): SnapshotElement {
  const rect = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();

  const entry: SnapshotElement = {
    pilotId,
    tag,
    label: getLabel(el),
    inViewport: isInViewport(rect),
    rect: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };

  if (el instanceof HTMLInputElement) {
    entry.inputType = el.type;
    entry.value = el.value;
  } else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    entry.value = el.value;
  } else if (el instanceof HTMLAnchorElement && el.href) {
    entry.href = el.href;
  }

  return entry;
}

/**
 * Returns the best human-readable label for an element.
 * Priority: aria-label > text content > placeholder > title > name attribute.
 */
function getLabel(el: HTMLElement): string {
  return (
    el.getAttribute("aria-label") ??
    el.textContent?.trim().slice(0, 120) ??
    el.getAttribute("placeholder") ??
    el.getAttribute("title") ??
    el.getAttribute("name") ??
    ""
  );
}

/**
 * Returns true if the element has non-zero dimensions and is not hidden.
 * Filters out elements that are display:none, visibility:hidden, or zero-size.
 */
function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Returns true if the element's bounding rect overlaps the viewport.
 */
function isInViewport(rect: DOMRect): boolean {
  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

/**
 * Rough token estimate for the snapshot.
 * Used to guard against sending oversized payloads to Claude.
 * 1 token ≈ 4 characters of JSON.
 */
function estimateTokens(elements: SnapshotElement[]): number {
  return Math.ceil(JSON.stringify(elements).length / 4);
}

// ---------------------------------------------------------------------------
// DOM skeleton — initial extraction + SPA refresh observer
// ---------------------------------------------------------------------------

// Log the initial page skeleton so we can verify the extractor in DevTools.
// In a future milestone this output will be sent to the backend instead.
console.log("[PagePilot] Initial skeleton:\n", extractPageSkeleton());

/**
 * Attributes we write ourselves — mutations to these must not trigger a
 * re-extraction or we'd loop forever (extract → stamp id → mutation → extract…).
 */
const OWN_ATTRS = new Set(["data-pagepilot-id", PILOT_ID_ATTR]);

/** Debounce handle for the MutationObserver re-extraction. */
let mutationDebounce: ReturnType<typeof setTimeout> | null = null;

/**
 * Watches for meaningful DOM changes (child additions/removals in the full
 * subtree) and re-runs extractPageSkeleton() 500ms after the last mutation.
 * This gives us automatic SPA support: when a React/Vue app re-renders after
 * a navigation or click, we get a fresh skeleton without any extra wiring.
 *
 * Attribute-only mutations on our own stamped attributes are ignored to
 * prevent the feedback loop described above.
 */
const skeletonObserver = new MutationObserver((mutations) => {
  const meaningful = mutations.some(
    (m) =>
      !(
        m.type === "attributes" &&
        m.attributeName !== null &&
        OWN_ATTRS.has(m.attributeName)
      )
  );
  if (!meaningful) return;

  if (mutationDebounce !== null) clearTimeout(mutationDebounce);
  mutationDebounce = setTimeout(() => {
    console.log(
      "[PagePilot] DOM changed — refreshed skeleton:\n",
      extractPageSkeleton()
    );
    mutationDebounce = null;
  }, 500);
});

skeletonObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

// ---------------------------------------------------------------------------
// Widget mount
// ---------------------------------------------------------------------------

/** Hostname + path prefix pairs for pages that are search engine result pages. */
const SEARCH_ENGINE_PATTERNS: { hostname: string; pathStartsWith: string }[] = [
  { hostname: "google.com",        pathStartsWith: "/search" },
  { hostname: "www.google.com",    pathStartsWith: "/search" },
  { hostname: "bing.com",          pathStartsWith: "/search" },
  { hostname: "www.bing.com",      pathStartsWith: "/search" },
  { hostname: "duckduckgo.com",    pathStartsWith: "/" },
  { hostname: "search.yahoo.com",  pathStartsWith: "/search" },
];

/**
 * Returns true when the current page is a search engine results page.
 * We skip mounting the widget on these pages because the user hasn't
 * navigated to a destination site yet and the widget would be intrusive.
 */
function isSearchEngineResultsPage(): boolean {
  const { hostname, pathname } = window.location;
  return SEARCH_ENGINE_PATTERNS.some(
    (p) => hostname === p.hostname && pathname.startsWith(p.pathStartsWith)
  );
}

// Mount the floating widget after all message listeners are registered,
// so the background service worker is ready when the widget opens a port.
if (isSearchEngineResultsPage()) {
  console.log("[PagePilot] Skipping mount on search engine results page");
} else {
  mountWidget();
}
