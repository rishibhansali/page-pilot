// Floating draggable launcher button for Page Pilot.
// Renders a pill/icon anchored to the viewport edge; user can drag it anywhere.
// A click (without drag) toggles the ChatPanel open/closed.
// Tracks which half of the screen it's on so ChatPanel opens on the correct side.

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetPosition } from "@/types";
import ChatPanel from "./ChatPanel";
import { loadPersistedState } from "./widgetStore";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUTTON_SIZE = 56; // px — matches w-14 h-14 in Tailwind
const EDGE_MARGIN = 24; // px — minimum distance from viewport edge
/** Minimum pixel delta before a mousedown+mouseup counts as a drag, not a click. */
const DRAG_THRESHOLD = 5;

/** Right-center anchor point. Recalculated on every call so viewport dimensions are current. */
const getDefaultPosition = (): { x: number; y: number } => ({
  x: window.innerWidth - BUTTON_SIZE - EDGE_MARGIN,
  y: window.innerHeight / 2 - BUTTON_SIZE / 2,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Widget(): React.JSX.Element {
  // Position is stored as absolute viewport coords (left/top).
  // Lazy initializer so window dimensions are read after the DOM is ready.
  const [pos, setPos] = useState<{ x: number; y: number }>(getDefaultPosition);
  const [isOpen, setIsOpen] = useState(false);
  // Holds off rendering until the async state load from the service worker completes.
  const [isReady, setIsReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Ref stores the drag origin so mousemove math is correct without stale closures.
  const dragOrigin = useRef<{
    mouseX: number;
    mouseY: number;
    posX: number;
    posY: number;
  } | null>(null);
  // Tracks whether the pointer actually moved beyond the threshold.
  const hasDragged = useRef(false);

  // Derived: which half of the screen is the button on?
  // Used by ChatPanel to know which side to open on.
  const side: WidgetPosition["side"] =
    pos.x + BUTTON_SIZE / 2 < window.innerWidth / 2 ? "left" : "right";

  // Load isOpen from the service worker once on mount.
  useEffect(() => {
    loadPersistedState()
      .then((s) => {
        setIsOpen(s.isOpen);
        setIsReady(true);
      })
      .catch(() => setIsReady(true));
  }, []);

  // Persist isOpen to the service worker whenever it changes.
  // Skipped until the initial load completes to avoid an immediate write of false.
  useEffect(() => {
    if (!isReady) return;
    chrome.runtime.sendMessage({
      type: "SAVE_WIDGET_OPEN_STATE",
      payload: { isOpen },
    }).catch(() => { /* service worker may be restarting */ });
  }, [isOpen, isReady]);

  // Reset to the default right-center position whenever the viewport changes
  // (DevTools open/close, window resize) so the button is always reachable.
  useEffect(() => {
    function handleResize() {
      setPos(getDefaultPosition());
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ---------------------------------------------------------------------------
  // Drag logic
  // ---------------------------------------------------------------------------

  /**
   * Records the drag start position on mousedown.
   * We don't open/close on mousedown — we wait for mouseup to decide.
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left-button drag.
    if (e.button !== 0) return;
    e.preventDefault();
    hasDragged.current = false;
    dragOrigin.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };
    setIsDragging(true);
  }, [pos]);

  useEffect(() => {
    if (!isDragging) return;

    /**
     * Updates the button's position as the pointer moves.
     * Clamps to viewport so the button can never be dragged off-screen.
     */
    const handleMouseMove = (e: MouseEvent) => {
      const origin = dragOrigin.current;
      if (!origin) return;

      const dx = e.clientX - origin.mouseX;
      const dy = e.clientY - origin.mouseY;

      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        hasDragged.current = true;
      }

      setPos({
        x: Math.max(0, Math.min(window.innerWidth - BUTTON_SIZE, origin.posX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - BUTTON_SIZE, origin.posY + dy)),
      });
    };

    /**
     * Finalises drag on mouseup.
     * If the pointer barely moved, treat it as a click and toggle the panel.
     */
    const handleMouseUp = () => {
      dragOrigin.current = null;
      setIsDragging(false);
      if (!hasDragged.current) {
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Don't render until the async state load resolves so the button doesn't
  // flash at the default closed state before restoring the persisted open state.
  if (!isReady) return null;

  return (
    <>
      {/* Floating launcher button — hidden while chat panel is open */}
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
          className={[
            "flex items-center justify-center rounded-full shadow-2xl",
            "bg-navy border-2 border-pilot-blue",
            "transition-transform duration-150",
            "hover:scale-110",
          ].join(" ")}
        >
          {/* Plane icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="white"
            className="w-6 h-6"
            aria-hidden="true"
          >
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </div>
      )}

      {/* Chat panel — only rendered when open to avoid background port connections */}
      {isOpen && (
        <ChatPanel side={side} onClose={() => { setIsOpen(false); setPos(getDefaultPosition()); }} />
      )}
    </>
  );
}
