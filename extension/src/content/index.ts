// Content script injected into every page by the Chrome extension.
// Responsibilities:
//   1. Listen for GET_SNAPSHOT messages and return a serialized DOM snapshot.
//   2. Listen for EXECUTE_ACTION messages and perform the requested DOM action.
//   3. Stamp pilot IDs onto interactive elements so Claude can reference them.

import type {
  BackgroundToContent,
  ContentToBackground,
  DomSnapshot,
  SnapshotElement,
  PilotAction,
} from "@/types";
import { mountWidget } from "@/widget/index";
import { extractPageSkeleton } from "./domExtractor";

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
 * with either a snapshot or an action result.
 */
chrome.runtime.onMessage.addListener(
  (msg: BackgroundToContent, _sender, sendResponse) => {
    if (msg.type === "GET_SKELETON") {
      sendResponse({ skeleton: extractPageSkeleton(), url: window.location.href });
      return true;
    } else if (msg.type === "GET_SNAPSHOT") {
      const snapshot = buildSnapshot();
      const response: ContentToBackground = {
        type: "SNAPSHOT_RESULT",
        snapshot,
      };
      sendResponse(response);
    } else if (msg.type === "EXECUTE_ACTION") {
      console.log("[PagePilot] Action received:", msg.action);
      executeAction(msg.action)
        .then(() => {
          const response: ContentToBackground = {
            type: "ACTION_DONE",
            success: true,
          };
          sendResponse(response);
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : String(err);
          const response: ContentToBackground = {
            type: "ACTION_DONE",
            success: false,
            error,
          };
          sendResponse(response);
        });
      // Return true to signal async response.
      return true;
    }
  }
);

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
// Action executor
// ---------------------------------------------------------------------------

/**
 * Executes a single action on the DOM.
 * Throws if the target element is not found or the action type is unexpected.
 */
async function executeAction(action: PilotAction): Promise<void> {
  switch (action.action) {
    case "click": {
      const el = findByPilotId(action.targetId);
      el.click();
      break;
    }
    case "type": {
      const el = findByPilotId(action.targetId);
      if (
        !(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLTextAreaElement)
      ) {
        throw new Error(`Element ${action.targetId} is not an input`);
      }
      el.focus();
      el.value = action.text;
      // Dispatch native input event so React/Vue listeners fire.
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      break;
    }
    case "scroll": {
      const delta = action.direction === "down" ? action.px : -action.px;
      window.scrollBy({ top: delta, behavior: "smooth" });
      // Give the scroll animation time to settle.
      await sleep(600);
      break;
    }
    // "navigate", "done", and "ask" are handled by the background worker.
    case "navigate":
    case "done":
    case "ask":
      break;
  }
}

/**
 * Finds an element by its data-pilot-id attribute.
 * Throws a descriptive error if the element is missing.
 */
function findByPilotId(pilotId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[${PILOT_ID_ATTR}="${pilotId}"]`
  );
  if (!el) {
    throw new Error(
      `Element with pilot ID "${pilotId}" not found. The page may have changed.`
    );
  }
  return el;
}

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Used to wait for animations or network requests triggered by DOM actions.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// Mount the floating widget after all message listeners are registered,
// so the background service worker is ready when the widget opens a port.
mountWidget();
