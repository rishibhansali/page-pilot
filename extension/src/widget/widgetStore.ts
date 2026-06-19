// Persistent store for widget state, backed by sessionStorage.
// sessionStorage is accessible from content scripts (unlike chrome.storage.session),
// is tab-scoped, survives same-tab page navigations, and is cleared on tab close.

import type { ChatMessage } from "@/types";

/** Shape of the data written to sessionStorage. */
export interface PersistedState {
  isOpen: boolean;
  messages: ChatMessage[];
}

/**
 * Returns the sessionStorage key for the current hostname.
 * github.com/pricing and github.com/settings share history; different
 * domains each get their own isolated state.
 */
const getStorageKey = (): string => `pagepilot_${location.hostname}`;

/**
 * Reads widget state from sessionStorage synchronously.
 * Falls back to defaults if no state is stored or the data is malformed.
 */
export function loadPersistedState(): PersistedState {
  try {
    const raw = sessionStorage.getItem(getStorageKey());
    if (!raw) return { isOpen: false, messages: [] };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      isOpen: parsed.isOpen === true,
      messages: Array.isArray(parsed.messages)
        ? (parsed.messages as ChatMessage[])
        : [],
    };
  } catch (err) {
    console.error("[PagePilot Store] Load error:", err);
    return { isOpen: false, messages: [] };
  }
}

/**
 * Writes widget state to sessionStorage synchronously.
 * Called whenever isOpen or messages change so navigations land in the correct state.
 */
export function savePersistedState(state: PersistedState): void {
  try {
    sessionStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch (err) {
    console.error("[PagePilot Store] Save error:", err);
  }
}

/**
 * Convenience getter — reads the current messages from sessionStorage.
 * Used by Widget.tsx when snapshotting the full state on isOpen changes.
 */
export function getPersistedMessages(): ChatMessage[] {
  return loadPersistedState().messages;
}
