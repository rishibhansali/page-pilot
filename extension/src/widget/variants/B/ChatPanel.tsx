// Variant B ChatPanel — compact floating glass card with iridescent gradient border.
// The card is draggable by its header — mousedown on the header starts a drag session.
// Initial position is computed from the widget button's location; user can reposition freely.

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, WidgetSide } from "@/types";
import { useChatPanel } from "../../hooks/useChatPanel";

const CARD_W = 380;
const CARD_H = 540;
const DRAG_THRESHOLD = 3;

interface Props {
  side: WidgetSide;
  widgetPos: { x: number; y: number };
  onClose: () => void;
}

/** Formats a Unix timestamp (ms) into a short HH:MM string. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Computes the card's initial position — anchored flush to whichever screen edge
 * the widget pill is on, vertically centred near the widget's Y position.
 */
function computeInitialPos(widgetPos: { x: number; y: number }, side: WidgetSide): { x: number; y: number } {
  const x = side === "right" ? window.innerWidth - CARD_W : 0;
  const y = Math.max(0, Math.min(window.innerHeight - CARD_H, widgetPos.y - CARD_H / 2 + 25));
  return { x, y };
}

/** Single message bubble styled for the floating card. */
function MessageBubble({ message }: { message: ChatMessage }): React.JSX.Element {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex flex-col gap-1 items-end">
        <div className="pp-b-msg-user max-w-[85%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed text-white">
          {message.content}
        </div>
        <span className="text-[10px] text-white/25 px-1">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  if (message.isStatus) {
    return (
      <div className="flex items-start">
        <div className="pp-b-msg-status max-w-[90%] rounded-md pl-3 pr-4 py-1.5 text-[11px] leading-relaxed text-white/45">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.success !== undefined) {
    const cls = message.success ? "pp-b-msg-success text-green-400" : "pp-b-msg-error text-orange-400";
    return (
      <div className="flex flex-col gap-1 items-start">
        <div className={`${cls} max-w-[85%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed`}>
          {message.content}
        </div>
        <span className="text-[10px] text-white/25 px-1">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <div className="pp-b-msg-assistant max-w-[85%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed text-white/80">
        {message.content}
      </div>
      <span className="text-[10px] text-white/25 px-1">{formatTime(message.timestamp)}</span>
    </div>
  );
}

/** Cycling loading bubble for Variant B. */
function LoadingIndicator(): React.JSX.Element {
  const MESSAGES = [
    "Snooping around…",
    "Clicking things confidently…",
    "Found something…",
    "Almost there…",
    "Navigating…",
    "Reading the fine print…",
  ] as const;
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setIdx((p) => (p + 1) % MESSAGES.length), 2500);
    return () => clearInterval(t);
  }, [MESSAGES.length]);

  return (
    <div className="flex items-start">
      <div className="pp-b-msg-assistant rounded-2xl rounded-tl-sm px-3.5 py-3">
        <p className="text-xs text-white/55 leading-relaxed" style={{ filter: "blur(0.3px)" }}>
          {MESSAGES[idx]}
        </p>
        <div className="flex gap-1.5 mt-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-[rgba(99,102,241,0.7)]"
              style={{ animation: `pp-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Typing indicator for Variant B. */
function TypingIndicator(): React.JSX.Element {
  return (
    <div className="flex items-start">
      <div className="pp-b-msg-assistant rounded-2xl rounded-tl-sm px-3.5 py-3 flex gap-1.5 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-white/35"
            style={{ animation: `pp-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Floating glass card that the user can drag freely around the screen.
 * Drag is initiated by pressing on the header bar.
 * The iridescent gradient border animates via pp-b-card-wrap.
 */
export default function ChatPanel({ side, widgetPos, onClose }: Props): React.JSX.Element {
  const { state, dispatch, messagesEndRef, inputRef, handleSend, handleKeyDown, handleStop, domain } = useChatPanel();

  // Card position — initialized once from widget location, then updated by drag.
  const [cardPos, setCardPos] = useState<{ x: number; y: number }>(
    () => computeInitialPos(widgetPos, side)
  );
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const cardDragOrigin = useRef<{
    mouseX: number;
    mouseY: number;
    cardX: number;
    cardY: number;
  } | null>(null);
  const hasDraggedCard = useRef(false);

  /** Begin dragging the card on header mousedown. */
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    hasDraggedCard.current = false;
    cardDragOrigin.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      cardX: cardPos.x,
      cardY: cardPos.y,
    };
    setIsDraggingCard(true);
  }, [cardPos]);

  useEffect(() => {
    if (!isDraggingCard) return;

    const handleMouseMove = (e: MouseEvent) => {
      const o = cardDragOrigin.current;
      if (!o) return;
      const dx = e.clientX - o.mouseX;
      const dy = e.clientY - o.mouseY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        hasDraggedCard.current = true;
      }
      setCardPos({
        x: Math.max(8, Math.min(window.innerWidth - CARD_W - 8, o.cardX + dx)),
        y: Math.max(8, Math.min(window.innerHeight - CARD_H - 8, o.cardY + dy)),
      });
    };

    const handleMouseUp = () => {
      cardDragOrigin.current = null;
      setIsDraggingCard(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingCard]);

  const isInputDisabled =
    (state.isNavigating || state.isWaitingForResponse) && state.pendingQuestion === null;

  return (
    <div
      style={{
        position: "fixed",
        left: cardPos.x,
        top: cardPos.y,
        width: CARD_W,
        height: CARD_H,
        zIndex: 2147483647,
      }}
      className="pp-b-card-wrap"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pp-b-card flex flex-col h-full">

        {/* ── Header (drag handle) ── */}
        <div
          className="pp-b-header flex-shrink-0"
          onMouseDown={handleHeaderMouseDown}
          style={{ cursor: isDraggingCard ? "grabbing" : "grab" }}
        >
          {/* Drag affordance pill */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="w-8 h-[3px] rounded-full bg-white/15" />
          </div>

          <div className="flex items-center justify-between px-4 pb-3 pt-2">
            {/* Left: glass orb logo + name + domain */}
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.18) 0%, rgba(7,10,30,0.88) 55%, rgba(20,28,70,0.75) 100%)",
                  border: "1px solid rgba(255,255,255,0.16)",
                  boxShadow: "0 0 14px rgba(99,102,241,0.32), inset 0 1px 0 rgba(255,255,255,0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style={{ width: 15, height: 15, fill: "rgba(200,220,255,0.92)" }} aria-hidden="true">
                  <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                </svg>
              </div>
              <div>
                <p className="text-white/88 text-sm font-semibold leading-tight tracking-tight">Page Pilot</p>
                <p className="text-white/32 text-[10px] truncate max-w-[140px] mt-0.5">{domain}</p>
              </div>
            </div>

            {/* Right: stop + close — stopPropagation so clicks don't start a card drag */}
            <div
              className="flex items-center gap-2"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {state.isNavigating && (
                <button
                  onClick={handleStop}
                  className="text-[11px] font-medium text-red-400/80 hover:text-red-300 px-2.5 py-1 rounded-lg hover:bg-red-400/10 transition-colors border border-red-400/20 hover:border-red-400/30"
                >
                  Stop
                </button>
              )}
              <button
                onClick={onClose}
                aria-label="Close Page Pilot"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-white/45 hover:text-white/90 transition-all duration-150 border border-white/10 hover:border-white/20 hover:bg-white/10"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-3.5 py-3 flex flex-col gap-2.5 min-h-0">
          {state.messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.2)] flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgba(165,180,252,0.75)" className="w-6 h-6">
                  <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                </svg>
              </div>
              <div>
                <p className="text-white/55 text-sm font-medium">Where to?</p>
                <p className="text-white/25 text-xs mt-1 leading-relaxed">Tell me what to do on this page.</p>
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
        <div className="pp-b-input-bar flex-shrink-0 p-3">
          {state.pendingQuestion && (
            <p className="text-[10px] text-yellow-400/65 mb-2 px-1">Answering Claude's question ↑</p>
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
              className="pp-b-input flex-1 rounded-xl text-white/85 text-sm px-3 py-2 placeholder-white/20 resize-none leading-relaxed disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ maxHeight: "100px", overflowY: "auto" }}
            />
            <button
              onClick={handleSend}
              disabled={!state.inputValue.trim() || isInputDisabled}
              aria-label="Send"
              className="pp-b-send-btn flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="white" className="w-3.5 h-3.5">
                <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
              </svg>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
