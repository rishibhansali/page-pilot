// DOM extractor for Page Pilot — reads the live page and returns a compact
// text summary of all interactive elements suitable for sending to Claude.
// This is the only place that touches the DOM for extraction; no side-effects
// other than stamping data-pagepilot-id on elements that have no better selector.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Attribute we stamp on elements when no stable selector can be derived. */
const PP_ID_ATTR = "data-pagepilot-id";

/** Maximum elements returned. Keeps Claude prompts under token budget. */
const MAX_ELEMENTS = 150;

/** Maximum characters kept from any label — long labels waste tokens. */
const MAX_LABEL_LENGTH = 60;

/**
 * All element types we expose to Claude.
 * Input types are explicit so we don't capture hidden, checkbox, radio, file, etc.
 */
const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input[type="password"]',
  "select",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
].join(", ");

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ElementKind = "button" | "link" | "input" | "select";

interface ExtractedElement {
  kind: ElementKind;
  label: string;
  selector: string;
  inViewport: boolean;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * Returns true if the element is visually present and reachable by the user.
 * Filters display:none, visibility:hidden, zero-size, and aria-hidden elements
 * because Claude has no value in knowing about them.
 */
function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// ---------------------------------------------------------------------------
// Type classification
// ---------------------------------------------------------------------------

/**
 * Maps an element to one of the four kinds Claude understands.
 * role attributes take precedence over tag name for semantic correctness.
 */
function getKind(el: Element): ElementKind {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  if (tag === "a" || role === "link") return "link";
  if (tag === "input") return "input";
  if (tag === "select") return "select";
  return "button"; // button, role=button, role=menuitem all map to "button"
}

// ---------------------------------------------------------------------------
// Label extraction
// ---------------------------------------------------------------------------

/**
 * Returns the best human-readable label for an element, in priority order:
 *   1. aria-label
 *   2. aria-labelledby (resolves referenced element(s) text)
 *   3. visible innerText
 *   4. placeholder (inputs)
 *   5. title attribute
 * Returns null if no label can be found — unlabelled elements are skipped
 * entirely because they give Claude nothing useful to reason about.
 */
function getLabel(el: Element): string | null {
  // 1. aria-label
  const ariaLabel = el.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel.slice(0, MAX_LABEL_LENGTH);

  // 2. aria-labelledby — can reference multiple space-separated IDs
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const resolved = labelledBy
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter((t): t is string => Boolean(t))
      .join(" ");
    if (resolved) return resolved.slice(0, MAX_LABEL_LENGTH);
  }

  // 3. innerText — only available on HTMLElement, not Element
  if (el instanceof HTMLElement) {
    const text = el.innerText?.trim();
    if (text) return text.slice(0, MAX_LABEL_LENGTH);
  }

  // 4. placeholder (inputs, textareas)
  const placeholder = el.getAttribute("placeholder")?.trim();
  if (placeholder) return placeholder.slice(0, MAX_LABEL_LENGTH);

  // 5. title
  const title = el.getAttribute("title")?.trim();
  if (title) return title.slice(0, MAX_LABEL_LENGTH);

  return null;
}

// ---------------------------------------------------------------------------
// Selector generation
// ---------------------------------------------------------------------------

/**
 * Attempts to build a short CSS selector from tag + classes.
 * Checks uniqueness against the live DOM — returns null if not unique
 * (i.e. multiple elements match) so we fall through to injecting a pp-id.
 * Max 2 ancestry levels to keep selectors readable in prompts.
 */
