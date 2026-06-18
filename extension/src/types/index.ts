// Central TypeScript type definitions shared across the extension.
// All types are strict — no implicit any anywhere.

// ---------------------------------------------------------------------------
// DOM Snapshot types (content script → background → backend)
// ---------------------------------------------------------------------------

/** A single interactive element extracted from the page by the content script. */
export interface SnapshotElement {
  /** Unique ID stamped onto the DOM element as data-pilot-id */
  pilotId: string;
  /** HTML tag name, lowercased */
  tag: string;
  /** Visible text content or aria-label */
  label: string;
  /** Element type for inputs (text, checkbox, submit, etc.) */
  inputType?: string;
  /** Current value for input/select/textarea */
  value?: string;
  /** href for anchor tags */
  href?: string;
  /** Whether the element is currently visible in the viewport */
  inViewport: boolean;
  /** Bounding rect for scroll targeting */
  rect: { top: number; left: number; width: number; height: number };
}

/** Full DOM snapshot sent to the backend for each navigation step. */
export interface DomSnapshot {
  /** Current page URL */
  url: string;
  /** Current page <title> */
  title: string;
  /** All interactive elements found on the page */
  elements: SnapshotElement[];
  /** Approximate token count — used to stay under Claude's context limit */
  tokenEstimate: number;
}

// ---------------------------------------------------------------------------
// Action types (backend → background → content script)
// ---------------------------------------------------------------------------

/** Click a specific element by its pilot ID. */
export interface ClickAction {
  action: "click";
  targetId: string;
}

/** Type text into an input element. */
export interface TypeAction {
  action: "type";
  targetId: string;
  text: string;
}

/** Scroll the page by a pixel offset. */
export interface ScrollAction {
  action: "scroll";
  direction: "up" | "down";
  px: number;
}

/** Navigate the tab to a new URL. */
export interface NavigateAction {
  action: "navigate";
  url: string;
}

/** The goal has been completed. */
export interface DoneAction {
  action: "done";
  message: string;
}

/** Claude needs more information from the user before proceeding. */
export interface AskAction {
  action: "ask";
  question: string;
}

export type PilotAction =
  | ClickAction
  | TypeAction
  | ScrollAction
  | NavigateAction
  | DoneAction
  | AskAction;

// ---------------------------------------------------------------------------
// Messaging types (chrome.runtime.sendMessage contracts)
// ---------------------------------------------------------------------------

/** Messages the widget sends to the background service worker. */
export type PopupToBackground =
  | { type: "START_SESSION"; goal: string }
  | { type: "PAUSE_SESSION" }
  | { type: "STOP_SESSION" }
  | { type: "STOP_NAVIGATION" }
  | { type: "USER_ANSWER"; answer: string }
  | { type: "USER_MESSAGE"; payload: { userMessage: string } };

/** Messages the background sends back to the widget. */
export type BackgroundToPopup =
  | { type: "STEP_LOG"; message: string }
  | { type: "ACTION_EXECUTED"; action: PilotAction }
  | { type: "SESSION_DONE"; message: string }
  | { type: "SESSION_ERROR"; error: string }
  | { type: "ASK_USER"; question: string };

/** Messages the background sends to the content script. */
export type BackgroundToContent =
  | { type: "GET_SNAPSHOT" }
  | { type: "GET_SKELETON" }
  | { type: "EXECUTE_ACTION"; action: PilotAction }
  | { type: "WAIT_FOR_SETTLE" }
  | { type: "STATUS_UPDATE"; payload: { step: number; explanation: string; action: string } }
  | { type: "NAVIGATION_COMPLETE"; payload: { success: boolean; message: string } }
  | { type: "STOP_NAVIGATION" };

/** Messages the content script sends back to the background. */
export type ContentToBackground =
  | { type: "SNAPSHOT_RESULT"; snapshot: DomSnapshot }
  | { type: "ACTION_DONE"; success: boolean; error?: string }
  | { type: "ACTION_COMPLETE"; payload: { success: boolean; message: string } }
  | { type: "PAGE_SETTLING"; payload: { previousUrl: string } };

// ---------------------------------------------------------------------------
// API types (extension ↔ backend)
// ---------------------------------------------------------------------------

/** Request body for POST /api/navigate */
export interface NavigateRequest {
  goal: string;
  snapshot: DomSnapshot;
  history: PilotAction[];
}

/** Response body from POST /api/navigate */
export interface NavigateResponse {
  action: PilotAction;
}

// ---------------------------------------------------------------------------
// Session status (used by background service worker)
// ---------------------------------------------------------------------------

export type SessionStatus = "idle" | "running" | "paused" | "done" | "error";

// ---------------------------------------------------------------------------
// Widget types
// ---------------------------------------------------------------------------

/** Which half of the viewport the floating widget button is currently on. */
export type WidgetSide = "left" | "right";

/** Full position state for the draggable widget button. */
export interface WidgetPosition {
  /** Distance in px from the left viewport edge. */
  x: number;
  /** Distance in px from the top viewport edge. */
  y: number;
  /** Which horizontal half the button is currently occupying. */
  side: WidgetSide;
}

/** A single message in the ChatPanel conversation history. */
export interface ChatMessage {
  /** Unique identifier — used as React key and for deduplication. */
  id: string;
  /** "user" for messages typed by the human; "assistant" for Claude/system messages. */
  role: "user" | "assistant";
  /** Rendered message text. */
  content: string;
  /** Unix timestamp in milliseconds — used for the time label below the bubble. */
  timestamp: number;
  /** When true, renders a LoadingState bubble instead of content. */
  isLoading?: boolean;
  /** When true, this is a live step-progress message, not a final result. */
  isStatus?: boolean;
  /** Set on NAVIGATION_COMPLETE messages — true for success, false for failure. */
  success?: boolean;
}

/** Full state of one navigation session as tracked by the ChatPanel. */
export interface SessionState {
  /** Stable identifier for this session (for future Supabase persistence). */
  sessionId: string;
  /** Hostname of the page where the session started. */
  siteUrl: string;
  /** Ordered chat messages shown in the panel. */
  messages: ChatMessage[];
  /** True while the AI loop is running and the user cannot send a new goal. */
  isNavigating: boolean;
}
