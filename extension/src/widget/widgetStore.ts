// Persistent store for widget state, backed by the background service worker.
// Using the service worker (keyed by tab ID) instead of sessionStorage so chat
// history survives cross-origin navigations within the same tab — sessionStorage
// is origin-scoped and gets cleared whenever the hostname changes.

import type { ChatMessage } from "@/types";

/** Shape of the data stored per tab in the background service worker. */
export interface PersistedState {
  isOpen: boolean;
  messages: ChatMessage[];
}

/**
 * Reads widget state from the background service worker.
 * Falls back to defaults if the service worker is unavailable.
 */
export async function loadPersistedState(): Promise<PersistedState> {
  try {
    const [historyRes, openRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_CHAT_HISTORY" }),
      chrome.runtime.sendMessage({ type: "GET_WIDGET_OPEN_STATE" }),
    ]);
    return {
      isOpen: (openRes as { isOpen?: boolean })?.isOpen ?? false,
      messages: (historyRes as { messages?: ChatMessage[] })?.messages ?? [],
    };
  } catch (err) {
    console.error("[PagePilot Store] Load error:", err);
    return { isOpen: false, messages: [] };
  }
}

/**
 * Writes widget state to the background service worker.
 * Called whenever isOpen or messages change so navigations land in the correct state.
 */
export async function savePersistedState(state: PersistedState): Promise<void> {
  try {
    await Promise.all([
      chrome.runtime.sendMessage({
        type: "SAVE_CHAT_HISTORY",
        payload: { messages: state.messages },
      }),
      chrome.runtime.sendMessage({
        type: "SAVE_WIDGET_OPEN_STATE",
        payload: { isOpen: state.isOpen },
      }),
    ]);
  } catch (err) {
    console.error("[PagePilot Store] Save error:", err);
  }
}
