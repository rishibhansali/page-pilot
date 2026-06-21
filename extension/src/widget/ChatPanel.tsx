// ChatPanel — the expanded chat interface overlaid on the host page.
// Opens on the same side as the draggable widget button.
// Manages the Chrome runtime port connection to the background service worker
// and converts background messages into ChatMessage objects for display.

import React, { useCallback, useEffect, useRef, useReducer, useState } from "react";
import type {
  BackgroundToPopup,
  ChatMessage,
  PopupToBackground,
  WidgetPosition,
} from "@/types";
import ChatMessageBubble from "./ChatMessage";
import LoadingState from "./LoadingState";
import { loadPersistedState } from "./widgetStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  /** Which side of the viewport the panel should open on. */
  side: WidgetPosition["side"];
  /** Called when the user clicks the close button. */
  onClose: () => void;
}

interface PanelState {
  messages: ChatMessage[];
  isNavigating: boolean;
  inputValue: string;
  pendingQuestion: string | null;
}

type PanelAction =
  | { type: "SET_INPUT"; value: string }
  | { type: "SEND_MESSAGE"; content: string }
  | { type: "ADD_ASSISTANT"; content: string }
  | { type: "ADD_STATUS"; content: string }
  | { type: "ADD_COMPLETION"; content: string; success: boolean }
  | { type: "SET_NAVIGATING"; value: boolean }
  | { type: "ASK_USER"; question: string }
  | { type: "RESOLVE_QUESTION" }
  | { type: "SET_MESSAGES"; messages: ChatMessage[] }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a new ChatMessage object with a generated ID and current timestamp. */
function makeMessage(
  role: ChatMessage["role"],
  content: string,
  extra: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    content,
    timestamp: Date.now(),
    ...extra,
  };
}

