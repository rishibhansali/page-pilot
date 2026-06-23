// useChatPanel — all chat state, port connection, message persistence, and navigation events.
// Extracted into a hook so all visual variants share identical business logic.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  BackgroundToPopup,
  ChatMessage,
  PopupToBackground,
} from "@/types";
import { loadPersistedState } from "../widgetStore";

// ---------------------------------------------------------------------------
// State & reducer
// ---------------------------------------------------------------------------

export interface PanelState {
  messages: ChatMessage[];
  isNavigating: boolean;
  isWaitingForResponse: boolean;
  inputValue: string;
  pendingQuestion: string | null;
}

export type PanelAction =
  | { type: "SET_INPUT"; value: string }
  | { type: "SEND_MESSAGE"; content: string }
  | { type: "ADD_ASSISTANT"; content: string }
  | { type: "ADD_STATUS"; content: string }
  | { type: "ADD_COMPLETION"; content: string; success: boolean; isChat?: boolean }
  | { type: "SET_NAVIGATING"; value: boolean }
  | { type: "ASK_USER"; question: string }
  | { type: "RESOLVE_QUESTION" }
  | { type: "SET_MESSAGES"; messages: ChatMessage[] }
  | { type: "RESET" };

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
export function getSiteDomain(): string {
  try {
    return new URL(window.location.href).hostname;
  } catch {
    return window.location.href;
  }
}

const initialState: PanelState = {
  messages: [],
  isNavigating: false,
  isWaitingForResponse: false,
  inputValue: "",
  pendingQuestion: null,
};

/**
 * Pure reducer for all chat panel state transitions.
 * Shared across variants so state logic is tested in one place.
 */
function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "SET_INPUT":
      return { ...state, inputValue: action.value };

    case "SEND_MESSAGE":
      return {
        ...state,
        inputValue: "",
        isNavigating: false,
        isWaitingForResponse: true,
        pendingQuestion: null,
        messages: [...state.messages, makeMessage("user", action.content)],
      };

    case "ADD_ASSISTANT":
      return {
        ...state,
        isNavigating: false,
        isWaitingForResponse: false,
        messages: [...state.messages, makeMessage("assistant", action.content)],
      };

    case "ADD_STATUS":
      return {
        ...state,
        isNavigating: true,
        isWaitingForResponse: false,
        messages: [
          ...state.messages,
          makeMessage("assistant", action.content, { isStatus: true }),
        ],
      };

    case "ADD_COMPLETION":
      return {
        ...state,
        isNavigating: false,
        isWaitingForResponse: false,
        messages: [
          ...state.messages,
          action.isChat
            ? makeMessage("assistant", action.content)
            : makeMessage("assistant", action.content, { success: action.success }),
        ],
      };

    case "SET_NAVIGATING":
      return { ...state, isNavigating: action.value, isWaitingForResponse: false };

    case "ASK_USER":
      return {
        ...state,
        isNavigating: false,
        isWaitingForResponse: false,
        pendingQuestion: action.question,
        messages: [...state.messages, makeMessage("assistant", action.question)],
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
// Hook
// ---------------------------------------------------------------------------

export interface UseChatPanelReturn {
  state: PanelState;
  dispatch: React.Dispatch<PanelAction>;
  // React 18 JSX ref props require RefObject<T> (non-nullable) even though
  // useRef<T | null>(null) is the correct initialisation pattern. The cast is
  // safe: the refs are only written by the hook and read after mount.
  messagesEndRef: React.RefObject<HTMLDivElement>;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  handleSend: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleStop: () => void;
  domain: string;
}

/**
 * Manages all chat panel state: Chrome port connection, message persistence,
 * navigation event listeners, auto-scroll, and message dispatch callbacks.
 * Call once at the top of any ChatPanel variant component.
 */
export function useChatPanel(): UseChatPanelReturn {
  const [state, dispatch] = useReducer(panelReducer, initialState);
  const [isLoaded, setIsLoaded] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  // Passing null (not null!) gives React 18 the RefObject<T> type (read-only .current),
  // which is what JSX ref props require. portRef keeps | null because it is reassigned.
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const domain = getSiteDomain();

  // Open a long-lived port so the background can push step updates.
  useEffect(() => {
    const port = chrome.runtime.connect({ name: "popup" });
    portRef.current = port;

    port.onMessage.addListener((msg: BackgroundToPopup) => {
      switch (msg.type) {
        case "STEP_LOG":
          dispatch({ type: "ADD_ASSISTANT", content: msg.message });
          dispatch({ type: "SET_NAVIGATING", value: true });
          break;
        case "ACTION_EXECUTED":
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

    port.onDisconnect.addListener(() => { portRef.current = null; });
    return () => { port.disconnect(); };
  }, []);

  // Restore persisted messages and check if navigation is already running.
  useEffect(() => {
    Promise.all([
      loadPersistedState(),
      chrome.runtime.sendMessage({ type: "CHECK_ACTIVE_SESSION" }).catch(() => ({ isActive: false })),
    ])
      .then(([s, sessionCheck]) => {
        dispatch({ type: "SET_MESSAGES", messages: s.messages });
        const check = sessionCheck as { isActive?: boolean } | null;
        if (check?.isActive) dispatch({ type: "SET_NAVIGATING", value: true });
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, []);

  // Persist messages to the service worker on every change.
  useEffect(() => {
    if (!isLoaded) return;
    chrome.runtime.sendMessage({
      type: "SAVE_CHAT_HISTORY",
      payload: { messages: state.messages },
    }).catch(() => {});
  }, [state.messages, isLoaded]);

  // Listen for navigation status and completion events from the content script.
  useEffect(() => {
    const host = document.getElementById("page-pilot-root");
    if (!host) return;

    function onStatus(e: Event) {
      const { step, explanation } = (e as CustomEvent<{ step: number; explanation: string; action: string }>).detail;
      dispatch({ type: "ADD_STATUS", content: `Step ${step}: ${explanation}` });
    }
    function onComplete(e: Event) {
      const { success, message, isChat } = (e as CustomEvent<{ success: boolean; message: string; isChat?: boolean }>).detail;
      dispatch({ type: "ADD_COMPLETION", content: message, success, isChat });
    }

    host.addEventListener("pagepilot-status", onStatus);
    host.addEventListener("pagepilot-complete", onComplete);
    return () => {
      host.removeEventListener("pagepilot-status", onStatus);
      host.removeEventListener("pagepilot-complete", onComplete);
    };
  }, []);

  // Auto-focus the text input on mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // Auto-scroll to the latest message whenever the list changes.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages, state.isNavigating, state.isWaitingForResponse]);

  const handleSend = useCallback(() => {
    const text = state.inputValue.trim();
    if (!text) return;
    if (state.pendingQuestion !== null) {
      dispatch({ type: "SEND_MESSAGE", content: text });
      dispatch({ type: "RESOLVE_QUESTION" });
      portRef.current?.postMessage({ type: "USER_ANSWER", answer: text } as PopupToBackground);
    } else {
      dispatch({ type: "SEND_MESSAGE", content: text });
      chrome.runtime.sendMessage({
        type: "USER_MESSAGE",
        payload: { userMessage: text },
      } as PopupToBackground);
    }
  }, [state.inputValue, state.pendingQuestion]);

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
    chrome.runtime.sendMessage({ type: "STOP_NAVIGATION" } as PopupToBackground);
    dispatch({ type: "SET_NAVIGATING", value: false });
  }, []);

  return { state, dispatch, messagesEndRef, inputRef, handleSend, handleKeyDown, handleStop, domain };
}