function buildCssPath(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  // Filter classes that start with digits (invalid in CSS) and classes that
  // contain colons (Tailwind responsive/variant prefixes like sm:flex, hover:bg-blue)
  // — unescaped colons are invalid in querySelectorAll selectors.
  const classes = Array.from(el.classList)
    .filter((c) => /^[a-zA-Z_-]/.test(c) && !c.includes(":"))
    .slice(0, 3);

  const selfSel = classes.length ? `${tag}.${classes.join(".")}` : tag;
  try {
    if (document.querySelectorAll(selfSel).length === 1) return selfSel;
  } catch {
    return null;
  }

  const parent = el.parentElement;
  if (parent && parent !== document.body) {
    const ptag = parent.tagName.toLowerCase();
    const pclasses = Array.from(parent.classList)
      .filter((c) => /^[a-zA-Z_-]/.test(c) && !c.includes(":"))
      .slice(0, 2);
    const parentSel = pclasses.length
      ? `${ptag}.${pclasses.join(".")}`
      : ptag;
    const combined = `${parentSel} > ${selfSel}`;
    try {
      if (document.querySelectorAll(combined).length === 1) return combined;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Generates the shortest stable selector for an element, in priority order:
 *   1. #id — only if the id is unique in the document (some pages reuse ids)
 *   2. [data-testid], [data-cy], [data-id] — test/automation attributes
 *   3. Pathname for same-origin links (e.g. /pricing)
 *   4. CSS path (tag + classes, max 2 levels)
 *   5. Injected data-pagepilot-id — last resort, always unique
 *
 * The ppId argument is the candidate pp-N string to stamp if we reach step 5.
 */
function generateSelector(el: Element, ppId: string): string {
  // 1. id attribute — verify uniqueness because invalid HTML often reuses ids
  const id = el.getAttribute("id")?.trim();
  if (id) {
    try {
      if (document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
        return `#${id}`;
      }
    } catch {
      // CSS.escape shouldn't throw, but be safe
    }
  }

  // 2. Unique data attributes used by test frameworks
  for (const attr of ["data-testid", "data-cy", "data-id"]) {
    const val = el.getAttribute(attr);
    if (val) return `[${attr}='${val}']`;
  }

  // 3. Pathname for same-origin anchor links — only when the pathname is unique
  //    across all anchors on the page. Blogspot nav tabs often all share href="/"
  //    (onclick-driven); returning "/" for all of them makes them indistinguishable
  //    to the model and causes it to invent selectors or click the wrong element.
  if (el instanceof HTMLAnchorElement) {
    const hrefAttr = el.getAttribute("href");
    if (hrefAttr) {
      try {
        const url = new URL(el.href, window.location.href);
        if (url.origin === window.location.origin && url.pathname) {
          const pathname = url.pathname;
          // Only use the pathname as a selector when it uniquely identifies this link.
          if (document.querySelectorAll(`a[href='${pathname}']`).length === 1) {
            return pathname;
          }
          // Pathname not unique — fall through to CSS path or pp-id below.
        }
      } catch {
        // href may be javascript:void(0) or other non-URL value — fall through
      }
    }
  }

  // 4. CSS path
  const cssPath = buildCssPath(el);
  if (cssPath) return cssPath;

  // 5. Inject our own stable attribute — guaranteed unique per run
  el.setAttribute(PP_ID_ATTR, ppId);
  return `[${PP_ID_ATTR}='${ppId}']`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scans the live page for all visible interactive elements and returns a
 * compact text summary, one element per line:
 *   [type] "label text" selector
 *
 * Viewport elements are listed first so Claude sees the most immediately
 * actionable elements at the top of the context. Total output is capped at
 * MAX_ELEMENTS (150) lines.
 *
 * Side-effect: stamps data-pagepilot-id on elements that needed a fallback
 * selector. Clears stale stamps from the previous run first.
 */
export function extractPageSkeleton(): string {
  // Clear stale pp-ids from any previous call so counters stay consistent
  // and removed elements don't leave ghost attributes in the DOM.
  document.querySelectorAll(`[${PP_ID_ATTR}]`).forEach((el) => {
    el.removeAttribute(PP_ID_ATTR);
  });

  const allElements = Array.from(
    document.querySelectorAll<Element>(INTERACTIVE_SELECTOR)
  );

  const extracted: ExtractedElement[] = [];
  let ppCounter = 1;

  for (const el of allElements) {
    if (!isVisible(el)) continue;

    const label = getLabel(el);
    if (!label) continue; // skip — unlabelled elements are useless to Claude

    const kind = getKind(el);
    const ppId = `pp-${ppCounter++}`;
    const selector = generateSelector(el, ppId);
    const rect = el.getBoundingClientRect();
    const inViewport = rect.top >= 0 && rect.top < window.innerHeight;

    extracted.push({ kind, label, selector, inViewport });
  }

  // Viewport elements first — Claude should act on visible elements before
  // attempting to scroll to off-screen ones.
  extracted.sort((a, b) => {
    if (a.inViewport === b.inViewport) return 0;
    return a.inViewport ? -1 : 1;
  });

  return extracted
    .slice(0, MAX_ELEMENTS)
    .map(({ kind, label, selector }) => `[${kind}] "${label}" ${selector}`)
    .join("\n");
}

/**
 * Resolves one of our generated selector strings back to a live DOM element.
 * Handles the pathname shorthand ("/pricing") used for same-origin links.
 * Falls back to looser matching strategies before giving up.
 * Returns null if no matching element is found.
 */
export function findElementBySelector(selector: string): Element | null {
  // Pathname shorthand — find <a> whose href matches this path
  if (selector.startsWith("/")) {
    return (
      document.querySelector<HTMLAnchorElement>(`a[href='${selector}']`) ??
      // Some sites append query strings; prefix-match as fallback
      document.querySelector<HTMLAnchorElement>(`a[href^='${selector}']`) ??
      // Fallback 2 — loose substring match on any visible anchor
      findVisibleAnchorByHrefSubstring(selector) ??
      null
    );
  }

  // Standard CSS selector — wrap in try/catch because a malformed selector
  // would otherwise throw and crash the content script.
  let result: Element | null = null;
  try {
    result = document.querySelector(selector);
  } catch {
    result = null;
  }

  if (result) return result;

  // Fallback 1 — href pattern extraction:
  // The model sometimes invents compound selectors like `nav a[href*='/pricing']`.
  // Pull the path out of the href attribute pattern and do a visible-link search.
  if (selector.includes("href*=") || selector.includes("href=")) {
    const pathMatch = selector.match(/href[*^$]?=["']?([^"'\]]+)/);
    if (pathMatch) {
      return findVisibleAnchorByHrefSubstring(pathMatch[1]) ?? null;
    }
  }

  return null;
}

/**
 * Returns the first visible <a> whose href or pathname includes `path`.
 * Used as a last-resort fallback when a generated CSS selector fails to match.
 */
function findVisibleAnchorByHrefSubstring(path: string): HTMLAnchorElement | null {
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const anchor of anchors) {
    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.pathname.includes(path) || anchor.href.includes(path)) {
        const rect = anchor.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return anchor;
      }
    } catch {
      // Non-navigable hrefs (javascript:void(0), mailto:, etc.) — skip
    }
  }
  return null;
}
