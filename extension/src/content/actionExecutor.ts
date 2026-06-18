// Action executor for the Page Pilot content script.
// Translates backend ActionResponse objects into real DOM interactions.

import { findElementBySelector } from "./domExtractor";

/** Shape of the action object returned by the backend /api/navigate endpoint. */
export interface ActionResponse {
  action: "click" | "scroll" | "done" | "respond";
  selector: string | null;
  explanation: string;
  message: string | null;
}

/** Result returned by executeAction to the service worker. */
export interface ExecuteResult {
  success: boolean;
  message: string;
}

/** Returns a promise that resolves after ms milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a single action returned by the backend on the live DOM.
 * Returns a result indicating success or failure with a human-readable message.
 * All errors are caught and surfaced in the result so callers never need a try/catch.
 */
export async function executeAction(action: ActionResponse): Promise<ExecuteResult> {
  try {
    switch (action.action) {
      case "done":
        return { success: true, message: action.message ?? "Goal achieved" };

      case "respond":
        return {
          success: false,
          message: action.message ?? "Could not complete navigation",
        };

      case "scroll":
        window.scrollBy({ top: window.innerHeight, behavior: "smooth" });
        await sleep(800);
        return { success: true, message: "Scrolled down" };

      case "click": {
        const element = findElementBySelector(action.selector ?? "");
        if (!element) {
          return {
            success: false,
            message: `Could not find element: ${action.selector}`,
          };
        }

        // Highlight with brand blue (#3B82F6) so the user sees what will be clicked.
        const el = element as HTMLElement;
        const prevOutline = el.style.outline;
        el.style.outline = "2px solid #3B82F6";
        await sleep(600);
        el.style.outline = prevOutline;

        el.click();
        console.log("[PagePilot] Clicked:", action.selector);
        return { success: true, message: `Clicked ${action.explanation}` };
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Action failed: ${error}` };
  }
}
