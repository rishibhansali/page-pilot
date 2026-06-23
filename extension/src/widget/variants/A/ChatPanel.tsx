// Variant A ChatPanel — frosted glass full-height sidebar.
// The host page bleeds softly through the glass panel.
// Message bubbles use individual glass micro-surfaces.

import React from "react";
import type { ChatMessage, WidgetSide } from "@/types";
import { useChatPanel } from "../../hooks/useChatPanel";

interface Props {
  side: WidgetSide;
  onClose: () => void;
}

/** Formats a Unix timestamp (ms) into a short HH:MM string. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Renders a single message bubble in the Variant A frosted glass style. */
function MessageBubble({ message }: { message: ChatMessage }): React.JSX.Element {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex flex-col gap-1 items-end">
        <div className="pp-a-msg-user max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed text-white">
          {message.content}
        </div>
        <span className="text-xs text-white/30 px-1">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  if (message.isStatus) {
    return (
      <div className="flex flex-col gap-1 items-start">
        <div className="pp-a-msg-status max-w-[90%] rounded-md pl-3 pr-4 py-1.5 text-xs leading-relaxed text-white/50">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.success !== undefined) {
    const cls = message.success ? "pp-a-msg-success text-green-400" : "pp-a-msg-error text-orange-400";
    return (
      <div className="flex flex-col gap-1 items-start">
        <div className={`${cls} max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed`}>
          {message.content}
        </div>
        <span className="text-xs text-white/30 px-1">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <div className="pp-a-msg-assistant max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed text-white/85">
        {message.content}
      </div>
      <span className="text-xs text-white/30 px-1">{formatTime(message.timestamp)}</span>
    </div>
  );
}

/** Loading indicator — three glowing dots, shown while the AI navigates. */
function LoadingIndicator(): React.JSX.Element {
  const MESSAGES = [
    "Snooping around the page…",
    "Clicking things confidently…",
    "Pretending I know where I'm going…",
    "Found something, investigating…",
    "Almost there, probably…",
    "Navigating like I own the place…",
    "One moment, doing browser things…",
    "Reading the fine print so you don't have to…",
  ] as const;

  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setIdx((p) => (p + 1) % MESSAGES.length), 2500);
    return () => clearInterval(t);
  }, [MESSAGES.length]);

  return (
    <div className="flex items-start">
      <div className="pp-a-msg-assistant max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3">
        <p className="text-sm text-white/60 leading-relaxed" style={{ filter: "blur(0.3px)" }}>
          {MESSAGES[idx]}
        </p>
        <div className="flex gap-1.5 mt-2.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-[rgba(59,130,246,0.7)]"
              style={{ animation: `pp-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Typing indicator — three bouncing dots shown while waiting for any response. */
function TypingIndicator(): React.JSX.Element {
  return (
    <div className="flex items-start">
      <div className="pp-a-msg-assistant rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-white/40"
            style={{ animation: `pp-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Full-height frosted glass sidebar chat panel.
 * Backdrop blur makes the page visible through the glass — works on any site.
 */
export default function ChatPanel({ side, onClose }: Props): React.JSX.Element {
  const { state, dispatch, messagesEndRef, inputRef, handleSend, handleKeyDown, handleStop, domain } = useChatPanel();

  const panelCls = side === "left" ? "pp-a-panel-left" : "pp-a-panel-right";

  const isInputDisabled =
    (state.isNavigating || state.isWaitingForResponse) && state.pendingQuestion === null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        [side]: 0,
        width: "clamp(320px, 33.333vw, 520px)",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        zIndex: 2147483647,
      }}
      className={panelCls}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ── */}
      <div className="pp-a-header flex items-center justify-between px-4 py-3.5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[rgba(59,130,246,0.2)] border border-[rgba(59,130,246,0.3)] flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgba(147,197,253,0.95)" className="w-4 h-4" aria-hidden="true">
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </div>
          <div>
            <p className="text-white/90 text-sm font-semibold leading-tight tracking-tight">Page Pilot</p>
            <p className="text-white/35 text-xs truncate max-w-[160px] mt-0.5">{domain}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {state.isNavigating && (
            <button
              onClick={handleStop}
              className="text-xs text-red-400/80 hover:text-red-300 px-2.5 py-1 rounded-lg hover:bg-red-400/10 transition-colors duration-150"
            >
              Stop
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close Page Pilot"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-white/70 hover:bg-white/8 transition-colors duration-150"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 min-h-0">
        {state.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[rgba(59,130,246,0.1)] border border-[rgba(59,130,246,0.18)] flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgba(147,197,253,0.7)" className="w-7 h-7">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </div>
            <div>
              <p className="text-white/60 text-sm font-medium">Where to?</p>
              <p className="text-white/30 text-xs mt-1.5 leading-relaxed">Tell me what you want to accomplish on this page.</p>
            </div>
          </div>
        )}

        {state.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {state.isNavigating && <LoadingIndicator />}

        {state.isWaitingForResponse && !state.isNavigating && <TypingIndicator />}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="pp-a-input-bar flex-shrink-0 p-3">
        {state.pendingQuestion && (
          <p className="text-xs text-yellow-400/70 mb-2 px-1">
            Answering Claude's question above ↑
          </p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={state.inputValue}
            onChange={(e) => dispatch({ type: "SET_INPUT", value: e.target.value })}
            onKeyDown={handleKeyDown}
            disabled={isInputDisabled}
            placeholder={
              state.isNavigating ? "Navigating…"
              : state.isWaitingForResponse ? "Waiting…"
              : state.pendingQuestion ? "Type your answer…"
              : "What do you want me to do?"
            }
            rows={1}
            className="pp-a-input flex-1 rounded-xl text-white/90 text-sm px-3 py-2.5 placeholder-white/25 resize-none leading-relaxed disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          <button
            onClick={handleSend}
            disabled={!state.inputValue.trim() || isInputDisabled}
            aria-label="Send"
            className="pp-a-send-btn flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
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