/** Returns the host page's domain for display in the panel header. */
function getSiteDomain(): string {
  try {
    return new URL(window.location.href).hostname;
  } catch {
    return window.location.href;
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialState: PanelState = {
  messages: [],
  isNavigating: false,
  inputValue: "",
  pendingQuestion: null,
};

/**
 * Pure reducer for all chat panel state transitions.
 * Keeping logic here makes the component render-only and the state
 * transitions easy to reason about and test.
 */
function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "SET_INPUT":
      return { ...state, inputValue: action.value };

    case "SEND_MESSAGE":
      return {
        ...state,
        inputValue: "",
        isNavigating: true,
        pendingQuestion: null,
        messages: [
          ...state.messages,
          makeMessage("user", action.content),
        ],
      };

    case "ADD_ASSISTANT":
      return {
        ...state,
        isNavigating: false,
        messages: [
          ...state.messages,
          makeMessage("assistant", action.content),
        ],
      };

    case "ADD_STATUS":
      // Status messages show live progress — keep isNavigating true.
      return {
        ...state,
        messages: [
          ...state.messages,
          makeMessage("assistant", action.content, { isStatus: true }),
        ],
      };

    case "ADD_COMPLETION":
      // Terminal message — re-enables the input.
      return {
        ...state,
        isNavigating: false,
        messages: [
          ...state.messages,
          makeMessage("assistant", action.content, { success: action.success }),
        ],
      };

    case "SET_NAVIGATING":
      return { ...state, isNavigating: action.value };

    case "ASK_USER":
      return {
        ...state,
        isNavigating: false,
        pendingQuestion: action.question,
        messages: [
          ...state.messages,
          makeMessage("assistant", action.question),
        ],
      };

    case "RESOLVE_QUESTION":
      return { ...state, pendingQuestion: null };

    case "SET_MESSAGES":
      return { ...state, messages: action.messages };

    case "RESET":
      return initialState;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatPanel({ side, onClose }: Props): React.JSX.Element {
  const [state, dispatch] = useReducer(panelReducer, initialState);
  // Prevents the message persist effect from firing before the initial async load
  // has returned — otherwise it would write an empty messages array on first render.
  const [isLoaded, setIsLoaded] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const domain = getSiteDomain();

  // ---------------------------------------------------------------------------
  // Background port connection
  // ---------------------------------------------------------------------------

  useEffect(() => {
    /**
     * Open a long-lived port to the background service worker.
     * This lets the background push step updates without the widget polling.
     */
    const port = chrome.runtime.connect({ name: "popup" });
    portRef.current = port;

    port.onMessage.addListener((msg: BackgroundToPopup) => {
      switch (msg.type) {
        case "STEP_LOG":
          // Step logs are internal; surface them as assistant messages so the
          // user can see what the AI is doing at each step.
          dispatch({ type: "ADD_ASSISTANT", content: msg.message });
          dispatch({ type: "SET_NAVIGATING", value: true });
          break;

        case "ACTION_EXECUTED":
          // Keep navigating flag true — this isn't the final message.
          dispatch({ type: "SET_NAVIGATING", value: true });
          break;

        case "SESSION_DONE":
          dispatch({ type: "ADD_ASSISTANT", content: `✓ ${msg.message}` });
          break;

        case "SESSION_ERROR":
          dispatch({ type: "ADD_ASSISTANT", content: `✗ Error: ${msg.error}` });
          break;

        case "ASK_USER":
          dispatch({ type: "ASK_USER", question: msg.question });
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });

    return () => {
      port.disconnect();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Restore messages from the service worker on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    loadPersistedState()
      .then((s) => {
        dispatch({ type: "SET_MESSAGES", messages: s.messages });
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, []);

  // ---------------------------------------------------------------------------
  // Persist messages to the service worker on every change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isLoaded) return;
    chrome.runtime.sendMessage({
      type: "SAVE_CHAT_HISTORY",
      payload: { messages: state.messages },
    }).catch(() => { /* service worker may be restarting */ });
  }, [state.messages, isLoaded]);

  // ---------------------------------------------------------------------------
  // Navigation event listeners (dispatched by the content script)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    /**
     * Events are dispatched on the shadow host element (#page-pilot-root) by
     * the content script. Listening here (on the same host element) avoids any
     * shadow-boundary crossing issues that arise when using document directly.
     */
    const host = document.getElementById("page-pilot-root");
    if (!host) return;

    /**
     * pagepilot-status fires once per loop step with { step, explanation, action }.
     * Show it as a live progress bubble without ending the navigating state.
     */
    function onStatus(e: Event) {
      const { step, explanation } = (e as CustomEvent<{ step: number; explanation: string; action: string }>).detail;
      dispatch({ type: "ADD_STATUS", content: `Step ${step}: ${explanation}` });
    }

    /**
     * pagepilot-complete fires when the loop ends (success, error, or stop).
     * Display the final message with success/error styling and re-enable the input.
     */
    function onComplete(e: Event) {
      const { success, message } = (e as CustomEvent<{ success: boolean; message: string }>).detail;
      dispatch({ type: "ADD_COMPLETION", content: message, success });
    }

    host.addEventListener("pagepilot-status", onStatus);
    host.addEventListener("pagepilot-complete", onComplete);

    return () => {
      host.removeEventListener("pagepilot-status", onStatus);
      host.removeEventListener("pagepilot-complete", onComplete);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-focus the input when the panel mounts (i.e. when the user opens it)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-scroll to latest message
  // ---------------------------------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages, state.isNavigating]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Sends the user's message to the background and starts a navigation session.
   * If there's a pending question from Claude, routes the answer back instead.
   */
  const handleSend = useCallback(() => {
    const text = state.inputValue.trim();
    if (!text) return;

    if (state.pendingQuestion !== null) {
      // This is a reply to Claude's "ask" action — route as USER_ANSWER.
      dispatch({ type: "SEND_MESSAGE", content: text });
      dispatch({ type: "RESOLVE_QUESTION" });
      const msg: PopupToBackground = { type: "USER_ANSWER", answer: text };
      portRef.current?.postMessage(msg);
    } else {
      // New goal — optimistic UI update, then kick off the navigation loop.
      dispatch({ type: "SEND_MESSAGE", content: text });
      chrome.runtime.sendMessage({
        type: "USER_MESSAGE",
        payload: { userMessage: text },
      } as PopupToBackground);
      // isNavigating stays true until pagepilot-complete fires.
    }
  }, [state.inputValue, state.pendingQuestion]);

  /** Allows submitting with Enter (Shift+Enter for newline). */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleStop = useCallback(() => {
    // STOP_NAVIGATION cancels the observe-act-observe loop in the service worker.
    chrome.runtime.sendMessage({ type: "STOP_NAVIGATION" } as PopupToBackground);
    dispatch({ type: "SET_NAVIGATING", value: false });
  }, []);

  // ---------------------------------------------------------------------------
  // Panel positioning (fixed, full viewport height, 1/3 width)
  // ---------------------------------------------------------------------------

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    [side]: 0,
    width: "clamp(320px, 33.333vw, 520px)",
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={panelStyle}
      className="bg-navy border-r border-l border-slate-800 shadow-2xl"
      // Prevent clicks inside the panel from propagating to the host page.
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-pilot-blue flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="white"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </div>
          <div>
            <p className="text-white text-sm font-semibold leading-tight">Page Pilot</p>
            <p className="text-slate-500 text-xs truncate max-w-[160px]">{domain}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {state.isNavigating && (
            <button
              onClick={handleStop}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-md hover:bg-red-400/10 transition-colors"
            >
              Stop
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close Page Pilot"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Message history ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 min-h-0">
        {state.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-pilot-blue/10 border border-pilot-blue/20 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-pilot-blue">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </div>
            <div>
              <p className="text-slate-300 text-sm font-medium">Where to?</p>
              <p className="text-slate-500 text-xs mt-1">Tell me what you want to accomplish on this page.</p>
            </div>
          </div>
        )}

        {state.messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}

        {/* Loading indicator — shown after the last message while navigating */}
        {state.isNavigating && <LoadingState />}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="flex-shrink-0 border-t border-slate-800 p-3">
        {state.pendingQuestion && (
          <p className="text-xs text-yellow-400 mb-2 px-1">
            Answering Claude's question above ↑
          </p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={state.inputValue}
            onChange={(e) => dispatch({ type: "SET_INPUT", value: e.target.value })}
            onKeyDown={handleKeyDown}
            disabled={state.isNavigating && state.pendingQuestion === null}
            placeholder={
              state.isNavigating
                ? "Navigating…"
                : state.pendingQuestion
                ? "Type your answer…"
                : "What do you want me to do?"
            }
            rows={1}
            className={[
              "flex-1 rounded-xl bg-navy-light border text-white text-sm px-3 py-2.5",
              "placeholder-slate-500 resize-none leading-relaxed",
              "focus:outline-none focus:ring-2 focus:ring-pilot-blue",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "transition-colors",
              state.isNavigating && state.pendingQuestion === null
                ? "border-slate-800"
                : "border-slate-700",
            ].join(" ")}
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          <button
            onClick={handleSend}
            disabled={
              !state.inputValue.trim() ||
              (state.isNavigating && state.pendingQuestion === null)
            }
            aria-label="Send"
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-pilot-blue flex items-center justify-center
                       hover:bg-pilot-blue-dark transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="white" className="w-4 h-4">
              <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
