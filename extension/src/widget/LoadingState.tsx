// LoadingState component — shown while the AI is navigating the page.
// Cycles through personality-forward status messages so users know work is happening.

import React, { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

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

const CYCLE_INTERVAL_MS = 2500;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Displays an animated loading bubble with rotating status copy.
 * Replaces the latest assistant message area while the navigation loop is running.
 * Uses setInterval to cycle messages — cleaned up on unmount to avoid memory leaks.
 */
export default function LoadingState(): React.JSX.Element {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % MESSAGES.length);
    }, CYCLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-start">
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 bg-navy-light border border-slate-700/50">
        {/* Blurred placeholder text — communicates "thinking" without being static */}
        <p
          className="text-sm text-slate-300 leading-relaxed transition-all duration-500"
          style={{ filter: "blur(0.3px)" }}
        >
          {MESSAGES[messageIndex]}
        </p>
        {/* Animated dots */}
        <div className="flex gap-1 mt-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-pilot-blue"
              style={{
                animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Keyframe animation injected inline — avoids needing a separate stylesheet entry */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
