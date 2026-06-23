// Variant C widget — visionOS-style liquid glass orb launcher.
// Three visual layers: outer breathing halo → rotating chromatic ring → glass sphere core.
// The ring rotates continuously; the halo pulses in and out; hover springs the orb.

import React, { useCallback, useEffect, useState } from "react";
import { useWidgetDrag } from "../../hooks/useWidgetDrag";
import { loadPersistedState } from "../../widgetStore";
import ChatPanel from "./ChatPanel";

const ORB_SIZE = 60;

/** Full liquid-glass orb launcher for Variant C (Full Liquid Glass / visionOS). */
export default function Widget(): React.JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const handleToggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const { pos, isDragging, side, handleMouseDown, resetPos } = useWidgetDrag(handleToggle, ORB_SIZE);

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
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            width: ORB_SIZE,
            height: ORB_SIZE,
            zIndex: 2147483647,
            cursor: isDragging ? "grabbing" : "grab",
            userSelect: "none",
            borderRadius: "50%",
          }}
          className="pp-c-orb-halo"
          role="button"
          aria-label="Open Page Pilot"
        >
          {/* Rotating chromatic ring — sits between halo and core */}
          <div
            className="pp-c-orb-ring"
            style={{
              position: "absolute",
              inset: -1,
              borderRadius: "50%",
            }}
          />
          {/* Glass sphere core */}
          <div
            className="pp-c-orb-core flex items-center justify-center"
            style={{
              position: "absolute",
              inset: 2,
              borderRadius: "50%",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="w-5 h-5"
              aria-hidden="true"
              style={{ fill: "rgba(200, 220, 255, 0.92)" }}
            >
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </div>
        </div>
      )}

      {isOpen && (
        <ChatPanel side={side} onClose={handleClose} />
      )}
    </>
  );
}
