// Persistent store for widget UI state across React mount/unmount cycles.
// Module-level variables survive the content script's lifetime (the whole tab session)
// so chat history and open/closed state are preserved when the user toggles the widget.

import type { ChatMessage } from "@/types";

let _messages: ChatMessage[] = [];
let _isOpen = false;

/** Returns the current persisted message list. */
export function getPersistedMessages(): ChatMessage[] {
  return _messages;
}

/**
 * Replaces the persisted message list.
 * Called reactively from ChatPanel whenever state.messages changes.
 */
export function setPersistedMessages(messages: ChatMessage[]): void {
  _messages = messages;
}

/** Returns whether the widget was open when the content script last ran. */
export function getPersistedIsOpen(): boolean {
  return _isOpen;
}

/**
 * Persists the open/closed state.
 * Called from Widget whenever isOpen changes so a full-page navigation
 * reopens the widget in the same state the user left it.
 */
export function setPersistedIsOpen(value: boolean): void {
  _isOpen = value;
}
