// useWidgetDrag — drag-to-reposition logic for the floating widget button.
// Encapsulates all mouse event handling and viewport clamping. Shared across all widget variants.

import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetSide } from "@/types";

const EDGE_MARGIN = 24;
const DRAG_THRESHOLD = 5;

/**
 * Returns the default right-center anchor position using current viewport dimensions.
 * buttonW / buttonH are used to center the element vertically and clamp it from the right edge.
 */
function getDefaultPosition(buttonW: number, buttonH: number): { x: number; y: number } {
  return {
    x: window.innerWidth - buttonW - EDGE_MARGIN,
    y: window.innerHeight / 2 - buttonH / 2,
  };
}

export interface UseWidgetDragReturn {
  pos: { x: number; y: number };
  setPos: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  isDragging: boolean;
  side: WidgetSide;
  handleMouseDown: (e: React.MouseEvent) => void;
  resetPos: () => void;
}

/**
 * Manages draggable positioning for the floating widget button.
 * Calls onToggle when the user clicks without dragging (delta < DRAG_THRESHOLD).
 * buttonW / buttonH control viewport-edge clamping; buttonH defaults to buttonW (square).
 */
export function useWidgetDrag(
  onToggle: () => void,
  buttonW: number = 56,
  buttonH: number = buttonW
): UseWidgetDragReturn {
  const [pos, setPos] = useState<{ x: number; y: number }>(
    () => getDefaultPosition(buttonW, buttonH)
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragOrigin = useRef<{
    mouseX: number;
    mouseY: number;
    posX: number;
    posY: number;
  } | null>(null);
  const hasDragged = useRef(false);

  // The "side" is based on where the horizontal center of the button sits.
  const side: WidgetSide =
    pos.x + buttonW / 2 < window.innerWidth / 2 ? "left" : "right";

  const resetPos = useCallback(
    () => setPos(getDefaultPosition(buttonW, buttonH)),
    [buttonW, buttonH]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [pos]
  );

  useEffect(() => {
    if (!isDragging) return;

    /** Updates button position as the pointer moves, clamped to viewport edges. */
    const handleMouseMove = (e: MouseEvent) => {
      const origin = dragOrigin.current;
      if (!origin) return;
      const dx = e.clientX - origin.mouseX;
      const dy = e.clientY - origin.mouseY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        hasDragged.current = true;
      }
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - buttonW, origin.posX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - buttonH, origin.posY + dy)),
      });
    };

    /** On mouseup: toggles open state if pointer barely moved (click, not drag). */
    const handleMouseUp = () => {
      dragOrigin.current = null;
      setIsDragging(false);
      if (!hasDragged.current) onToggle();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onToggle, buttonW, buttonH]);

  // Reset to default position on viewport resize so the button stays reachable.
  useEffect(() => {
    const handleResize = () => setPos(getDefaultPosition(buttonW, buttonH));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [buttonW, buttonH]);

  return { pos, setPos, isDragging, side, handleMouseDown, resetPos };
}
