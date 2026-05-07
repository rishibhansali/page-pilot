// Widget entry point — mounts the Page Pilot floating widget into every page.
// Uses a Shadow DOM container so our Tailwind styles never conflict with
// the host website's CSS, no matter what framework or stylesheet they use.

import React from "react";
import ReactDOM from "react-dom/client";
import Widget from "./Widget";
// Import compiled CSS as an inline string so we can inject it into the shadow root.
// The ?inline suffix is a Vite feature — Tailwind compiles the CSS at build time,
// Vite returns it as a plain string rather than injecting it into <head>.
import widgetStyles from "./styles.css?inline";

/**
 * Creates an isolated Shadow DOM host on document.body and mounts the Widget
 * React tree inside it. Called once by the content script after page load.
 *
 * Shadow DOM is the critical piece: every CSS rule we inject is scoped to our
 * shadow root, and the host page's stylesheets cannot reach inside it either.
 */
export function mountWidget(): void {
  // Guard against double-mounting on SPA navigations or HMR reloads.
  if (document.getElementById("page-pilot-root")) return;

  // Host element — zero-size, fixed to top-left corner, highest z-index possible.
  // Width/height are 0 because all visible UI uses position:fixed inside the shadow,
  // so the host never takes up layout space or intercepts clicks on the host page.
  const host = document.createElement("div");
  host.id = "page-pilot-root";
  host.style.cssText = [
    "position: fixed",
    "top: 0",
    "left: 0",
    "width: 0",
    "height: 0",
    "z-index: 2147483647", // max z-index — above every host page element
    "pointer-events: none", // host itself doesn't intercept clicks; children opt-in
  ].join("; ");
  document.body.appendChild(host);

  // Attach a Shadow DOM so our styles are fully encapsulated.
  // mode: "open" lets us access shadow internals from this script if needed.
  const shadow = host.attachShadow({ mode: "open" });

  // Inject compiled Tailwind CSS into the shadow root.
  // Without this, none of our Tailwind utility classes would render correctly
  // because the browser only applies document-level stylesheets to the light DOM.
  const styleEl = document.createElement("style");
  styleEl.textContent = widgetStyles;
  shadow.appendChild(styleEl);

  // Mount point inside the shadow — React renders here.
  const mountPoint = document.createElement("div");
  mountPoint.style.cssText = "pointer-events: auto"; // re-enable clicks for our UI
  shadow.appendChild(mountPoint);

  ReactDOM.createRoot(mountPoint).render(
    <React.StrictMode>
      <Widget />
    </React.StrictMode>
  );
}
