// Variant C ChatPanel — full liquid glass visionOS-style sidebar.
// Three visual layers: dark gradient base → frosted glass → animated aurora at top.
// Message bubbles spring in with cubic-bezier(0.34,1.56,0.64,1).
// Loading uses a chromatic shimmer scan-line instead of dots.

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

/** Message bubble with spring entry animations and visionOS glass style. */
function MessageBubble({ message }: { message: ChatMessage }): React.JSX.Element {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex flex-col gap-1 items-end">
        <div className="pp-c-msg-user max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed text-white">
          {message.content}
        </div>
        <span className="text-[10px] text-white/25 px-1">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  if (message.isStatus) {
    return (
      <div className="flex items-start">
        <div className="pp-c-msg-status max-w-[90%] rounded-md pl-3 pr-4 py-1.5 text-xs leading-relaxed text-white/45">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.success !== undefined) {
    const cls = message.success ? "pp-c-msg-success text-green-400" : "pp-c-msg-error text-orange-400";
    return (
      <div className="flex flex-col gap-1 items-start">
        <div className={`${cls} max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed`}>
          {message.content}
        </div>
        <span className="text-[10px] text-white/25 px-1">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <div className="pp-c-msg-assistant max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed text-white/82">
        {message.content}
      </div>
      <span className="text-[10px] text-white/25 px-1">{formatTime(message.timestamp)}</span>
    </div>
  );
}

/**
 * Shimmer scan-line loading indicator.
 * A chromatic gradient sweeps left-to-right over a glass bar — no dots.
 */
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
      <div className="pp-c-shimmer-bar max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3">
        <p className="text-sm text-white/55 leading-relaxed relative z-10"
          style={{ filter: "blur(0.4px)" }}>
          {MESSAGES[idx]}
        </p>
        {/* Glowing dots — purple tinted for Variant C */}
        <div className="flex gap-1.5 mt-2.5 relative z-10">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="pp-c-dot w-1.5 h-1.5 rounded-full"
              style={{ animationDelay: `${i * 0.22}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Typing dots with purple glow for Variant C. */
function TypingIndicator(): React.JSX.Element {
  return (
    <div className="flex items-start">
      <div className="pp-c-msg-assistant rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="pp-c-dot w-1.5 h-1.5 rounded-full"
            style={{ animationDelay: `${i * 0.22}s` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Full-height visionOS-style glass sidebar.
 * The panel is three layers: gradient background + blur + aurora glow.
 * A glowing stop button pulses red during navigation.
 */
export default function ChatPanel({ side, onClose }: Props): React.JSX.Element {
  const { state, dispatch, messagesEndRef, inputRef, handleSend, handleKeyDown, handleStop, domain } = useChatPanel();

  const panelCls = side === "left" ? "pp-c-panel-left" : "pp-c-panel-right";
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
        overflow: "hidden",
      }}
      className={panelCls}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Aurora gradient layer — bleeds in from the top, slowly animated */}
      <div
        className="pp-c-aurora pointer-events-none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 220,
          zIndex: 0,
        }}
      />

      {/* ── Header ── */}
      <div className="pp-c-header relative z-10 flex items-center justify-between px-5 py-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Logo orb — mini version of the widget orb */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "radial-gradient(circle at 30% 28%, rgba(255,255,255,0.18), rgba(7,10,30,0.88))",
              border: "1px solid rgba(255,255,255,0.16)",
              boxShadow: "0 0 12px rgba(99,102,241,0.3), inset 0 1px 0 rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true"
              style={{ fill: "rgba(200,220,255,0.9)" }}>
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </div>
          <div>
            <p className="text-white/90 text-sm font-semibold leading-tight tracking-tight">Page Pilot</p>
            <p className="text-white/32 text-[11px] truncate max-w-[160px] mt-0.5">{domain}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {state.isNavigating && (
            <button
              onClick={handleStop}
              className="text-xs font-medium px-3 py-1 rounded-lg transition-all duration-150"
              style={{
                color: "rgba(252,165,165,0.9)",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                boxShadow: "0 0 12px rgba(239,68,68,0.1)",
              }}
            >
              Stop
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close Page Pilot"
            className="w-7 h-7 flex items-center justify-center rounded-xl text-white/25 hover:text-white/60 transition-colors duration-150"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 min-h-0">
        {state.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center">
            {/* Empty-state orb */}
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.15), rgba(7,10,30,0.88))",
                border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 0 24px rgba(99,102,241,0.25), 0 0 48px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-6 h-6"
                style={{ fill: "rgba(165,180,252,0.8)" }}>
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </div>
            <div>
              <p className="text-white/60 text-sm font-medium tracking-tight">Where to?</p>
              <p className="text-white/28 text-xs mt-1.5 leading-relaxed">Tell me what you want to accomplish on this page.</p>
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

      {/* ── Input tray ── */}
      <div className="pp-c-input-tray relative z-10 flex-shrink-0 p-4">
        {state.pendingQuestion && (
          <p className="text-[11px] text-yellow-400/60 mb-2.5 px-1">
            Answering Claude's question above ↑
          </p>
        )}
        <div className="flex gap-2.5 items-end">
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
            className="pp-c-input flex-1 rounded-xl text-white/88 text-sm px-3.5 py-2.5 placeholder-white/22 resize-none leading-relaxed disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          <button
            onClick={handleSend}
            disabled={!state.inputValue.trim() || isInputDisabled}
            aria-label="Send"
            className="pp-c-send-btn flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed"
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
