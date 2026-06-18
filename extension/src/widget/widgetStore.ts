// Persistent store for widget state, backed by chrome.storage.session.
// chrome.storage.session persists across page navigations within the same tab
// and is cleared when the tab closes — perfect tab-scoped behavior.

import type { ChatMessage } from "@/types";

/** Shape of the data written to chrome.storage.session. */
interface PersistedState {
  isOpen: boolean;
  messages: ChatMessage[];
}

/** Module-level cache so synchronous reads reflect the most recent save. */
let _cachedState: PersistedState = { isOpen: false, messages: [] };

/**
 * Returns the storage key for the current hostname.
 * github.com/pricing and github.com/settings share history; different
 * domains each get their own isolated state.
 */
const getStorageKey = (): string => `pagepilot_${location.hostname}`;

/**
 * Loads persisted widget state from chrome.storage.session.
 * Falls back to defaults when no state is stored for this hostname.
 * Also updates the in-memory cache so synchronous reads stay current.
 * Wrapped in try/catch so a storage quota error or unexpected data shape
 * never leaves the widget stuck in a non-rendered state.
 */
export async function loadPersistedState(): Promise<PersistedState> {
  try {
    const key = getStorageKey();
    const result = await chrome.storage.session.get(key);
    const stored = result[key];
    if (stored && typeof stored === "object") {
      const state: PersistedState = {
        isOpen: (stored as Record<string, unknown>).isOpen === true,
        messages: Array.isArray((stored as Record<string, unknown>).messages)
          ? ((stored as Record<string, unknown>).messages as ChatMessage[])
          : [],
      };
      _cachedState = state;
      return state;
    }
    return { isOpen: false, messages: [] };
  } catch (err) {
    console.error("[PagePilot] Storage error in loadPersistedState:", err);
    return { isOpen: false, messages: [] };
  }
}

/**
 * Saves widget state to chrome.storage.session and updates the in-memory cache.
 * Called whenever isOpen or messages change so page navigations land in the
 * correct state.
 */
export async function savePersistedState(state: PersistedState): Promise<void> {
  _cachedState = state;
  await chrome.storage.session.set({ [getStorageKey()]: state });
}

/**
 * Returns the cached messages array for synchronous reads.
 * The cache is populated by loadPersistedState and kept current by every
 * savePersistedState call, so this is always up to date within one tab session.
 */
export function getPersistedMessages(): ChatMessage[] {
  return _cachedState.messages;
}
