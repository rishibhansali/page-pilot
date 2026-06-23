// Variant A widget — frosted glass launcher button.
// A click-without-drag toggles the ChatPanel. Draggable anywhere on screen.

import React, { useCallback, useEffect, useState } from "react";
import { useWidgetDrag } from "../../hooks/useWidgetDrag";
import { loadPersistedState } from "../../widgetStore";
import ChatPanel from "./ChatPanel";

const BUTTON_SIZE = 56;

/** Frosted glass floating launcher for Variant A (Frosted Glass Sidebar). */
export default function Widget(): React.JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const handleToggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const { pos, isDragging, side, handleMouseDown, resetPos } = useWidgetDrag(handleToggle, BUTTON_SIZE);

  // Restore open state from the service worker once on mount.
  useEffect(() => {
    loadPersistedState()
      .then((s) => { setIsOpen(s.isOpen); setIsReady(true); })
      .catch(() => setIsReady(true));
  }, []);

  // Persist open state to the service worker whenever it changes.
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
        <div
          role="button"
          aria-label="Open Page Pilot"
          onMouseDown={handleMouseDown}
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            zIndex: 2147483647,
            cursor: isDragging ? "grabbing" : "grab",
            userSelect: "none",
          }}
          className="pp-a-btn flex items-center justify-center rounded-full"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-5 h-5" aria-hidden="true">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </div>
      )}

      {isOpen && (
        <ChatPanel side={side} onClose={handleClose} />
      )}
    </>
  );
}
