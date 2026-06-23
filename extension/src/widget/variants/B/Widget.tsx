// Variant B widget — gradient pill launcher with chromatic rotating ring from Variant C.
// The outer container is the rotating ring (overflow:hidden clips it to pill shape).
// The inner glass pill (inset 2px) slides over the gradient showing only a 2px ring.
// A click-without-drag toggles the ChatPanel. Draggable anywhere on screen.

import React, { useCallback, useEffect, useState } from "react";
import { useWidgetDrag } from "../../hooks/useWidgetDrag";
import { loadPersistedState } from "../../widgetStore";
import ChatPanel from "./ChatPanel";

// Outer ring container dimensions (2px padding around the pill on each side).
const PILL_W = 108;
const PILL_H = 46;
const RING_PAD = 2;
const OUTER_W = PILL_W + RING_PAD * 2; // 112
const OUTER_H = PILL_H + RING_PAD * 2; // 50
const OUTER_RADIUS = Math.ceil(OUTER_H / 2);  // 25 — fully rounded pill
const INNER_RADIUS = OUTER_RADIUS - RING_PAD; // 23

/** Pill launcher with chromatic rotating ring and internal shimmer sweep. */
export default function Widget(): React.JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const handleToggle = useCallback(() => setIsOpen((prev) => !prev), []);
  // Pass outer dims so viewport clamping accounts for the full pill width.
  const { pos, isDragging, side, handleMouseDown, resetPos } = useWidgetDrag(
    handleToggle,
    OUTER_W,
    OUTER_H
  );

  useEffect(() => {
    loadPersistedState()
      .then((s) => { setIsOpen(s.isOpen); setIsReady(true); })
      .catch(() => setIsReady(true));
  }, []);

  useEffect(() => {
    if (!isReady) return;
    chrome.runtime.sendMessage({
      type: "SAVE_WIDGET_OPEN_STATE",
      payload: { isOpen },
    }).catch(() => {});
  }, [isOpen, isReady]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    resetPos();
  }, [resetPos]);

  if (!isReady) return null;

  return (
    <>
      {!isOpen && (
        /*
         * Outer div: clip container + rotating ring background.
         * overflow:hidden + border-radius clips the conic gradient to the pill shape,
         * so only the 2px gap between outer and inner pill shows as the ring.
         */
        <div
          role="button"
          aria-label="Open Page Pilot"
          onMouseDown={handleMouseDown}
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            width: OUTER_W,
            height: OUTER_H,
            borderRadius: OUTER_RADIUS,
            overflow: "hidden",
            zIndex: 2147483647,
            cursor: isDragging ? "grabbing" : "grab",
            userSelect: "none",
          }}
        >
          {/* Rotating chromatic ring — same gradient as C's orb ring */}
          <div
            className="pp-c-orb-ring"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: OUTER_RADIUS,
            }}
          />

          {/* Inner glass pill — inset 2px, revealing the ring around its edge */}
          <div
            className="pp-b-btn flex items-center justify-center gap-2"
            style={{
              position: "absolute",
              inset: RING_PAD,
              borderRadius: INNER_RADIUS,
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="white"
              className="w-4 h-4 flex-shrink-0"
              aria-hidden="true"
            >
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
            <span className="text-white text-xs font-semibold tracking-wide select-none">Pilot</span>
          </div>
        </div>
      )}

      {isOpen && (
        <ChatPanel side={side} widgetPos={pos} onClose={handleClose} />
      )}
    </>
  );
}
